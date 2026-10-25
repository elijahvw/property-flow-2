import { setTelemetrySession } from "./browser-telemetry";
let csrfToken = "";
let impersonationContext = "";
export const setImpersonationContext = (value: string) => {
  impersonationContext = value;
  setTelemetrySession(csrfToken, value);
};
export const setCsrfToken = (value: string) => {
  csrfToken = value;
  setTelemetrySession(value, impersonationContext);
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public submissionUncertain = false,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number; expectedCompanyId?: string } = {},
): Promise<T> {
  if (!path.startsWith("/api/"))
    throw new Error("Only same-origin API paths are allowed");
  if (options.expectedCompanyId !== undefined && (typeof options.expectedCompanyId !== "string" || !/^[\x21-\x7e]{1,200}$/.test(options.expectedCompanyId)))
    throw new Error("A current company is required before continuing.");
  const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  const context = impersonationContext;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(cancel, options.timeoutMs ?? 10000);
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Impersonation-ID": context,
        ...(options.expectedCompanyId !== undefined
          ? { "X-Company-ID": options.expectedCompanyId }
          : {}),
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.method && options.method !== "GET"
          ? { "X-CSRF-Token": csrfToken }
          : {}),
      },
      body: requestBody,
    });
    const data = await response.json();
    if (data?.code === "IMPERSONATION_CONTEXT_CHANGED" ||
      (path !== "/api/bootstrap" && context !== impersonationContext)) {
      window.dispatchEvent(new Event("impersonation-context-changed"));
      throw new ApiError("Your support session changed. Reloading your workspace…", 409, "IMPERSONATION_CONTEXT_CHANGED", !!options.method && options.method !== "GET");
    }
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("session-expired"));
      throw new ApiError(
        typeof data.error === "string" ? data.error : "Request failed.",
        response.status,
        data.code || "REQUEST_FAILED",
        !!options.method && options.method !== "GET" && response.status >= 500,
      );
    }
    return data;
  } catch (error) {
    if (options.method && options.method !== "GET" && !(error instanceof ApiError))
      throw new ApiError(error instanceof Error ? error.message : "The request was interrupted.", 0, "SUBMISSION_UNCERTAIN", true);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
