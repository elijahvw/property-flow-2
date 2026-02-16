import { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (!process.env.COGNITO_USER_POOL_ID) {
    // Mock authentication for local dev if no Cognito config
    (request as any).user = {
      sub: 'b4d80438-3001-70e6-f642-0d2bce3b7f7e', // Matches admin@test.com in seed.ts
      email: 'admin@test.com',
      name: 'System Admin'
    };
    return;
  }
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}
