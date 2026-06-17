"use client";

import { SettingsLayout } from "../../../components/SettingsLayout";
import { useApi } from "../../../hooks/useApi";
import { SecurityPanel } from "../../../views/Settings";
import { ProtectedShell } from "../../protected-shell";

export default function SettingsSecurityPage() {
  const api = useApi();
  return (
    <ProtectedShell>
      <SettingsLayout>
        <SecurityPanel api={api} />
      </SettingsLayout>
    </ProtectedShell>
  );
}
