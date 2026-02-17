import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import jwksClient from 'jwks-rsa';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from './routes';
import dotenv from 'dotenv';

dotenv.config();

console.log('Starting server with environment:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.API_PORT || '3001',
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  HAS_COGNITO_POOL: !!process.env.COGNITO_USER_POOL_ID,
  HAS_DATABASE_URL: !!process.env.DATABASE_URL
});

const prisma = new PrismaClient();

export const buildApp = async () => {
  const app = Fastify({ 
    logger: true,
    disableRequestLogging: false 
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const cognitoRegion = process.env.AWS_REGION || 'us-east-1';
  const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;

  if (!cognitoUserPoolId) {
    app.log.warn('COGNITO_USER_POOL_ID is not set. Auth might fail.');
  }

  const cognitoDomain = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}`;

  const client = jwksClient({
    jwksUri: `${cognitoDomain}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true,
  });

  await app.register(jwt, {
    secret: async (_request: any, token: any) => {
      const header = (token as any).header;
      const key = await client.getSigningKey(header.kid);
      return key.getPublicKey();
    },
    verify: {
      allowedIss: [cognitoDomain],
    } as any,
  });

  app.decorate('prisma', prisma);

  registerRoutes(app);

  return app;
};

const start = async () => {
  console.log('Building app...');
  try {
    const app = await buildApp();
    const port = parseInt(process.env.API_PORT || '3001', 10);

    console.log(`Attempting to listen on port ${port}...`);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Server successfully running on port ${port}`);
  } catch (err) {
    console.error('FAILED TO START SERVER:', err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start().catch(err => {
    console.error('Unhandled error in start():', err);
    process.exit(1);
  });
}
