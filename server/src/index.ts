import { invitationMailer } from "./invitation-email.js";
import { registerRentBillingWorker } from "./rent-billing-worker.js";
import fastify, { type FastifyError } from "fastify";
import {
  registerTelemetry,
  recordRequestError,
  shutdownTelemetry,
} from "./tracing.js";
import { registerBrowserTelemetry } from "./browser-telemetry.js";
import dotenv from "dotenv";
import { prisma } from "./lib/prisma.js";
import { registerSessions, readAuthConfig } from "./sessions.js";
import { MAX_USER_ID_BYTES, registerApplication } from "./application.js";
import { identityProvider } from "./identity-provider.js";
import { AccessError } from "./access.js";

dotenv.config();
const server = fastify({
  bodyLimit: 65536,
  routerOptions: { maxParamLength: MAX_USER_ID_BYTES },
  logger: {
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers.set-cookie",
    ],
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url?.split("?")[0],
        id: request.id,
      }),
    },
  },
});
server.setErrorHandler((failure, request, reply) => {
  const error = (
    failure instanceof Error ? failure : new Error("REQUEST_FAILED")
  ) as FastifyError;
  const code = (error as any).code;
  const status =
    error instanceof AccessError
      ? error.statusCode
      : error.statusCode === 413
        ? 413
      : error.statusCode === 429
        ? 429
        : code === "P2025"
          ? 404
          : ["P2002", "P2034"].includes(code)
            ? 409
            : error.validation
              ? 400
              : 503;
  const message =
    error instanceof AccessError
      ? error.message
      : status === 413
        ? "The upload exceeds the allowed size. Choose a file up to 5 MB."
      : status === 429
        ? "Too many sign-in attempts. Please wait a minute."
        : status === 404
          ? "Record not found."
          : status === 409
            ? "The record changed or conflicts with an existing record. Refresh and try again."
            : status === 400
              ? "Check the submitted fields."
              : "The service is temporarily unavailable. Please try again.";
  const safeCode =
    error instanceof AccessError ? error.code : `REQUEST_${status}`;
  const safeFrames = (error.stack || "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 12)
    .join("\n");
  request.log.warn(
    {
      code: safeCode,
      errorType: error.name,
      status,
      requestId: request.id,
      ...(status >= 500 ? { stack: safeFrames } : {}),
    },
    "Request failed",
  );
  if (status >= 500) recordRequestError(request, safeCode, error.name);
  reply
    .status(status)
    .send({ error: message, code: safeCode, requestId: request.id });
});
registerTelemetry(server);
server.get("/", async () => ({ status: "ok" }));
server.get("/api/health", async () => ({ status: "ok" }));
server.get("/api/ready", async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: "ok", db: "connected" };
});
const config = readAuthConfig();
const authenticate = await registerSessions(server, prisma, config);
registerBrowserTelemetry(server, authenticate);
registerApplication(
  server,
  prisma,
  authenticate,
  config.origin,
  identityProvider(),
  { invitationMailer: invitationMailer() },
);
registerRentBillingWorker(server, prisma);
server.setNotFoundHandler((_request, reply) =>
  reply.code(404).send({ error: "Not found", code: "NOT_FOUND" }),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  await server.close();
  await prisma.$disconnect();
  await shutdownTelemetry().catch(() =>
    server.log.warn(
      { code: "TELEMETRY_SHUTDOWN_FAILED" },
      "Monitoring flush failed",
    ),
  );
  clearTimeout(deadline);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
await server.listen({ port: 5011, host: "0.0.0.0" });
