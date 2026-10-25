import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { AccessError } from "./access.js";
import type { DemoIdentity } from "./identity-provider.js";

export const DEMO_PEOPLE = [
  ["owner", "Owner", "Oak & Elm · DEMO Owner"],
  ["manager", "Manager", "Alex Parker · DEMO Manager"],
  ["staff", "Staff technician", "Sam Ellis · DEMO Technician"],
  ["resident", "Resident / leaseholder", "Jordan Rivera · DEMO"],
  ["resident2", "Resident / leaseholder", "Taylor Morgan · DEMO"],
  ["resident3", "Resident / leaseholder", "Casey Chen · DEMO"],
  ["resident4", "Resident / leaseholder", "Avery Brooks · DEMO"],
  ["occupant", "Occupant (no finances)", "Riley Rivera · DEMO"],
  ["offline", "Tenant without portal access", "Jamie Wells · DEMO offline tenant"],
  ["pending", "Tenant with pending invitation", "Drew Patel · DEMO invitation pending"],
  ["former", "Former tenant", "Robin Lane · DEMO former tenant"],
] as const;
export type DemoCredential = DemoIdentity & { role: string; login: boolean };
export function newDemoCredentials(id: string): DemoCredential[] {
  return DEMO_PEOPLE.map(([accountKey, role, name]) => ({ demoId: id, accountKey, role, name, login: !["offline", "pending", "former"].includes(accountKey), email: `${accountKey}.${id}@sales-demo.invalid`, password: randomBytes(30).toString("base64url") + "aA1!" }));
}
function encryptionKey(secret: string) {
  if (!secret) throw new AccessError(503, "DEMO_CREDENTIALS_UNAVAILABLE", "Demo credential protection is not configured.");
  return Buffer.from(hkdfSync("sha256", secret, "propertyflow", "sales-demo-credentials-v1", 32));
}
export function sealDemoCredentials(id: string, credentials: DemoCredential[], secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function openDemoCredentials(id: string, sealed: string, secret: string): DemoCredential[] {
  try {
    const [format, iv, tag, data] = sealed.split(".");
    if (format !== "v1") throw Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
  } catch { throw new AccessError(503, "DEMO_CREDENTIALS_UNAVAILABLE", "Demo credentials could not be opened. Restore the original application secret or tear down this setup and build a new demo."); }
}
