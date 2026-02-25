import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'],
    datasource: {
      url: process.env.DATABASE_URL,
    },
  } as any);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
