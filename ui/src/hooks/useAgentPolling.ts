import { useCallback, useEffect, useState } from "react";
import type { Agent } from "../api";
import { useApi } from "./useApi";
import { usePageVisible } from "./usePageVisible";

export function useAgentPolling() {
  const api = useApi();
  const [agents, setAgents] = useState<Agent[]>([]);
  const visible = usePageVisible();

  const refreshAgents = useCallback(async () => {
    try {
      const list = await api.fetchAgents();
      setAgents(list);
    } catch (err) {
      console.error("[useAgentPolling] fetch failed", err);
    }
  }, [api]);

  useEffect(() => {
    if (!visible) return;

    refreshAgents();
    const interval = setInterval(refreshAgents, 5000);
    return () => clearInterval(interval);
  }, [refreshAgents, visible]);

  return { agents, refreshAgents };
}
