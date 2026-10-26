import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { recordBrowserOperation } from "./tracing.js";
// Closed vocabulary: names are product operations, never page paths or user input.
export const browserOperations = [
  "sales_demo.create", "sales_demo.teardown", "sales_demo.credentials",
  "draft.save", "draft.delete", "application.save", "application.review", "application.convert", "prospect.followup", "availability.listing", "document.shared.received",
  "availability.update", "unit.import.preview", "unit.import.commit", "unit.import.cancel",
  "prospect.create", "prospect.update", "prospect.stage", "prospect.convert",
  "document.share", "document.revoke", "document.shared.download",
  "expense.import.preview", "expense.import.commit", "expense.import.cancel",
  "plan.publish", "plan.availability", "subscription.update", "subscription.invoice.issue", "subscription.invoice.void", "subscription.payment.record", "subscription.payment.reverse",
  "impersonation.start", "impersonation.stop", "impersonation.support.update",
  "notification.state", "notification.preferences", "agreement.save", "agreement.review",
  "inspection.save", "inspection.review",
  "document.upload", "document.scan", "document.download", "document.archive",
  "deposit.setup",
  "deposit.update",
  "deposit.receipt",
  "deposit.void",
  "rent.charge",
  "rent.payment",
  "rent.void",
  "user.provision",
  "account.verification",
  "finance.create",
  "finance.void",
  "unit.create",
  "unit.update",
  "lease.create",
  "lease.update",
  "preventive.save",
  "preventive.occurrence",
  "vendor.save",
  "maintenance.vendor",
  "maintenance.work",
  "maintenance.create",
  "maintenance.status",
  "maintenance.update",
  "maintenance.reply",
  "maintenance.cost.link",
  "maintenance.cost.unlink",
  "page.data.load",
  "auth.session.restore",
  "auth.profile.load",
  "admin.users.load",
  "admin.companies.load",
  "account.update",
  "account.status",
  "invitation.create",
  "invitation.accept",
  "invitation.send",
  "onboarding.update",
  "membership.update",
  "ownership.transfer",
  "property.create",
  "property.update",
  "company.delete",
  "company.create",
  "company.details.load",
  "company.update",
  "company.user.assign",
  "browser.error",
  "browser.unhandledrejection",
  "browser.render",
];
export function registerBrowserTelemetry(
  server: FastifyInstance,
  authenticate: preValidationHookHandler,
) {
  server.post<{
    Body: { events: { name: string; outcome: string; duration: number }[] };
  }>(
    "/api/telemetry",
    {
      preValidation: authenticate,
      bodyLimit: 8192,
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (request: any) => request.principal?.id || request.ip,
        },
      },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["events"],
          properties: {
            events: {
              type: "array",
              minItems: 1,
              maxItems: 16,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "outcome", "duration"],
                properties: {
                  name: { type: "string", enum: browserOperations },
                  outcome: {
                    type: "string",
                    enum: ["success", "error", "abandoned", "other"],
                  },
                  duration: { type: "number", minimum: 0, maximum: 120000 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      for (const event of request.body.events) recordBrowserOperation(event);
      return reply.code(204).send();
    },
  );
}
