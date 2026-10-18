import { setTelemetrySession } from "./browser-telemetry";
let csrfToken = "";
export const setCsrfToken = (value: string) => {
  csrfToken = value;
  setTelemetrySession(value);
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
  options: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  if (!path.startsWith("/api/"))
    throw new Error("Only same-origin API paths are allowed");
  const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body);
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
