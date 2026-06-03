"use client";

import { WorkflowsView } from "../../views/WorkflowsView";
import { ProtectedShell } from "../protected-shell";

export default function WorkflowsPage() {
  return (
    <ProtectedShell>
      <WorkflowsView />
    </ProtectedShell>
  );
}
