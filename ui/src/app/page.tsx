"use client";

import { Dashboard } from "../views/Dashboard";
import { ProtectedShell } from "./protected-shell";

export default function DashboardPage() {
  return (
    <ProtectedShell>
      <Dashboard />
    </ProtectedShell>
  );
}
