import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@prisma/client';

export function checkRole(roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).dbUser;
    
    if (!user) {
      return reply.status(401).send({ error: 'User context not found' });
    }

    // Always allow PLATFORM_ADMIN
    const isPlatformAdmin = user.companies.some((cu: any) => cu.role === 'PLATFORM_ADMIN');
    if (isPlatformAdmin) return;

    const body = request.body as any;
    const params = request.params as any;
    
    // Attempt to find companyId context from request
    // Common patterns: /api/companies/:id, { companyId: "..." } in body, req.companyId from tenant middleware, etc.
    const companyId = (request as any).companyId || (request as any).inferredCompanyId || body?.companyId || params?.companyId || (request.url.includes('/api/companies/') ? params?.id : null);

    if (!companyId) {
      // If no specific company context is found in the request, 
      // check if the user has the required role in at least one company they belong to.
      const hasRoleInAny = user.companies.some((cu: any) => roles.includes(cu.role));
      if (!hasRoleInAny) {
        return reply.status(403).send({ error: `Access denied: Requires one of [${roles.join(', ')}]` });
      }
      return;
    }

    // Specific company context check
    const membership = user.companies.find((cu: any) => cu.companyId === companyId);

    if (!membership || !roles.includes(membership.role)) {
      return reply.status(403).send({ error: 'Access denied: Insufficient permissions for this company' });
    }
  };
}
