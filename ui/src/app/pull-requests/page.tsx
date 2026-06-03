"use client";

import { PullRequestsView } from "../../views/PullRequests/PullRequestsView";
import { ProtectedShell } from "../protected-shell";

export default function PullRequestsPage() {
  return (
    <ProtectedShell>
      <PullRequestsView />
    </ProtectedShell>
  );
}
