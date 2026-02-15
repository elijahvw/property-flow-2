import { FastifyInstance } from 'fastify';
import { healthRoutes } from './modules/health';
import { companyRoutes } from './modules/companies';
import { propertyRoutes } from './modules/properties';

export function registerRoutes(app: FastifyInstance) {
  app.register(healthRoutes, { prefix: '/api' });
  app.register(companyRoutes, { prefix: '/api/companies' });
  app.register(propertyRoutes, { prefix: '/api/properties' });
}
