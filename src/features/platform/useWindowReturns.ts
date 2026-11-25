import { useEffect, useState } from "react";

/**
 * Counts the times the window comes back (it gets the focus, or shows again after being hidden):
 * the user may have switched branches in another app meanwhile (VS Code), so git is read again.
 */
export function useWindowReturns(): number {
  const [returns, setReturns] = useState(0);
  useEffect(() => {
    const back = () => {
      if (!document.hidden) setReturns((n) => n + 1);
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return returns;
}
