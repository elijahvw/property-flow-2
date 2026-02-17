import { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    request.log.error({ err }, 'JWT Verification Failed');
    reply.status(401).send({ error: 'Unauthorized', details: (err as Error).message });
  }
}
