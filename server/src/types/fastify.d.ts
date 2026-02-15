import { PrismaClient, User, CompanyUser, Company } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    dbUser: User & {
      companies: (CompanyUser & {
        company: Company;
      })[];
    };
  }
}
