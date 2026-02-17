import { useEffect, useState } from "react";

/** Returns `true` when the page is visible, `false` when the tab is hidden. */
export function usePageVisible() {
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visible;
}
