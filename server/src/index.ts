import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from './routes';

const prisma = new PrismaClient();

const buildApp = async () => {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
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
