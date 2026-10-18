import { useEffect, useState } from "react";

// Keep inputs and shareable URLs immediate; wait briefly before an API search.
export function useDebouncedValue(value: string, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
