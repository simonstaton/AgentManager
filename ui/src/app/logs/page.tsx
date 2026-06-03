"use client";

import { ProtectedShell } from "../protected-shell";

// LogsView is introduced in the follow-on PR (fe/logs-page-b).
// This stub wires the /logs route now so navigation works end-to-end.
export default function LogsPage() {
  return (
    <ProtectedShell>
      <div className="h-screen flex items-center justify-center text-zinc-500 text-sm">Logs loading…</div>
    </ProtectedShell>
  );
}
