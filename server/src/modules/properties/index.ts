import { FastifyInstance } from 'fastify';
import { authenticate } from '../../auth/middleware';
import { resolveUser } from '../../auth/user-resolver';
import { resolveTenant } from '../../tenant/middleware';
import { checkRole } from '../../rbac/middleware';

export async function propertyRoutes(app: FastifyInstance) {
  // Apply auth and user resolution to all routes in this module
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', resolveUser.bind(app));
  app.addHook('preHandler', resolveTenant);

  app.get('/', async (request) => {
    const user = request.dbUser;
    const activeCompanyId = request.companyId;

    // Multi-tenant isolation: Always filter by companyId
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
    const activeCompanyId = request.companyId;
    if (!activeCompanyId) {
      return reply.status(400).send({ error: 'Active company context required' });
    }

    const body = request.body as any;
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
    const activeCompanyId = request.companyId;

    const property = await app.prisma.property.findFirst({
      where: { 
        id,
        companyId: activeCompanyId || undefined // If no active company, we might want to check against all user's companies but for now strict
      },
      include: { units: true },
    });

    if (!property) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    return property;
  });

  app.post('/:id/units', {
    preHandler: [
      checkRole(['COMPANY_OWNER', 'PROPERTY_MANAGER'])
    ]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const activeCompanyId = request.companyId;
    
    const property = await app.prisma.property.findFirst({ 
      where: { id, companyId: activeCompanyId } 
    });
    
    if (!property) return reply.status(404).send({ error: 'Property not found' });

    const body = request.body as any;
    const unit = await app.prisma.unit.create({
      data: {
        ...body,
        companyId: property.companyId,
        propertyId: id,
      },
    });
    return reply.status(201).send(unit);
  });

  app.delete('/:id', {
    preHandler: [
      checkRole(['COMPANY_OWNER'])
    ]
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const activeCompanyId = request.companyId;

    const property = await app.prisma.property.findFirst({ 
      where: { id, companyId: activeCompanyId } 
    });
    
    if (!property) return reply.status(404).send({ error: 'Property not found' });

    await app.prisma.property.delete({ where: { id } });
    return reply.status(204).send();
  });
}
