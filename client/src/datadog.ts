import { datadogRum } from '@datadog/browser-rum';
import { reactPlugin } from '@datadog/browser-rum-react';

const DEFAULT_APPLICATION_ID = 'ece83d6b-9459-4b8d-9bd2-80be3e921d19';
const DEFAULT_CLIENT_TOKEN = 'pub55a22e0ecb428b2769837c1a21dee8cf';
const DEFAULT_SITE = 'us5.datadoghq.com';

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

  datadogRum.init({
    applicationId: pickString(import.meta.env.VITE_DATADOG_APPLICATION_ID, DEFAULT_APPLICATION_ID),
    clientToken: pickString(import.meta.env.VITE_DATADOG_CLIENT_TOKEN, DEFAULT_CLIENT_TOKEN),
    site: pickString(import.meta.env.VITE_DATADOG_SITE, DEFAULT_SITE),
    service: pickString(import.meta.env.VITE_DATADOG_SERVICE, 'property-flow-client'),
    env: pickString(import.meta.env.VITE_DATADOG_ENV, import.meta.env.MODE),
    version: import.meta.env.VITE_APP_VERSION,
    sessionSampleRate: parsePercentage(import.meta.env.VITE_DATADOG_SESSION_SAMPLE_RATE, 100),
    sessionReplaySampleRate: parsePercentage(import.meta.env.VITE_DATADOG_SESSION_REPLAY_SAMPLE_RATE, 20),
    defaultPrivacyLevel: 'mask-user-input',
    plugins: [reactPlugin({ router: true })],
  });

  didInit = true;
};
