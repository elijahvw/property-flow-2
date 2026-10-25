import { preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Vite otherwise inherits server.proxy in preview. Fixtures must never reach
// a real API that happens to be running beside this isolated static build.
const server = await preview({
  root: fileURLToPath(new URL('../client/', import.meta.url)),
  preview: { host: '127.0.0.1', port: 5019, strictPort: true, proxy: {} },
});
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.httpServer.close(() => process.exit(0)));
}
