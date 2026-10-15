import { randomUUID } from "node:crypto";
import {
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
  trace,
  type Span,
} from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  PeriodicExportingMetricReader,
  AggregationTemporality,
  type PushMetricExporter,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { logs } from "@opentelemetry/api-logs";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import {
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

// Database instrumentation sees SQL internally. Only this allowlist crosses the
// exporter boundary: no statements, bind values, connection details or exceptions.
const safeAttributes = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "db.system",
  "db.system.name",
  "db.operation.name",
  "db.operation",
]);
const metricAttributes = new Set([
  ...safeAttributes,
  "type",
  "operation.name",
  "operation.outcome",
  "job.name",
  "job.outcome",
  "build.version",
]);
export class PrivateMetricExporter implements PushMetricExporter {
  constructor(private readonly delegate: PushMetricExporter) {}
  export(data: ResourceMetrics, callback: (result: ExportResult) => void) {
    // Explicit app instruments only. Driver instrumentation can introduce new
    // labels in future versions; never export those implicitly.
    const safe = {
      ...data,
      scopeMetrics: data.scopeMetrics
        .filter((row) => row.scope.name === "propertyflow-server")
        .map((row) => ({
          ...row,
          metrics: row.metrics.map((metric) => ({
            ...metric,
            dataPoints: metric.dataPoints.map((point) => ({
              ...point,
              attributes: Object.fromEntries(
                Object.entries(point.attributes).filter(([key]) =>
                  metricAttributes.has(key),
                ),
              ),
            })),
          })),
        })),
    } as ResourceMetrics;
    this.delegate.export(safe, callback);
  }
  selectAggregationTemporality() {
    return AggregationTemporality.CUMULATIVE;
  }
  forceFlush() {
    return this.delegate.forceFlush();
  }
  shutdown() {
    return this.delegate.shutdown();
  }
}
export class PrivateSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}
  export(spans: ReadableSpan[], callback: (result: ExportResult) => void) {
    this.delegate.export(
      spans.map((span) => ({
        ...span,
        spanContext: () => span.spanContext(),
        name: span.instrumentationScope.name.includes("pg")
          ? "postgresql.query"
          : span.name,
        attributes: Object.fromEntries(
          Object.entries(span.attributes).filter(([key]) =>
            safeAttributes.has(key),
          ),
        ),
        events: [],
        links: [],
        status: { code: span.status.code },
      })),
      callback,
    );
  }
  shutdown() {
    return this.delegate.shutdown();
  }
}
// Measure at span completion, independently of exporter batching, drops and
// shutdown order. Network failures must not change measured database latency.
export class DatabaseMetricsProcessor implements SpanProcessor {
  constructor(
    private readonly record = (seconds: number) =>
      databaseDuration.record(seconds),
  ) {}
  onStart() {}
  onEnd(span: ReadableSpan) {
    if (span.instrumentationScope.name.includes("pg"))
      this.record(span.duration[0] + span.duration[1] / 1e9);
  }
  async forceFlush() {}
  async shutdown() {}
}
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
let sdk: NodeSDK | undefined;
if (endpoint && process.env.OTEL_SDK_DISABLED !== "true") {
  const base = new URL(endpoint);
  if (
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
    ) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid OTLP collector endpoint");
  const url = (signal: string) =>
    `${base.href.replace(/\/$/, "")}/v1/${signal}`;
  sdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      "service.name": "propertyflow-server",
      "service.version": process.env.APP_VERSION || "development",
      "deployment.environment.name": process.env.APP_ENV || "dev",
      "deployment.environment": process.env.APP_ENV || "dev",
      "service.namespace": "propertyflow",
      "service.instance.id": randomUUID(),
      "cloud.provider": process.env.ECS_CONTAINER_METADATA_URI_V4
        ? "aws"
        : "local",
      ...(process.env.ECS_CONTAINER_METADATA_URI_V4
        ? { "cloud.platform": "aws_ecs", "aws.ecs.launchtype": "fargate" }
        : {}),
    }),
    spanProcessors: [
      new DatabaseMetricsProcessor(),
      new BatchSpanProcessor(
        new PrivateSpanExporter(
          new OTLPTraceExporter({ url: url("traces"), timeoutMillis: 2000 }),
        ),
        {
          maxQueueSize: 512,
          maxExportBatchSize: 128,
          scheduledDelayMillis: 1000,
          exportTimeoutMillis: 3000,
        },
      ),
    ],
    instrumentations: [
      new PgInstrumentation({
        enhancedDatabaseReporting: false,
        requireParentSpan: true,
        addSqlCommenterCommentToQueries: false,
      }),
    ],
    views: [
      {
        instrumentName: "propertyflow.http.duration",
        aggregationCardinalityLimit: 256,
      },
      {
        instrumentName: "propertyflow.browser.duration",
        aggregationCardinalityLimit: 64,
      },
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new PrivateMetricExporter(
          new OTLPMetricExporter({ url: url("metrics"), timeoutMillis: 2000 }),
        ),
        exportIntervalMillis: 15000,
        exportTimeoutMillis: 3000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: url("logs"),
          timeoutMillis: 2000,
        }),
        maxQueueSize: 512,
        maxExportBatchSize: 128,
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 3000,
      }),
    ],
    spanLimits: { attributeCountLimit: 16, attributeValueLengthLimit: 160 },
  });
  sdk.start();
}
const tracer = trace.getTracer("propertyflow-http"),
  meter = metrics.getMeter("propertyflow-server");
