import swagger from "@fastify/swagger";
import type { SwaggerTransformObject } from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema, preValidationHookHandler } from "fastify";
import { AccessError, requirePermission } from "./access.js";

export const API_DOCUMENTATION_PREFIX = "/api/docs";
export type RegisteredApiRoute = Readonly<{ method: string; path: string }>;
type ApiDocument = ReturnType<SwaggerTransformObject>;
export type ApiDocumentationOptions = {
  contractForRoute: (method: string, path: string) => FastifySchema | undefined;
  sessionCookieName?: "__Host-pf-session" | "pf-session";
  transformObject?: (document: ApiDocument) => ApiDocument;
};

/** Install before any route registrar, so the inventory includes the full server. */
export async function installApiDocumentation(server: FastifyInstance, options: ApiDocumentationOptions) {
  const routes = new Map<string, RegisteredApiRoute>();
  server.addHook("onRoute", route => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      const entry = Object.freeze({ method: method.toUpperCase(), path: route.url });
      routes.set(`${entry.method} ${entry.path}`, entry);
    }
  });
  await server.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Property Flow API",
        version: "1.0.0",
        description: "Internal API reference. Sign in with platform owner access in your own account. " +
          "The explorer is read-only; use the application workflows for reviews, writes and safe recovery. " +
          "Operation descriptions distinguish verified field contracts from documented gaps.",
      },
      servers: [{ url: "/", description: "This application origin" }],
      components: { securitySchemes: {
        sessionCookie: {
          type: "apiKey", in: "cookie", name: options.sessionCookieName ?? "__Host-pf-session",
          description: "Existing HttpOnly application session. Sign in through the application; the reference does not collect credentials or execute business operations.",
        },
      } },
    },
    transform: ({ url, route }) => {
      // These schemas belong only to the reference. Assigning them to
      // route.schema would change existing validation and response serialization.
      if (url === API_DOCUMENTATION_PREFIX || url.startsWith(`${API_DOCUMENTATION_PREFIX}/`))
        return { schema: { hide: true }, url };
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      const method = methods.find(value => value !== "HEAD") ?? methods[0];
      const contract = options.contractForRoute(method.toUpperCase(), url);
      if (!contract) return { schema: { hide: true }, url };
      const schema = structuredClone(contract) as FastifySchema & Record<string, unknown>;
      for (const part of ["querystring", "params", "headers"] as const) {
        const container = schema[part] as Record<string, unknown> | undefined;
        if (container?.type !== "object" || container.properties !== undefined ||
            ["$ref", "oneOf", "anyOf", "allOf"].some(key => container[key] !== undefined)) continue;
        // Swagger otherwise treats root keywords as shorthand parameter names.
        // Normalize only this documentation clone; keep ignored inputs/runtime
        // behavior intact and let references/compositions use normal resolution.
        container.properties = {};
        if (part === "querystring" && typeof container.description === "string")
          schema["x-pf-query-policy"] ??= container.description;
      }
      return { schema, url };
    },
    ...(options.transformObject ? {
      transformObject: (document: Parameters<SwaggerTransformObject>[0]) =>
        options.transformObject!("openapiObject" in document ? document.openapiObject : document.swaggerObject),
    } : {}),
  });
  return {
    registeredRoutes: (): readonly RegisteredApiRoute[] => [...routes.values()]
      .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)),
  };
}

/** Register after sessions, using the same fresh server-side authentication. */
export async function registerApiDocumentationRoutes(server: FastifyInstance, authenticate: preValidationHookHandler) {
  await server.register(async documentation => {
    // A scope hook protects bundled assets as well as JSON/YAML/UI/redirects.
    // Swagger UI's uiHooks alone do not protect @fastify/static's routes.
    documentation.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("X-Frame-Options", "DENY");
      await (authenticate as (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>).call(documentation, request, reply);
      if (reply.sent) return;
      if (request.impersonation || request.appSession?.impersonatedUserId)
        throw new AccessError(403, "DOCUMENTATION_ACCESS_DENIED", "Return to your own account to view API documentation.");
      if (!request.principal)
        throw new AccessError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
      requirePermission(request.principal, "platform.manage");
    });
    // Static responses otherwise add their own cache policy after onRequest.
    documentation.addHook("onSend", async (request, reply, payload) => {
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
      // Static assets register explicit HEAD routes. Suppress payloads for
      // their early authorization errors as well as successful HEAD reads.
      return request.method === "HEAD" ? "" : payload;
    });
    const uiConfig = {
      layout: "BaseLayout",
      docExpansion: "none" as const,
      deepLinking: true,
      filter: true,
      displayOperationId: true,
      showExtensions: true,
      supportedSubmitMethods: [],
      tryItOutEnabled: false,
      persistAuthorization: false,
      queryConfigEnabled: false,
      validatorUrl: null,
      // Serialized by the plugin and executed in the browser; keep self-contained.
      requestInterceptor: function (request: Record<string, any>) {
        const url = new URL(request.url, window.location.origin);
        if (url.origin !== window.location.origin || url.pathname !== "/api/docs/json" ||
            (request.method ?? "GET").toUpperCase() !== "GET")
          throw new Error("The API reference only loads its same-origin specification.");
        request.credentials = "same-origin";
        return request;
      },
    };
    await documentation.register(swaggerUi, {
      routePrefix: API_DOCUMENTATION_PREFIX,
      validatorUrl: false,
      uiConfig,
      theme: { title: "Property Flow API reference" },
      staticCSP: true,
      transformStaticCSP: header => header
        .replace("font-src 'self' https: data:", "font-src 'self'")
        .replace("img-src 'self' data: validator.swagger.io", "img-src 'self' data:")
        .replace("style-src 'self' https:", "style-src 'self'")
        .replace("frame-ancestors 'self'", "frame-ancestors 'none'")
        .replace("upgrade-insecure-requests;", "") + " connect-src 'self'; form-action 'none';",
    });
  });
}
