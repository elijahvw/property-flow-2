import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import { AccessError } from "./access.js";
import { IdentityProviderError } from "./identity-provider.js";

// Framework input failures (including JSON parsing and content type checks) are
// client errors. Keep their HTTP status without exposing parser or driver text.
export function registerRequestErrors(
  server: FastifyInstance,
  onServerError: (request: FastifyRequest, code: string, name: string) => void = () => {},
) {
  server.setErrorHandler((failure, request, reply) => {
    const error = (
      failure instanceof Error ? failure : new Error("REQUEST_FAILED")
    ) as FastifyError;
    const code = error.code;
    const status =
      error instanceof AccessError
        ? error.statusCode
        : Number.isInteger(error.statusCode) && error.statusCode! >= 400 && error.statusCode! < 500
          ? error.statusCode!
          : code === "P2025"
            ? 404
            : ["P2002", "P2034"].includes(code)
              ? 409
              : error.validation
                ? 400
                : 503;
    const messages: Record<number, string> = {
      400: "Check the submitted fields and try again.",
      401: "Sign in to continue.",
      403: "You do not have access to this action.",
      404: "Record not found.",
      409: "The record changed or conflicts with an existing record. Refresh and try again.",
      413: "The request is too large. Reduce its size and try again.",
      415: "Submit the request using a supported content type.",
      429: "Too many requests. Please wait a minute and try again.",
    };
    const message = error instanceof AccessError
      ? error.message
      : messages[status] ?? (status < 500
        ? "Check the request and try again."
        : "The service is temporarily unavailable. Please try again.");
    const safeCode = error instanceof AccessError ? error.code : `REQUEST_${status}`;
    const safeFrames = (error.stack || "")
      .split("\n")
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 12)
      .join("\n");
    request.log.warn(
      {
        code: safeCode,
        errorType: error.name,
        status,
        requestId: request.id,
        ...(error instanceof IdentityProviderError ? {
          providerOperation: error.operation,
          providerFailure: error.failure,
          ...(error.rateSource !== undefined ? { providerRateSource: error.rateSource } : {}),
          ...(error.upstreamStatus !== undefined ? { providerStatus: error.upstreamStatus } : {}),
          ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        } : {}),
        ...(status >= 500 ? { stack: safeFrames } : {}),
      },
      "Request failed",
    );
    if (status >= 500) onServerError(request, safeCode, error.name);
    if (error instanceof IdentityProviderError && status === 429 && error.retryAfterSeconds) reply.header("Retry-After", String(error.retryAfterSeconds));
    reply.status(status).send({ error: message, code: safeCode, requestId: request.id });
  });
}
