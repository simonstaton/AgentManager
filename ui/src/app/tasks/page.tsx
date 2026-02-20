"use client";

import { TasksView } from "../../views/TasksView";
import { ProtectedShell } from "../protected-shell";

export default function TasksPage() {
  return (
    <ProtectedShell>
      <TasksView />
    </ProtectedShell>
  );
}
