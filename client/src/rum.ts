import { initializeFaro, ErrorsInstrumentation, WebVitalsInstrumentation, SessionInstrumentation, ViewInstrumentation, PerformanceInstrumentation, type Faro } from '@grafana/faro-web-sdk';
import { getDefaultOTELInstrumentations, TracingInstrumentation } from '@grafana/faro-web-tracing';
import { rumPath, sanitizeRumItem, validRumCollector } from './rum-privacy';

let rum: Faro | undefined;
export function startRum() {
  const url = import.meta.env.VITE_FARO_COLLECTOR_URL;
  // Local previews/fixtures never send telemetry. Enable explicitly per build.
  if (rum || import.meta.env.VITE_RUM_ENABLED !== 'true' || !validRumCollector(url) || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  try {
    const origin = location.origin;
    rum = initializeFaro({
      url, app: { name: 'propertyflow-dev', version: import.meta.env.VITE_APP_VERSION || 'local', environment: 'dev' },
      preventGlobalExposure: true,
      sessionTracking: { enabled: true, persistent: false, samplingRate: 1 },
      trackGeolocation: false,
      trackResources: true,
      pageTracking: { generatePageId: () => rumPath(location.href, origin) },
      webVitalsInstrumentation: { reportAllChanges: false, trackAttributionSources: false },
      batching: { enabled: true, sendTimeout: 10000, itemLimit: 30 },
      // No console, DOM user-action, CSP contents, replay, user identities or baggage.
      instrumentations: [new ErrorsInstrumentation(), new WebVitalsInstrumentation(), new SessionInstrumentation(), new ViewInstrumentation(), new PerformanceInstrumentation(),
        new TracingInstrumentation({
          omitTraceContextForUnsampledSessions: true,
          instrumentations: getDefaultOTELInstrumentations({
            ignoreUrls: [new RegExp(`^(?!${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/api\/|\/api\/).*`), /\/api\/(auth\/|telemetry(?:[?#]|$)|ready(?:[?#]|$))/],
            propagateTraceHeaderCorsUrls: [],
          }),
        }),
      ],
      // Trace only this origin's business API. Exclude auth redirects, readiness
      // polling and the operation telemetry collector to prevent recursion.
      ignoreUrls: [/\/api\/(auth\/|telemetry(?:[?#]|$)|ready(?:[?#]|$))/],
      beforeSend: item => sanitizeRumItem(item, origin),
    });
    recordRumView(location.pathname);
  } catch { /* Monitoring setup/outages must never block the application. */ }
}

export function recordRumView(path: string) {
  rum?.api.setView({ name: rumPath(path, location.origin) });
}

export function recordRumRenderError() {
  rum?.api.pushError(new Error('React render failure'));
}
