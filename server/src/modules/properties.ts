import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { resolveUser } from '../auth/user-resolver';

export async function propertyRoutes(app: FastifyInstance) {
  // Apply auth and user resolution to all routes in this module
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', resolveUser.bind(app));

  app.get('/', async (request) => {
    const user = (request as any).dbUser;
    // Multi-tenant: Filter by companyIds user belongs to
    const companyIds = user.companies.map((c: any) => c.companyId);
    
    const properties = await app.prisma.property.findMany({
      where: {
        companyId: { in: companyIds }
      },
      include: { units: true },
      orderBy: { createdAt: 'desc' },
    });
    return properties;
  });

  app.post('/', async (request, reply) => {
    const user = (request as any).dbUser;
    const body = request.body as {
      companyId: string;
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    };

    // Ensure user belongs to the company they are trying to create for
    if (!user.companies.some((c: any) => c.companyId === body.companyId)) {
      return reply.status(403).send({ error: 'Access denied to this company' });
    }

    const property = await app.prisma.property.create({ data: body });
    return reply.status(201).send(property);
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).dbUser;
    const companyIds = user.companies.map((c: any) => c.companyId);

    const property = await app.prisma.property.findUnique({
      where: { id },
      include: { units: true },
    });

    if (!property || !companyIds.includes(property.companyId)) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    return property;
  });

  app.post('/:id/units', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).dbUser;
    const companyIds = user.companies.map((c: any) => c.companyId);

    const property = await app.prisma.property.findUnique({ where: { id } });
    if (!property || !companyIds.includes(property.companyId)) {
      return reply.status(404).send({ error: 'Property not found' });
    }

    const body = request.body as {
      number: string;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
      rentAmount?: number;
    };

    const unit = await app.prisma.unit.create({
      data: {
        companyId: property.companyId,
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

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).dbUser;
    const companyIds = user.companies.map((c: any) => c.companyId);

    const property = await app.prisma.property.findUnique({ where: { id } });
    if (!property || !companyIds.includes(property.companyId)) {
      return reply.status(404).send({ error: 'Property not found' });
    }

    await app.prisma.property.delete({ where: { id } });
    return reply.status(204).send();
  });
}
