import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import jwksClient from 'jwks-rsa';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from './routes';

const prisma = new PrismaClient();

const buildApp = async () => {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const cognitoRegion = process.env.AWS_REGION || 'us-east-1';
  const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;
  const cognitoDomain = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}`;

  const client = jwksClient({
    jwksUri: `${cognitoDomain}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true,
  });

  await app.register(jwt, {
    secret: async (_request, token) => {
      const header = (token as any).header;
      const key = await client.getSigningKey(header.kid);
      return key.getPublicKey();
    },
    verify: {
      issuer: cognitoDomain,
    },
  });

  app.decorate('prisma', prisma);

  registerRoutes(app);

  return app;
};

const start = async () => {
  const app = await buildApp();
  const port = parseInt(process.env.API_PORT || '3001', 10);

  try {
    await app.listen({ port, host: 'localhost' });
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
