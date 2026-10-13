import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

type AuthenticationInstance = FastifyInstance & {
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
};

export const authenticate = (instance: FastifyInstance) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    const verify = (instance as AuthenticationInstance).authenticate;
    if (typeof verify !== 'function') {
      instance.log.error('Authentication plugin not found');
      return reply.status(500).send({ error: 'Authentication service unavailable' });
    }

    // Auth0 verification returns a promise; Fastify must await it before
    // continuing to user synchronization and the protected handler.
    await verify.call(instance, request, reply);
  };
