"use client";

import { createContext, useContext } from "react";
import { KillSwitchBanner } from "./components/KillSwitchBanner";
import { type KillSwitchState, useKillSwitch } from "./hooks/useKillSwitch";

export interface KillSwitchContextValue {
  state: KillSwitchState;
  loading: boolean;
  error: string | null;
  activate: (reason?: string) => Promise<void>;
  deactivate: () => Promise<void>;
}

const KillSwitchContext = createContext<KillSwitchContextValue | null>(null);

export function useKillSwitchContext(): KillSwitchContextValue {
  const ctx = useContext(KillSwitchContext);
  if (!ctx) throw new Error("useKillSwitchContext must be used inside KillSwitchProvider");
  return ctx;
}

/**
 * Provides a single kill switch polling interval for the entire app.
 * All pages consume the shared state via useKillSwitchContext() - no per-page polling.
 */
export function KillSwitchProvider({ children }: { children: React.ReactNode }) {
  const ks = useKillSwitch();
  return (
    <KillSwitchContext.Provider value={ks}>
      <KillSwitchBanner state={ks.state} loading={ks.loading} onDeactivate={ks.deactivate} />
      {children}
    </KillSwitchContext.Provider>
  );
}
