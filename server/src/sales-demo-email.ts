import { createHash } from "node:crypto";

const names: Record<string, string> = {
  owner: "owner", manager: "alex.parker", staff: "sam.ellis",
  resident: "jordan.rivera", resident2: "taylor.morgan", resident3: "casey.chen",
  resident4: "avery.brooks", occupant: "riley.rivera", offline: "jamie.wells",
  pending: "drew.patel", former: "robin.lane",
};

// Familiar email names, with a short generation domain for isolation. Provider
// ownership still requires the exact issuer/subject and generation marker.
export function demoEmail(id: string, accountKey: string): string {
  if (!names[accountKey]) throw new Error("Unknown demo account");
  const domain = createHash("sha256").update(id).digest("hex").slice(0, 10);
  return `${names[accountKey]}@oak-elm-${domain}.sales-demo.invalid`;
}
export function isDemoEmail(id: string, accountKey: string, email: string): boolean {
  return !!names[accountKey] && (email === demoEmail(id, accountKey) || email === `${accountKey}.${id}@sales-demo.invalid`);
}
