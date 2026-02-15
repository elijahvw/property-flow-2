import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/version', async () => {
    return {
      version: '0.1.0',
      buildId: process.env.BUILD_ID || 'development',
    };
  });
}
