import { useEffect, useRef, useState } from "react";
import { api } from "./api";

type Conflict = { id: string; email: string; message: string };
type SyncPage = {
  nextPage: number | null;
  conflicts: Conflict[];
  limited: boolean;
};

export function useUserDirectory(reload: () => void) {
  const onSynced = useRef(reload);
  onSynced.current = reload;
  const run = useRef<(email?: string) => void>(() => {});
  const [state, setState] = useState({
    syncing: true,
    error: "",
    limited: false,
    conflicts: [] as Conflict[],
  });
  useEffect(() => {
    let disposed = false,
      busy = false,
      controller: AbortController | undefined;
    async function sync(email?: string) {
      if (disposed || busy) return;
      busy = true;
      controller = new AbortController();
      setState((previous) => ({ ...previous, syncing: true, error: "" }));
      const conflicts: Conflict[] = [];
      let limited = false;
      try {
        let page: number | null = 0;
        while (page !== null) {
          const result: SyncPage = await api<SyncPage>(
            "/api/platform/users/sync",
            {
              method: "POST",
              body: { page, ...(email ? { email } : {}) },
              signal: controller.signal,
            },
          );
          if (disposed) return;
          conflicts.push(...result.conflicts);
          limited ||= result.limited;
          if (
            result.nextPage !== null &&
            (result.nextPage !== page + 1 || result.nextPage > 19)
          )
            throw new Error("The user directory returned an invalid page.");
          page = result.nextPage;
        }
        if (!disposed)
          setState({ syncing: false, error: "", limited, conflicts });
      } catch (error) {
        if (!disposed)
          setState({
            syncing: false,
            limited,
            conflicts,
            error:
              error instanceof Error
                ? error.message
                : "Unable to check for new accounts.",
          });
      } finally {
        busy = false;
        if (!disposed) onSynced.current();
      }
    }
    run.current = (email) => {
      void sync(email);
    };
    const focus = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(focus, 60000);
    void sync();
    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.clearInterval(timer);
    };
  }, []);
  return { ...state, refresh: (email?: string) => run.current(email) };
}
