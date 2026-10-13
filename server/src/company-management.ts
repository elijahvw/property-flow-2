import type { FastifyInstance, preValidationHookHandler } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export function registerCompanyManagement(
  server: FastifyInstance,
  db: Pick<PrismaClient, 'company'>,
  preValidation: preValidationHookHandler[],
) {
  const params = { type: 'object', required: ['companyId'], properties: { companyId: { type: 'string', minLength: 1 } } };
  server.get<{ Params: { companyId: string } }>('/api/companies/:companyId', {
    preValidation, schema: { params },
  }, async (request, reply) => {
    if (request.dbUser?.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    const company = await db.company.findUnique({
      where: { id: request.params.companyId },
      include: {
        users: { select: { id: true, name: true, email: true, role: true }, orderBy: { email: 'asc' } },
        properties: { orderBy: { name: 'asc' } },
      },
    });
    if (!company) return reply.code(404).send({ error: 'Company not found' });
    return company;
  });

  server.patch<{ Params: { companyId: string }; Body: { name: string; domain: string | null } }>('/api/companies/:companyId', {
    preValidation,
    schema: {
      params,
      body: {
        type: 'object', required: ['name', 'domain'], additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          domain: { anyOf: [{ type: 'string', maxLength: 253 }, { type: 'null' }] },
        },
      },
    },
  }, async (request, reply) => {
    if (request.dbUser?.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    const name = request.body.name.trim();
    if (!name) return reply.code(400).send({ error: 'Company name is required' });
    const domain = request.body.domain?.trim().toLowerCase() || null;
    try {
      return await db.company.update({
        where: { id: request.params.companyId },
        data: { name, domain },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2025') return reply.code(404).send({ error: 'Company not found' });
      if (code === 'P2002') return reply.code(409).send({ error: 'That domain is already assigned to another company' });
      server.log.error({ err: error }, 'Company update failed');
      return reply.code(503).send({ error: 'Unable to save company. Please try again.' });
    }
  });
}
