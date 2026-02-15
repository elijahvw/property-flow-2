import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { resolveUser } from '../auth/user-resolver';
import { resolveTenant } from '../tenant/middleware';
import { checkRole } from '../rbac/middleware';

export async function propertyRoutes(app: FastifyInstance) {
  // Apply auth and user resolution to all routes in this module
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', resolveUser.bind(app));
  app.addHook('preHandler', resolveTenant);

  app.get('/', async (request) => {
    const user = (request as any).dbUser;
    const activeCompanyId = (request as any).companyId;

    // Multi-tenant: If active company is set, filter by it. 
    // Otherwise return everything user has access to.
    const companyIds = activeCompanyId ? [activeCompanyId] : user.companies.map((c: any) => c.companyId);
    
    const properties = await app.prisma.property.findMany({
      where: {
        companyId: { in: companyIds }
      },
      include: { units: true },
      orderBy: { createdAt: 'desc' },
    });
    return properties;
  });

  app.post('/', {
    preHandler: [checkRole(['COMPANY_OWNER', 'PROPERTY_MANAGER'])]
  }, async (request, reply) => {
    const activeCompanyId = (request as any).companyId;
    if (!activeCompanyId) {
      return reply.status(400).send({ error: 'Active company context required' });
    }

    const body = request.body as {
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    };

    const property = await app.prisma.property.create({ 
      data: {
        ...body,
        companyId: activeCompanyId
      }
    });
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

  app.post('/:id/units', {
    preHandler: [
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const property = await app.prisma.property.findUnique({ where: { id } });
        if (!property) return reply.status(404).send({ error: 'Property not found' });
        (request as any).inferredCompanyId = property.companyId;
      },
      checkRole(['COMPANY_OWNER', 'PROPERTY_MANAGER'])
    ]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const property = await app.prisma.property.findUnique({ where: { id } });
    
    // Safety check (already done in preHandler but for TS safety)
    if (!property) return reply.status(404).send({ error: 'Property not found' });

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

  app.delete('/:id', {
    preHandler: [
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const property = await app.prisma.property.findUnique({ where: { id } });
        if (!property) return reply.status(404).send({ error: 'Property not found' });
        (request as any).inferredCompanyId = property.companyId;
      },
      checkRole(['COMPANY_OWNER'])
    ]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await app.prisma.property.delete({ where: { id } });
    return reply.status(204).send();
  });
}
