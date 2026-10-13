import { datadogRum } from '@datadog/browser-rum';
import { reactPlugin } from '@datadog/browser-rum-react';
import { isFirstPartyApiUrl } from './observability';

const DEFAULT_SITE = 'datadoghq.com';

let didInit = false;

const pickString = (value: string | undefined, fallback: string) => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return value;
};

const parsePercentage = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return fallback;
  }

  return parsed;
};

export const initDatadogRum = () => {
  if (didInit || typeof window === 'undefined') {
    return;
  }

  const applicationId = import.meta.env.VITE_DATADOG_APPLICATION_ID?.trim();
  const clientToken = import.meta.env.VITE_DATADOG_CLIENT_TOKEN?.trim();

  // Browser credentials belong to the configured Datadog site's RUM application.
  // Leave RUM disabled until they are supplied; never reuse the old account's keys.
  if (!applicationId || !clientToken) {
    return;
  }

  datadogRum.init({
    applicationId,
    clientToken,
    site: pickString(import.meta.env.VITE_DATADOG_SITE, DEFAULT_SITE),
    service: pickString(import.meta.env.VITE_DATADOG_SERVICE, 'property-flow-client'),
    env: pickString(import.meta.env.VITE_DATADOG_ENV, import.meta.env.MODE),
    version: import.meta.env.VITE_APP_VERSION,
    sessionSampleRate: parsePercentage(import.meta.env.VITE_DATADOG_SESSION_SAMPLE_RATE, 100),
    sessionReplaySampleRate: parsePercentage(import.meta.env.VITE_DATADOG_SESSION_REPLAY_SAMPLE_RATE, 20),
    defaultPrivacyLevel: 'mask-user-input',
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: true,
    traceSampleRate: parsePercentage(import.meta.env.VITE_DATADOG_TRACE_SAMPLE_RATE, 100),
    // Propagate tracing headers only to this application's API.
    allowedTracingUrls: [(url: string) => isFirstPartyApiUrl(url, window.location.origin)],
    plugins: [reactPlugin({ router: true })],
  });

  didInit = true;
};
