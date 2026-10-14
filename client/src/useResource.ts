import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import { startOperation } from "./operations";

export function useResource<T>(url: string) {
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
    const controller = new AbortController();
    setResult({ key });
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
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load this page.",
          });
        }
      });
    return () => {
      controller.abort();
      operation.abandon();
    };
  }, [url, key, revision]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : undefined,
    reload: () => setRevision((v) => v + 1),
  };
}