const requests = meter.createCounter("propertyflow.http.requests", {
  description: "Completed API requests",
});
const duration = meter.createHistogram("propertyflow.http.duration", {
  unit: "s",
  advice: {
    explicitBucketBoundaries: [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ],
  },
});
meter.createObservableGauge("propertyflow.build.info").addCallback((result) =>
  result.observe(1, {
    "build.version": process.env.APP_VERSION || "development",
  }),
);
const databaseDuration = meter.createHistogram(
  "propertyflow.database.duration",
  { unit: "s" },
);
let priorCpu = process.cpuUsage(),
  priorTime = performance.now();
meter
  .createObservableGauge("propertyflow.process.cpu", { unit: "1" })
  .addCallback((result) => {
    const nextCpu = process.cpuUsage(),
      now = performance.now();
    const used =
      nextCpu.user - priorCpu.user + nextCpu.system - priorCpu.system;
    result.observe(
      used /
        Math.max(1, (now - priorTime) * 1000) /
        (Number(process.env.APP_CPU_CORES) || 1),
    );
    priorCpu = nextCpu;
    priorTime = now;
  });
meter
  .createObservableGauge("propertyflow.process.uptime", { unit: "s" })
  .addCallback((result) => result.observe(process.uptime()));
meter
  .createObservableGauge("propertyflow.process.memory", { unit: "By" })
  .addCallback((result) => {
    const memory = process.memoryUsage();
    result.observe(memory.rss, { type: "rss" });
    result.observe(memory.heapUsed, { type: "heap_used" });
  });
const logger = logs.getLogger("propertyflow-server");
let ready = 0;
meter
  .createObservableGauge("propertyflow.readiness")
  .addCallback((result) => result.observe(ready));
const pending = new WeakMap<FastifyRequest, { span: Span; started: number }>();
const method = (value: string) =>
  ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"].includes(value)
    ? value
    : "OTHER";
export function registerTelemetry(server: FastifyInstance) {
  server.addHook("onRequest", (request, _reply, done) => {
    const span = tracer.startSpan(
      "HTTP request",
      {
        kind: SpanKind.SERVER,
        attributes: { "http.request.method": method(request.method) },
      },
      ROOT_CONTEXT,
    );
    pending.set(request, { span, started: performance.now() });
    context.with(trace.setSpan(ROOT_CONTEXT, span), done);
  });
  server.addHook("onResponse", async (request, reply) => {
    const row = pending.get(request);
    if (!row) return;
    pending.delete(request);
    if (request.routeOptions.url === "/api/ready")
      ready = reply.statusCode === 200 ? 1 : 0;
    const attributes = {
      "http.request.method": method(request.method),
      "http.route": request.routeOptions.url || "unmatched",
      "http.response.status_code": reply.statusCode,
    };
    row.span.updateName(
      `${attributes["http.request.method"]} ${attributes["http.route"]}`,
    );
    row.span.setAttributes(attributes);
    if (reply.statusCode >= 500)
      row.span.setStatus({ code: SpanStatusCode.ERROR });
    requests.add(1, attributes);
    duration.record((performance.now() - row.started) / 1000, {
      "http.route": attributes["http.route"],
      "http.request.method": attributes["http.request.method"],
    });
    logger.emit({
      context: trace.setSpan(ROOT_CONTEXT, row.span),
      severityNumber:
        reply.statusCode >= 500 ? SeverityNumber.ERROR : SeverityNumber.INFO,
      body: "HTTP request completed",
      attributes,
    });
    row.span.end();
  });
}
export function recordRequestError(
  request: FastifyRequest,
  safeCode: string,
  errorType: string,
) {
  safeCode = /^[A-Z0-9_]{1,80}$/.test(safeCode) ? safeCode : "REQUEST_FAILED";
  errorType = [
    "Error",
    "AccessError",
    "TypeError",
    "RangeError",
    "ValidationError",
    "FastifyError",
    "PrismaClientKnownRequestError",
    "PrismaClientUnknownRequestError",
    "PrismaClientInitializationError",
  ].includes(errorType)
    ? errorType
    : "Error";
  const span = pending.get(request)?.span;
  span?.setStatus({ code: SpanStatusCode.ERROR });
  logger.emit({
    context: span ? trace.setSpan(ROOT_CONTEXT, span) : ROOT_CONTEXT,
    severityNumber: SeverityNumber.ERROR,
    body: "Request failed",
    attributes: { "error.type": errorType, "error.code": safeCode },
  });
}
export async function shutdownTelemetry() {
  await sdk?.shutdown();
}

const browserCount = meter.createCounter("propertyflow.browser.operations");
const browserDuration = meter.createHistogram("propertyflow.browser.duration", {
  unit: "s",
});
export function recordBrowserOperation(event: {
  name: string;
  outcome: string;
  duration: number;
}) {
  const attributes = {
    "operation.name": event.name,
    "operation.outcome": event.outcome,
  };
  browserCount.add(1, attributes);
  browserDuration.record(event.duration / 1000, {
    "operation.name": event.name,
  });
  if (event.outcome === "error")
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      body: "Browser operation failed",
      attributes,
    });
}
const jobs = meter.createCounter("propertyflow.worker.runs");
const jobDuration = meter.createHistogram("propertyflow.worker.duration", {
  unit: "s",
});
let lastBillingSuccess = 0;
meter
  .createObservableGauge("propertyflow.worker.last_success", { unit: "s" })
  .addCallback((result) => result.observe(lastBillingSuccess));
export function recordBillingRun(started: number, failed: boolean) {
  const attributes = {
    "job.name": "rent-billing",
    "job.outcome": failed ? "error" : "success",
  };
  jobs.add(1, attributes);
  jobDuration.record((performance.now() - started) / 1000, {
    "job.name": "rent-billing",
  });
  if (!failed) lastBillingSuccess = Date.now() / 1000;
  else
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      body: "Rent billing needs retry",
      attributes,
    });
}
