import { FastifyInstance } from 'fastify';
import { authenticate } from '../../auth/middleware';
import { resolveUser } from '../../auth/user-resolver';

export async function companyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', resolveUser.bind(app));

  app.get('/', async (request) => {
    const user = request.dbUser;
    return user.companies.map((c: any) => c.company);
  });

  app.post('/', async (request, reply) => {
    const { name } = request.body as { name: string };
    const user = request.dbUser;

    if (!name) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    const company = await app.prisma.company.create({
      data: {
        name,
        users: {
          create: {
            userId: user.id,
            role: 'COMPANY_OWNER'
          }
        }
      },
      include: {
        users: {
          where: { userId: user.id },
          include: { company: true }
        }
      }
    });

    const companyUser = company.users[0];
    return reply.status(201).send({
      id: companyUser.id,
      companyId: companyUser.companyId,
      role: companyUser.role,
      company: {
        id: companyUser.company.id,
        name: companyUser.company.name
      }
    });
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.dbUser;

    const membership = user.companies.find((c: any) => c.companyId === id);
    if (!membership) {
      return reply.status(404).send({ error: 'Company not found' });
    }

    return membership.company;
  });
}
