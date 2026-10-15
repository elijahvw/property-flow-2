import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useAuth } from "./context/AuthContext";
import { startOperation } from "./operations";

export function useResource<T>(
  url: string,
  keepPreviousData = false,
  refreshWhenVisible = false,
) {
  const { data: auth } = useAuth();
  const scope = `${auth?.user.id}:${auth?.user.status}:${auth?.membership?.companyId}:${auth?.membership?.version}:${auth?.permissions.join(",")}`;
  const key = `${scope}:${url}`;
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>({ key });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!refreshWhenVisible) return;
    let lastRefresh = 0;
    const refresh = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastRefresh < 250
      )
        return;
      lastRefresh = Date.now();
      setRevision((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [key, refreshWhenVisible]);
  useEffect(() => {
    const controller = new AbortController();
    setResult((previous) => ({
      key,
      ...(keepPreviousData && previous.key === key
        ? { data: previous.data }
        : {}),
    }));
    const operation = startOperation(
      url === "/api/platform/users"
        ? "admin.users.load"
        : url === "/api/platform/companies"
          ? "admin.companies.load"
          : "page.data.load",
    );
    void api<T>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          operation.succeed();
          setResult({ key, data });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          operation.fail(error);
          setResult((previous) => ({
            key,
            ...(keepPreviousData &&
            previous.key === key &&
            !(
              error instanceof ApiError &&
              [401, 403, 404].includes(error.status)
            )
              ? { data: previous.data }
              : {}),
            error:
              error instanceof Error
                ? error.message
                : "Unable to load this page.",
          }));
        }
      });
    return () => {
      controller.abort();
      operation.abandon();
    };
  }, [url, key, revision, keepPreviousData]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : undefined,
    reload: () => setRevision((v) => v + 1),
  };
}
