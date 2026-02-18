import { FastifyInstance } from 'fastify';
import { authenticate } from '../../auth/middleware';
import { resolveUser } from '../../auth/user-resolver';

export async function authRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', resolveUser.bind(app));

  app.get('/me', async (request) => {
    return request.dbUser;
  });
}
