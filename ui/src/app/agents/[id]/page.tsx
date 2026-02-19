import { AgentPageClient } from "./agent-page-client";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function AgentPage() {
  return <AgentPageClient />;
}
