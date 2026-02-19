"use client";

import { CostDashboard } from "../../views/CostDashboard";
import { ProtectedShell } from "../protected-shell";

export default function CostsPage() {
  return (
    <ProtectedShell>
      <CostDashboard />
    </ProtectedShell>
  );
}
