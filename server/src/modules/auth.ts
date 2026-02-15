import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { resolveUser } from '../auth/user-resolver';

export async function authRoutes(app: FastifyInstance) {
  app.get('/me', {
    preHandler: [authenticate, resolveUser.bind(app)]
  }, async (request) => {
    const user = (request as any).dbUser;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      companies: user.companies.map((cu: any) => ({
        id: cu.company.id,
        name: cu.company.name,
        role: cu.role
      }))
    };
  });
}
