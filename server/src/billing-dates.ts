export function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}
export function nextMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}
export function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}
export function installment(
  schedule: {
    firstPeriodOn: Date;
    lastPeriodOn: Date | null;
    firstDueOn: Date | null;
    dueDay: number;
    leadDays: number;
    amountCents: number;
    firstAmountCents: number | null;
    lastAmountCents: number | null;
  },
  periodOn: Date,
) {
  const first = +periodOn === +schedule.firstPeriodOn,
    last =
      schedule.lastPeriodOn !== null && +periodOn === +schedule.lastPeriodOn;
  const end = new Date(
    Date.UTC(periodOn.getUTCFullYear(), periodOn.getUTCMonth() + 1, 0),
  );
  const dueOn =
    first && schedule.firstDueOn
      ? new Date(schedule.firstDueOn)
      : new Date(
          Date.UTC(
            periodOn.getUTCFullYear(),
            periodOn.getUTCMonth(),
            Math.min(schedule.dueDay, end.getUTCDate()),
          ),
        );
  const postOn = new Date(dueOn);
  postOn.setUTCDate(postOn.getUTCDate() - schedule.leadDays);
  const amountCents =
    first && schedule.firstAmountCents !== null
      ? schedule.firstAmountCents
      : last && schedule.lastAmountCents !== null
        ? schedule.lastAmountCents
        : schedule.amountCents;
  return { periodOn, dueOn, postOn, amountCents };
}
