import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const isProduction = process.env.NODE_ENV === 'production';

function withNoVerifySslMode(databaseUrl?: string): string | undefined {
  if (!databaseUrl || !isProduction) {
    return databaseUrl;
  }

  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    return databaseUrl;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.set('sslmode', 'no-verify');
    return parsedUrl.toString();
  } catch {
    const separator = databaseUrl.includes('?') ? '&' : '?';
    return databaseUrl.includes('sslmode=')
      ? databaseUrl.replace(/sslmode=[^&]*/i, 'sslmode=no-verify')
      : `${databaseUrl}${separator}sslmode=no-verify`;
  }
}

const pool = new Pool({
  connectionString: withNoVerifySslMode(process.env.DATABASE_URL),
});
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
