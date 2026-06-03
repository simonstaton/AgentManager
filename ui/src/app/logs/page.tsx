"use client";

import { LogsView } from "../../views/Logs";
import { ProtectedShell } from "../protected-shell";

export default function LogsPage() {
  return (
    <ProtectedShell>
      <LogsView />
    </ProtectedShell>
  );
}
