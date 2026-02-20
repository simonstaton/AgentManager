"use client";

import { SettingsLayout } from "../../../components/SettingsLayout";
import { useApi } from "../../../hooks/useApi";
import { RepositoriesPanel } from "../../../views/Settings";
import { ProtectedShell } from "../../protected-shell";

export default function SettingsRepositoriesPage() {
  const api = useApi();
  return (
    <ProtectedShell>
      <SettingsLayout>
        <RepositoriesPanel api={api} />
      </SettingsLayout>
    </ProtectedShell>
  );
}
