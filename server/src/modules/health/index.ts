import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/version', async () => {
    return { version: '1.0.0' };
  });
}
