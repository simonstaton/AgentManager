"use client";

import { GraphView } from "../../views/GraphView";
import { ProtectedShell } from "../protected-shell";

export default function GraphPage() {
  return (
    <ProtectedShell>
      <GraphView />
    </ProtectedShell>
  );
}
