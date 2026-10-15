import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
const FeedbackContext = createContext<(message: string) => void>(() => {});
export const useFeedback = () => useContext(FeedbackContext);
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string; id: number }>();
  const notify = useCallback(
    (message: string) =>
      setNotice(message ? { message, id: Date.now() } : undefined),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <FeedbackContext.Provider value={notify}>
      {children}
      <div className="feedback-region" aria-live="polite" aria-atomic="true">
        {notice && (
          <div className="success-toast">
            <span aria-hidden="true">✓</span>
            <strong>{notice.message}</strong>
            <button
              type="button"
              className="secondary"
              aria-label="Dismiss confirmation"
              onClick={() => setNotice(undefined)}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}
