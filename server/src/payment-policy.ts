import { AccessError } from "./access.js";
import { boundedText } from "./operational.js";
export const paymentPolicyKeys = [
  "rentDueDay",
  "graceDays",
  "paymentInstructions",
];
export function paymentPolicyPatch(body: Record<string, unknown>) {
  const result: {
    rentDueDay?: number;
    graceDays?: number;
    paymentInstructions?: string | null;
  } = {};
  for (const [key, min, max] of [
    ["rentDueDay", 1, 31],
    ["graceDays", 0, 30],
  ] as const) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
      throw new AccessError(
        400,
        "INVALID_INPUT",
        `${key === "rentDueDay" ? "Rent due day" : "Grace period"} must be a whole number from ${min} to ${max}.`,
      );
    result[key] = Number(value);
  }
  if (Object.hasOwn(body, "paymentInstructions"))
    result.paymentInstructions =
      body.paymentInstructions === null || body.paymentInstructions === ""
        ? null
        : boundedText(body.paymentInstructions, 1000, "Payment instructions");
  return result;
}
export function chargeTiming(
  dueOn: Date,
  graceDays: number,
  today: string,
  remaining: bigint,
  voided = false,
) {
  const graceThrough = new Date(dueOn);
  graceThrough.setUTCDate(graceThrough.getUTCDate() + graceDays);
  const afterGrace = new Date(graceThrough);
  afterGrace.setUTCDate(afterGrace.getUTCDate() + 1);
  const due = dueOn.toISOString().split("T")[0],
    grace = graceThrough.toISOString().split("T")[0];
  const daysPastDue = Math.max(
    0,
    Math.floor(
      (new Date(today + "T00:00:00Z").getTime() - dueOn.getTime()) / 86400000,
    ),
  );
  const status = voided
    ? "voided"
    : remaining === 0n
      ? "paid"
      : due > today
        ? "upcoming"
        : due === today
          ? "due_today"
          : today <= grace
            ? "within_grace"
            : "past_grace";
  return {
    graceThrough: grace,
    afterGraceOn: afterGrace.toISOString().split("T")[0],
    daysPastDue: voided || remaining === 0n ? 0 : daysPastDue,
    collectionStatus: status,
  };
}
