export function impersonationRole(user: { platformRole?: string | null; membership?: { role: string } | null }) {
  const platform = user.platformRole === "owner" ? "Platform owner" : user.platformRole === "support" ? "Platform support" : null;
  const company = user.membership?.role ? roleLabel(user.membership.role) : null;
  return [platform, company].filter(Boolean).join(" · ") || "No role assigned";
}
export const roleLabel = (role: string) => ({ owner: "Company owner", manager: "Manager", staff: "Staff", resident: "Resident" } as Record<string, string>)[role] || role;
export const supportSessionSource = `${Date.now()}:${Math.random()}`;

// Clear open editors and loaded data whenever the effective account changes.
export function openSupportSession(destination: string) {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("property-flow-support-session");
    channel.postMessage({ source: supportSessionSource });
    channel.close();
  }
  window.location.assign(destination);
}
