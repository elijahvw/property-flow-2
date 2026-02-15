import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function propertyRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { companyId } = request.query as { companyId?: string };
    const where = companyId ? { companyId } : {};
    const properties = await prisma.property.findMany({
      where,
      include: { units: true },
      orderBy: { createdAt: 'desc' },
    });
    return properties;
  });

  app.post('/', async (request, reply) => {
    const body = request.body as {
      companyId: string;
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    };
    if (!body.companyId || !body.name) {
      return reply.status(400).send({ error: 'companyId and name are required' });
    }
    const property = await prisma.property.create({ data: body });
    return reply.status(201).send(property);
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const property = await prisma.property.findUnique({
      where: { id },
      include: { units: true },
    });
    if (!property) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    return property;
  });

  app.post('/:id/units', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      companyId: string;
      number: string;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
      rentAmount?: number;
    };
    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    const unit = await prisma.unit.create({
      data: {
        companyId: body.companyId || property.companyId,
        propertyId: id,
        number: body.number,
        bedrooms: body.bedrooms || 0,
        bathrooms: body.bathrooms || 0,
        sqft: body.sqft || 0,
        rentAmount: body.rentAmount || 0,
      },
    });
    return reply.status(201).send(unit);
  });

  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    }>;
    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    const updated = await prisma.property.update({ where: { id }, data: body });
    return updated;
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    await prisma.property.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.get('/:id/units', async (request) => {
    const { id } = request.params as { id: string };
    const units = await prisma.unit.findMany({
      where: { propertyId: id },
      orderBy: { number: 'asc' },
    });
    return units;
  });
}
