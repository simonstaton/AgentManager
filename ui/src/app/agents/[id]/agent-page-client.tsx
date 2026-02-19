"use client";

import { AgentView } from "../../../views/AgentView";
import { ProtectedShell } from "../../protected-shell";

export function AgentPageClient() {
  return (
    <ProtectedShell>
      <AgentView />
    </ProtectedShell>
  );
}
