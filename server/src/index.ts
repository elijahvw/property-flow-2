import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from './routes';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

export const buildApp = async () => {
  const app = Fastify({ 
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });

  app.decorate('prisma', prisma);
  registerRoutes(app);

  return app;
};

const start = async () => {
  try {
    const app = await buildApp();
    const port = parseInt(process.env.API_PORT || '3001', 10);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Server successfully running on port ${port}`);
  } catch (err) {
    console.error('FAILED TO START SERVER:', err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start();
}
