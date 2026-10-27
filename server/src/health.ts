import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

/** The existing process/readiness protocols, separately testable from startup. */
export function registerHealth(server: FastifyInstance, db: Pick<PrismaClient, "$queryRaw">) {
  server.get("/", async () => ({ status: "ok" }));
  server.get("/api/health", async () => ({ status: "ok" }));
  server.get("/api/ready", async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", db: "connected" };
  });
}
