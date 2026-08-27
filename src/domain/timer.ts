import { useState, useEffect } from 'react';

/**
 * Presentation hook that computes live remaining seconds from an absolute timestamp.
 * Updates local component rendering once per second without mutating global state.
 */
export function useRemainingSeconds(endsAt?: number): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!endsAt) return;

    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
