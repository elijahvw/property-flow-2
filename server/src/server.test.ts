import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './index';
import { FastifyInstance } from 'fastify';

describe('Server Initialization', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should have prisma decorator', () => {
    expect(app.prisma).toBeDefined();
  });

  it('should respond to health check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });

  it('should respond to version check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/version'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.version).toBeDefined();
  });
});
