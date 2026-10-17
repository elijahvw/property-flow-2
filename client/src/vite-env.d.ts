/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_COGNITO_USER_POOL_ID: string
  readonly VITE_COGNITO_CLIENT_ID: string
  readonly VITE_COGNITO_DOMAIN: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_RUM_ENABLED?: string
  readonly VITE_FARO_COLLECTOR_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
