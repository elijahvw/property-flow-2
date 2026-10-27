import { invitationMailer } from "./invitation-email.js";
import { registerRentBillingWorker } from "./rent-billing-worker.js";
import fastify from "fastify";
import {
  registerTelemetry,
  recordRequestError,
  shutdownTelemetry,
} from "./tracing.js";
import { registerBrowserTelemetry } from "./browser-telemetry.js";
import dotenv from "dotenv";
import { prisma } from "./lib/prisma.js";
import { registerSessions, readAuthConfig } from "./sessions.js";
import { MAX_USER_ID_BYTES, registerApplication } from "./application.js";
import { identityProvider } from "./identity-provider.js";
import { registerRequestErrors } from "./request-errors.js";
import { installApiDocumentation, registerApiDocumentationRoutes } from "./api-documentation.js";
import { apiContractForRoute, apiDocumentTransform } from "./api-contracts.js";
import { registerHealth } from "./health.js";

dotenv.config();
const server = fastify({
  bodyLimit: 65536,
  routerOptions: { maxParamLength: MAX_USER_ID_BYTES },
  logger: {
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers.set-cookie",
    ],
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url?.split("?")[0],
        id: request.id,
      }),
    },
  },
});
registerRequestErrors(server, recordRequestError);
registerTelemetry(server);
const config = readAuthConfig();
await installApiDocumentation(server, {
  contractForRoute: apiContractForRoute,
  transformObject: document => apiDocumentTransform(document, config.secure),
  sessionCookieName: config.secure ? "__Host-pf-session" : "pf-session",
});
registerHealth(server, prisma);
const authenticate = await registerSessions(server, prisma, config);
await registerApiDocumentationRoutes(server, authenticate);
registerBrowserTelemetry(server, authenticate);
registerApplication(
  server,
  prisma,
  authenticate,
  config.origin,
  identityProvider(),
  { invitationMailer: invitationMailer() },
);
registerRentBillingWorker(server, prisma);
server.setNotFoundHandler((_request, reply) =>
  reply.code(404).send({ error: "Not found", code: "NOT_FOUND" }),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  await server.close();
  await prisma.$disconnect();
  await shutdownTelemetry().catch(() =>
    server.log.warn(
      { code: "TELEMETRY_SHUTDOWN_FAILED" },
      "Monitoring flush failed",
    ),
  );
  clearTimeout(deadline);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
await server.listen({ port: 5011, host: "0.0.0.0" });
