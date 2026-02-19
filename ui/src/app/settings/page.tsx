"use client";

import { Settings } from "../../views/Settings";
import { ProtectedShell } from "../protected-shell";

export default function SettingsPage() {
  return (
    <ProtectedShell>
      <Settings />
    </ProtectedShell>
  );
}
