import type { TransportItem } from '@grafana/faro-web-sdk';

// Fixed path vocabulary: unknown segments (including tenant, company and record
// IDs) never become labels. Queries, fragments and external hosts never leave.
const segments = new Set(('notifications summary documents work-calendar preventive occurrences vendors vendor status link help guide delivery replace entry api company companies platform resident residents tenants properties units leases maintenance rent deposits finances reports overview members settings account profile users audit auth login logout callback bootstrap me invitations invite access dashboard statement terms settlement household participants approve reject cancel charges credits payments refunds applications costs candidates unlink updates history schedules renewals end archive restore').split(' '));
export function rumPath(value: unknown, origin: string): string {
  if (typeof value !== 'string') return '/unknown';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return '/external';
    if (url.pathname.startsWith('/assets/')) return '/assets/:asset';
    const path = url.pathname.split('/').filter(Boolean);
    if (path.length > 12) return '/unknown';
    return '/' + path.map(part => segments.has(part) ? part : ':id').join('/');
  } catch { return '/unknown'; }
}

const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const safeId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : undefined;
const timingKeys = new Set(('duration tcpHandshakeTime dnsLookupTime tlsNegotiationTime responseStatus redirectTime requestTime responseTime fetchTime serviceWorkerTime decodedBodySize encodedBodySize ttfb transferSize pageLoadTime documentParsingTime domProcessingTime domContentLoadHandlerTime onLoadTime').split(' '));
const measurementKeys = new Set(('cls fcp inp lcp ttfb delta largest_shift_value largest_shift_time first_byte_to_fcp time_to_first_byte interaction_time presentation_delay input_delay processing_duration next_paint_time total_script_duration total_style_and_layout_duration total_paint_duration total_unattributed_duration longest_script_intersecting_duration element_render_delay resource_load_delay resource_load_duration dns_duration connection_duration request_duration waiting_duration cache_duration').split(' '));
const events = new Set(['session_start', 'session_resume', 'session_extend', 'view_changed', 'faro.navigation', 'faro.performance.navigation', 'faro.performance.resource', 'faro.tracing.fetch', 'faro.tracing.xml-http-request']);
const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'UnhandledRejection']);

/** Reconstruct every signal from an allowlist, including metadata. A new SDK
 * field/type is discarded until reviewed; recursive URL replacement is unsafe. */
export function sanitizeRumItem(item: TransportItem, origin: string): TransportItem | null {
  const source = item.payload as any;
  const page = rumPath(item.meta.page?.url || '/', origin);
  const meta: TransportItem['meta'] = {
    app: item.meta.app && { name: 'propertyflow-dev', version: item.meta.app.version, environment: 'dev' },
    sdk: { name: '@grafana/faro-web-sdk', version: item.meta.sdk?.version },
    page: { url: origin + page, id: page },
    view: { name: page },
    // Faro's session sampler runs after beforeSend and removes this internal
    // flag before transport. Removing it here would discard every signal.
    session: { id: safeId(item.meta.session?.id), attributes: { isSampled: item.meta.session?.attributes?.isSampled === 'true' ? 'true' : 'false' } },
    browser: item.meta.browser && {
      name: /^(Chrome|Firefox|Safari|Edge|Opera|Mobile Safari|Chromium)$/.test(item.meta.browser.name || '') ? item.meta.browser.name : 'Other',
      mobile: item.meta.browser.mobile,
    },
  };
  const timestamp = typeof source.timestamp === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(source.timestamp) ? source.timestamp : new Date().toISOString();
  let payload: any;
  if (item.type === 'measurement' && source.type === 'web-vitals') {
    payload = { type: 'web-vitals', timestamp,
      values: Object.fromEntries(Object.entries(source.values || {}).filter(([key, value]) => measurementKeys.has(key) && numeric(value))),
      context: { rating: ['good', 'needs-improvement', 'poor'].includes(source.context?.rating) ? source.context.rating : 'unknown' },
    };
  } else if (item.type === 'exception') {
    const type = errorTypes.has(source.type) ? source.type : 'Error';
    payload = { type, value: `Browser ${type}`, timestamp,
      stacktrace: { frames: (source.stacktrace?.frames || []).slice(0, 12).map((frame: any) => ({
        filename: origin + rumPath(frame.filename, origin), function: '<redacted>',
        lineno: numeric(frame.lineno) ? frame.lineno : undefined,
        colno: numeric(frame.colno) ? frame.colno : undefined,
      })) },
    };
  } else if (item.type === 'event' && events.has(source.name)) {
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(source.attributes || {})) {
      if (['name', 'url', 'fromUrl', 'toUrl', 'http.url', 'url.full'].includes(key)) attrs[key] = origin + rumPath(value, origin);
      else if ((timingKeys.has(key) || ['duration_ns', 'http.status_code', 'http.response.status_code'].includes(key)) && typeof value === 'string' && /^\d{1,16}(\.\d{1,6})?$/.test(value)) attrs[key] = value;
      else if (['faroNavigationId', 'faroPreviousNavigationId', 'faroResourceId'].includes(key) && safeId(value)) attrs[key] = value as string;
      else if (['view_name','fromView','toView'].includes(key)) attrs[key] = rumPath(value, origin);
      else if (['http.method','http.request.method'].includes(key) && /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/.test(String(value))) attrs[key] = value as string;
      else if (key === 'sameDocument' && value === 'true') attrs[key] = 'true';
    }
    payload = { name: source.name, timestamp, attributes: attrs,
      trace: /^[a-f0-9]{32}$/.test(source.trace?.trace_id || '') && /^[a-f0-9]{16}$/.test(source.trace?.span_id || '') ? { trace_id: source.trace.trace_id, span_id: source.trace.span_id } : undefined,
    };
  } else if (item.type === 'trace') {
    payload = { resourceSpans: (source.resourceSpans || []).map((resource: any) => ({
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'propertyflow-dev' } }] },
      scopeSpans: (resource.scopeSpans || []).map((scope: any) => ({
        scope: { name: 'propertyflow-browser' },
        spans: (scope.spans || []).map((span: any) => {
          const attrs = (span.attributes || []).flatMap((attr: any) => {
            if (['http.url', 'url.full'].includes(attr.key)) return [{ key: attr.key, value: { stringValue: origin + rumPath(attr.value?.stringValue, origin) } }];
            if (['http.method', 'http.request.method'].includes(attr.key) && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(attr.value?.stringValue)) return [attr];
            if (['http.status_code', 'http.response.status_code'].includes(attr.key) && /^\d{3}$/.test(String(attr.value?.intValue))) return [attr];
            return [];
          });
          return {
            traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
            startTimeUnixNano: span.startTimeUnixNano, endTimeUnixNano: span.endTimeUnixNano,
            kind: span.kind, name: 'HTTP request', attributes: attrs,
            status: { code: [0, 1, 2].includes(span.status?.code) ? span.status.code : 0 },
          };
        }),
      })),
    })) };
  } else return null; // Console, clicks/DOM labels, custom logs and future signals.
  return { type: item.type, meta, payload };
}

export function validRumCollector(value: string | undefined): boolean {
  return !!value && /^https:\/\/faro-collector-prod-us-east-3\.grafana\.net\/collect\/[a-f0-9]{32}$/.test(value);
}
