/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_COGNITO_USER_POOL_ID: string
  readonly VITE_COGNITO_CLIENT_ID: string
  readonly VITE_COGNITO_DOMAIN: string
  readonly VITE_DATADOG_APPLICATION_ID?: string
  readonly VITE_DATADOG_CLIENT_TOKEN?: string
  readonly VITE_DATADOG_SITE?: string
  readonly VITE_DATADOG_SERVICE?: string
  readonly VITE_DATADOG_ENV?: string
  readonly VITE_DATADOG_SESSION_SAMPLE_RATE?: string
  readonly VITE_DATADOG_SESSION_REPLAY_SAMPLE_RATE?: string
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
