import { FastifyRequest, FastifyReply } from 'fastify';

export async function resolveTenant(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).dbUser;
  if (!user) return;

  const companyIdHeader = request.headers['x-company-id'] as string;
  
  if (companyIdHeader) {
    const membership = user.companies.find((c: any) => c.companyId === companyIdHeader);
    if (membership) {
      (request as any).companyId = companyIdHeader;
      return;
    }
  }

  // Fallback: If user only belongs to one company, use that
  if (user.companies.length === 1) {
    (request as any).companyId = user.companies[0].companyId;
  }
}
