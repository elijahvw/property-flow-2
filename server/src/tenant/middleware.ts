import { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    companyId?: string;
    userId?: string;
    dbUser?: any;
  }
}

export async function resolveTenant(request: FastifyRequest, reply: FastifyReply) {
  const user = request.dbUser;
  if (!user) return;

  request.userId = user.id;

  const companyIdHeader = request.headers['x-company-id'] as string;
  
  if (companyIdHeader) {
    const membership = user.companies.find((c: any) => c.companyId === companyIdHeader);
    if (membership) {
      request.companyId = companyIdHeader;
      return;
    }
  }

  // Fallback: If user only belongs to one company, use that
  if (user.companies.length === 1) {
    request.companyId = user.companies[0].companyId;
  }
}
