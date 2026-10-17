const names: Record<string, string> = {
  PR: "Proration review", LH: "Lease change", LT: "Lease term change", ST: "Settlement review", LM: "Money movement", MR: "Movement correction", RC: "Charge",
  TX: "Transaction",
  CN: "Credit note",
  CR: "Credit reversal",
  DA: "Deposit",
  DR: "Deposit receipt",
};
export function recordReference(value: string) {
  const match = /^([A-Z]+)-(\d+)$/.exec(value);
  return match && names[match[1]] ? `${names[match[1]]} #${match[2]}` : value;
}
