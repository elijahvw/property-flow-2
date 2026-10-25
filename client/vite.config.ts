import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  server: {
    // Bind locally unless a developer deliberately exposes the preview.
    // Vite's default allowed-host checks remain enabled. For a remote preview,
    // allow its exact hostname with __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS.
    host: process.env.PROPERTY_FLOW_DEV_HOST || '127.0.0.1',
    port: 5010,
    forwardConsole: false,
    proxy: {
      '/api': {
        target: 'http://localhost:5011',
        changeOrigin: true,
      }
    },
  },
});
