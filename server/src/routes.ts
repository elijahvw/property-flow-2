import { FastifyInstance } from 'fastify';
import { healthRoutes } from './modules/health';

export function registerRoutes(app: FastifyInstance) {
  app.register(healthRoutes, { prefix: '/api' });
}
