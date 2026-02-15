import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

export async function resolveUser(this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  const { sub, email, name } = request.user as { sub: string, email: string, name?: string };

  let user = await this.prisma.user.findUnique({
    where: { id: sub },
    include: {
      companies: {
        include: {
          company: true
        }
      }
    }
  });

  if (!user) {
    // Optionally auto-create user on first login
    // For now, assume users are provisioned or created here
    user = await this.prisma.user.create({
      data: {
        id: sub,
        email: email,
        name: name || email.split('@')[0],
      },
      include: {
        companies: {
          include: {
            company: true
          }
        }
      }
    });
  }

  (request as any).dbUser = user;
}
