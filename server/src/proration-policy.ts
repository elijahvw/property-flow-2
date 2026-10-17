import { AccessError } from "./access.js";
import { isoDay, monthStart, nextMonth, installment } from "./billing-dates.js";
import type { PaymentTerms } from "./lease-term-policy.js";
// Integer-only cents; round the final fraction once, half up. Dates are UTC
// calendar labels selected using the company's business date, never elapsed local hours.
export function calendarProration(
  startsOn: Date,
  endsOn: Date | null,
  periodOn: Date,
  monthlyCents: number,
) {
  const first = monthStart(periodOn),
    next = nextMonth(first),
    last = new Date(+next - 86400000);
  if (
    +first !== +periodOn ||
    first < monthStart(startsOn) ||
    (endsOn && first > monthStart(endsOn))
  )
    throw new AccessError(
      400,
      "PRORATION_PERIOD",
      "Choose a calendar rent month inside this lease.",
    );
  const from = new Date(Math.max(+first, +startsOn)),
    through = new Date(Math.min(+last, +(endsOn ?? last))),
    days = Math.round((+through - +from) / 86400000) + 1,
    daysInMonth = last.getUTCDate();
  const numerator = BigInt(monthlyCents) * BigInt(days),
    denominator = BigInt(daysInMonth),
    amountCents = Number((numerator * 2n + denominator) / (denominator * 2n));
  return {
    policy: "actual_calendar_month" as const,
    periodOn: isoDay(first),
    fromOn: isoDay(from),
    throughOn: isoDay(through),
    throughExclusiveOn: isoDay(new Date(+through + 86400000)),
    days,
    daysInMonth,
    monthlyCents,
    calculatedCents: amountCents,
    partial: days !== daysInMonth,
    rounding:
      "Nearest cent, half up; round once after multiplying monthly rent by included days / calendar days.",
  };
}
export function rentMonthDue(terms: PaymentTerms, period: Date) {
  return installment(
    {
      firstPeriodOn: period,
      lastPeriodOn: null,
      firstDueOn: null,
      firstAmountCents: null,
      lastAmountCents: null,
      amountCents: terms.rentCents,
      dueDay: terms.rentDueDay,
      leadDays: 0,
    },
    period,
  ).dueOn;
}
