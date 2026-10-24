type EventRow = { name: string; outcome: string; duration: number };
let csrf = "";
let impersonationContext = "";
let queue: EventRow[] = [];
let sending = false;
let timer: ReturnType<typeof setInterval> | undefined;
export function setTelemetrySession(token: string, context = "") {
  csrf = token;
  impersonationContext = context;
  if (!csrf) {
    queue = [];
    if (timer) clearInterval(timer);
    timer = undefined;
  } else if (!timer) timer = setInterval(() => void flushTelemetry(), 15000);
}
export function recordBrowserEvent(
  name: string,
  outcome = "error",
  duration = 0,
) {
  if (!csrf || queue.length >= 64) return;
  queue.push({
    name,
    outcome,
    duration: Math.max(0, Math.min(120000, Math.round(duration))),
  });
}
export async function flushTelemetry() {
  if (!csrf || sending || !queue.length) return;
  sending = true;
  const events = queue.splice(0, 16);
  try {
    // Intentionally bypass api(): no session-expiry events, retries or telemetry recursion.
    await fetch("/api/telemetry", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "X-Impersonation-ID": impersonationContext },
      body: JSON.stringify({ events }),
    });
  } catch {
    /* Monitoring outages never block or retry a business operation. */
  } finally {
    sending = false;
  }
}
export function registerBrowserErrors() {
  window.addEventListener("error", () => recordBrowserEvent("browser.error"));
  window.addEventListener("unhandledrejection", () =>
    recordBrowserEvent("browser.unhandledrejection"),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushTelemetry();
  });
}
