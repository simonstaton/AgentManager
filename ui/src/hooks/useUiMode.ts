"use client";

import { useEffect, useState } from "react";

export type UiMode = "basic" | "advanced";

const STORAGE_KEY = "agent-manager.uiMode";

export interface UiModeState {
  mode: UiMode;
  setMode: (m: UiMode) => void;
  ready: boolean;
}

/**
 * Persist and restore the UI mode (basic/advanced) in localStorage.
 * Defaults to "advanced" until hydrated.
 */
export function useUiMode(): UiModeState {
  const [mode, setModeState] = useState<UiMode>("advanced");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "basic" || stored === "advanced") {
      setModeState(stored);
    }
    setReady(true);
  }, []);

  const setMode = (m: UiMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  };

  return { mode, setMode, ready };
}
