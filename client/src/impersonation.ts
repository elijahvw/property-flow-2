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
