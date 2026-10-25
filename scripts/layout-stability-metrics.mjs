// CLS is the largest bounded session window, not the sum for an entire visit.
// Keep original monotonic timestamps; rounding can change boundary membership.
export function summarizeLayoutShifts(shifts) {
  const eligible = shifts.filter(shift => !shift.hadRecentInput);
  let maximum = 0, windowValue = 0, started = 0, last = 0;
  for (const shift of eligible) {
    if (windowValue > 0 && shift.at - last < 1000 && shift.at - started < 5000) windowValue += shift.value;
    else { started = shift.at; windowValue = shift.value; }
    last = shift.at;
    maximum = Math.max(maximum, windowValue);
  }
  return { cls: maximum, totalShiftValue: eligible.reduce((sum, shift) => sum + shift.value, 0), eligibleShiftCount: eligible.length, excludedRecentInputCount: shifts.length - eligible.length };
}
