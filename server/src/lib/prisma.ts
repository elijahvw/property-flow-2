import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const isProduction = process.env.NODE_ENV === 'production';

function withRequiredSslMode(databaseUrl?: string): string | undefined {
  if (!databaseUrl || !isProduction) {
    return databaseUrl;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.set('sslmode', 'require');
    return parsedUrl.toString();
  } catch {
    const separator = databaseUrl.includes('?') ? '&' : '?';
    return databaseUrl.includes('sslmode=')
      ? databaseUrl.replace(/sslmode=[^&]*/i, 'sslmode=require')
      : `${databaseUrl}${separator}sslmode=require`;
  }
}

const poolConfig: ConstructorParameters<typeof Pool>[0] = {
  connectionString: withRequiredSslMode(process.env.DATABASE_URL),
};

if (isProduction) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
