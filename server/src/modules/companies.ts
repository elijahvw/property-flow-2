import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function companyRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return companies;
  });

  app.post('/', async (request, reply) => {
    const { name } = request.body as { name: string };
    if (!name) {
      return reply.status(400).send({ error: 'Name is required' });
    }
    const company = await prisma.company.create({ data: { name } });
    return reply.status(201).send(company);
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) {
      return reply.status(404).send({ error: 'Company not found' });
    }
    return company;
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name: string };
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) {
      return reply.status(404).send({ error: 'Company not found' });
    }
    const updated = await prisma.company.update({ where: { id }, data: { name } });
    return updated;
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) {
      return reply.status(404).send({ error: 'Company not found' });
    }
    await prisma.company.delete({ where: { id } });
    return reply.status(204).send();
  });
}
