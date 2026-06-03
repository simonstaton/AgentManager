export type AgentStatus =
  | "starting"
  | "running"
  | "idle"
  | "error"
  | "restored"
  | "killing"
  | "destroying"
  | "paused"
  | "stalled"
  | "disconnected";

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  workspaceDir: string;
  dangerouslySkipPermissions?: boolean;
  claudeSessionId?: string;
  createdAt: string;
  lastActivity: string;
  model: string;
  role?: string;
  capabilities?: string[];
  currentTask?: string;
  parentId?: string;
  gitBranch?: string;
  gitRepo?: string;
  gitWorktree?: string;
}

export type MessageType = "task" | "result" | "question" | "info" | "status" | "interrupt";

export interface AgentMessage {
  id: string;
  from: string;
  fromName?: string;
  to?: string;
  channel?: string;
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  readBy: string[];
  excludeRoles?: string[];
}

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: string;
  tool?: string;
  content?: string;
  result?: string;
  text?: string;
  exitCode?: number;
  [key: string]: unknown;
}

export interface TopologyNode {
  id: string;
  name: string;
  status: AgentStatus;
  role?: string;
  model: string;
  depth: number;
  currentTask?: string;
  parentId?: string;
  lastActivity: string;
  tokensUsed: number;
  tokensSpent: number;
  estimatedCost: number;
}

export interface TopologyEdge {
  source: string;
  target: string;
}

export interface AgentTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "blocked" | "cancelled";
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerAgentId: string | null;
  parentTaskId: string | null;
  input: Record<string, unknown> | null;
  expectedOutput: Record<string, unknown> | null;
  acceptanceCriteria: string | null;
  requiredCapabilities: string[];
  dependsOn: string[];
  version: number;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskSummary {
  total: number;
  byStatus: Record<TaskStatus, number>;
  blockedChains: number;
}

export interface OrchestratorStatus {
  running: boolean;
  taskSummary: TaskSummary;
  recentEvents: OrchestratorEvent[];
  agentProfiles: Array<{
    agentId: string;
    totalCompleted: number;
    totalFailed: number;
    topCapabilities: Array<{ capability: string; successRate: number }>;
  }>;
}

export interface OrchestratorEvent {
  type: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AgentMetadata {
  pid: number | null;
  uptime: number;
  workingDir: string;
  repo: string | null;
  branch: string | null;
  worktreePath: string | null;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  model: string;
  sessionId: string | null;
}
export interface ContextFile {
  name: string;
  size: number;
  modified: string;
}

export interface ClaudeConfigFile {
  name: string;
  path: string;
  description: string;
  category: string;
  deletable: boolean;
}

export interface Repository {
  name: string;
  dirName: string;
  url: string | null;
  patConfigured?: boolean;
  hasActiveAgents: boolean;
  activeAgentCount: number;
  activeAgents: Array<{ id: string; name: string }>;
}

export type RiskLevel = "low" | "medium" | "high";

export type ConfidenceLabel = "high" | "medium" | "low" | "critical";

export interface MergePolicyEntry {
  allowed: boolean;
  reason: string;
}

export interface GateRules {
  autoMergeThreshold: ConfidenceLabel;
  mergePolicy: Record<ConfidenceLabel, MergePolicyEntry>;
}

export interface GateOverrides {
  autoMergeThreshold?: ConfidenceLabel;
  mergePolicy?: Partial<Record<ConfidenceLabel, Partial<MergePolicyEntry>>>;
}

export interface RepoGateConfig {
  defaults: GateRules;
  overrides: GateOverrides;
  effective: GateRules;
  updatedAt: string | null;
  updatedBy: string | null;
}

// ─── Context Policy ────────────────────────────────────────────────────────────

export interface AutoResetPolicy {
  enabled?: boolean;
  threshold?: number;
  cooldownTurns?: number;
}

export interface ContextPolicy {
  autoReset?: AutoResetPolicy;
}

export interface EffectiveAutoReset {
  enabled: boolean;
  threshold: number;
  cooldownTurns: number;
}

export interface EffectiveContextPolicy {
  autoReset: EffectiveAutoReset;
}

export interface ContextPolicyRecord {
  scope: string;
  policy: ContextPolicy;
  updatedAt: string;
}

export interface ContextPolicyBounds {
  autoReset: {
    threshold: { min: number; max: number };
    cooldownTurns: { min: number; max: number };
  };
}

export interface ContextPolicyResponse {
  effective: EffectiveContextPolicy;
  global: ContextPolicyRecord;
  agent?: ContextPolicyRecord;
  bounds: ContextPolicyBounds;
}

export interface TokenStatus {
  configured: boolean;
  source: string;
  hint: string | null;
  label?: string;
  user?: string;
}

export interface PullRequestItem {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
  branch: string;
  baseBranch: string;
  author: string;
  repo: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  checksStatus: "pending" | "passing" | "failing" | "none";
  reviewDecision: string;
  createdAt: string;
  updatedAt: string;
  agent: { id: string; name: string } | null;
  labels: string[];
}

export interface Workflow {
  id: string;
  linearUrl: string;
  repository: string;
  status:
    | "validating"
    | "rejected"
    | "starting"
    | "running"
    | "awaiting_confirm"
    | "grading"
    | "needs_human"
    | "completed"
    | "failed"
    | "cancelled";
  agents: Array<{ id: string; name: string; role: string; status?: string; currentTask?: string }>;
  prUrl?: string;
  error?: string;
  validation?: {
    verdict: "accept" | "accept_with_caveats" | "reject";
    clarity: "high" | "medium" | "low";
    missing: string[];
    suggestions: string[];
    readError?: "not_found" | "forbidden" | "auth_failed" | "rate_limited" | "multi_issue_empty";
    evaluatedAt: string;
  };
  grade?: {
    taskId: string;
    agentId: string;
    ticketClarity: "high" | "medium" | "low";
    fixConfidence: "high" | "medium" | "low";
    blastRadius: "isolated" | "moderate" | "broad";
    overallRisk: "low" | "medium" | "high";
    numericScore: number;
    reasoning?: string;
    createdAt: string;
  };
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStart" | "SubagentStop";
export type HookType = "http" | "command";

export interface HookRule {
  id: string;
  event: HookEvent;
  type: HookType;
  matcher?: string;
  url?: string;
  command?: string;
  timeout?: number;
  async?: boolean;
}

export interface ToolTimelineEntry {
  tool: string;
  inputPreview: string;
  timestamp: string;
  durationMs?: number;
  outcome: "allowed" | "blocked";
}

export interface AgentStateEvent {
  type: "agent_state";
  agentId: string;
  status: AgentStatus;
  currentTask?: string;
  tokensUsed?: number;
  estimatedCost?: number;
}

export interface GradeResult {
  taskId: string;
  agentId: string;
  ticketClarity: "high" | "medium" | "low";
  fixConfidence: "high" | "medium" | "low";
  blastRadius: "isolated" | "moderate" | "broad";
  overallRisk: RiskLevel;
  reasoning?: string;
  createdAt: string;
}

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

export function createApi(authFetch: AuthFetch) {
  return {
    async fetchAgents(): Promise<Agent[]> {
      const res = await authFetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      return res.json();
    },

    async getAgent(id: string): Promise<Agent> {
      const res = await authFetch(`/api/agents/${id}`);
      if (!res.ok) throw new Error("Agent not found");
      return res.json();
    },

    async getAgentMetadata(id: string): Promise<AgentMetadata> {
      const res = await authFetch(`/api/agents/${id}/metadata`);
      if (!res.ok) throw new Error("Failed to fetch agent metadata");
      return res.json();
    },

    async patchAgent(
      id: string,
      patch: { dangerouslySkipPermissions?: boolean; role?: string; currentTask?: string; name?: string },
    ): Promise<Agent> {
      const res = await authFetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to update agent");
      return res.json();
    },

    createAgentStream(opts: {
      prompt: string;
      name?: string;
      model?: string;
      maxTurns?: number;
      dangerouslySkipPermissions?: boolean;
      attachments?: Array<{ name: string; type: "image" | "file"; data: string; mime: string }>;
    }): {
      stream: Promise<ReadableStream<StreamEvent>>;
      abort: () => void;
    } {
      const controller = new AbortController();
      const body: Record<string, unknown> = {
        prompt: opts.prompt,
        name: opts.name,
        model: opts.model,
        maxTurns: opts.maxTurns,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions ?? false,
      };
      if (opts.attachments && opts.attachments.length > 0) {
        body.attachments = opts.attachments.map((a) => ({
          name: a.name,
          type: a.type,
          data: a.data,
          mime: a.mime,
        }));
      }
      const stream = authFetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to create agent");
        return parseSSEStream(res);
      });

      return { stream, abort: () => controller.abort() };
    },

    messageAgentStream(
      id: string,
      prompt: string,
      maxTurns?: number,
      sessionId?: string,
      attachments?: Array<{ name: string; type: "image" | "file"; data: string; mime: string }>,
    ): { stream: Promise<ReadableStream<StreamEvent>>; abort: () => void } {
      const controller = new AbortController();
      const body: Record<string, unknown> = { prompt, maxTurns, sessionId };
      if (attachments && attachments.length > 0) {
        body.attachments = attachments.map((a) => ({
          name: a.name,
          type: a.type,
          data: a.data,
          mime: a.mime,
        }));
      }
      const stream = authFetch(`/api/agents/${id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to message agent");
        return parseSSEStream(res);
      });

      return { stream, abort: () => controller.abort() };
    },

    reconnectStream(
      id: string,
      afterIndex?: number,
    ): {
      stream: Promise<ReadableStream<StreamEvent>>;
      abort: () => void;
    } {
      const controller = new AbortController();
      const params = afterIndex != null && afterIndex > 0 ? `?after=${afterIndex}` : "";
      const stream = authFetch(`/api/agents/${id}/events${params}`, {
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to reconnect");
        // Don't close on `done` - the reconnect stream replays historical events
        // which include `done` events from previous turns. Closing early would
        // truncate the history and lose subsequent conversation turns.
        return parseSSEStream(res, { closeOnDone: false });
      });

      return { stream, abort: () => controller.abort() };
    },

    async listAgentFiles(id: string, query?: string): Promise<string[]> {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "30");
      const res = await authFetch(`/api/agents/${id}/files?${params}`);
      if (!res.ok) return [];
      return res.json();
    },

    async fetchTopology(): Promise<AgentTopology> {
      const res = await authFetch("/api/agents/topology");
      if (!res.ok) throw new Error("Failed to fetch topology");
      return res.json();
    },

    async destroyAgent(id: string): Promise<void> {
      const res = await authFetch(`/api/agents/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to destroy agent");
    },

    async pauseAgent(id: string): Promise<void> {
      const res = await authFetch(`/api/agents/${id}/pause`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to pause agent");
      }
    },

    async resumeAgent(id: string): Promise<void> {
      const res = await authFetch(`/api/agents/${id}/resume`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to resume agent");
      }
    },

    async clearAgentContext(id: string): Promise<{ ok: boolean; tokensCleared: number }> {
      const res = await authFetch(`/api/agents/${id}/clear-context`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to clear agent context");
      }
      return res.json();
    },

    async readContext(filename: string): Promise<string> {
      const res = await authFetch(`/api/context/file?name=${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error("Failed to read context file");
      const data = await res.json();
      return data.content;
    },

    async listContext(): Promise<ContextFile[]> {
      const res = await authFetch("/api/context");
      if (!res.ok) return [];
      return res.json();
    },

    async updateContext(filename: string, content: string): Promise<void> {
      const res = await authFetch("/api/context/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: filename, content }),
      });
      if (!res.ok) throw new Error("Failed to update context");
    },

    async deleteContext(filename: string): Promise<void> {
      const res = await authFetch(`/api/context/file?name=${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete context");
    },

    // Claude config
    async listClaudeConfig(): Promise<ClaudeConfigFile[]> {
      const res = await authFetch("/api/claude-config");
      if (!res.ok) return [];
      return res.json();
    },

    async readClaudeConfig(filePath: string): Promise<string> {
      const res = await authFetch(`/api/claude-config/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error("Failed to read config");
      const data = await res.json();
      return data.content;
    },

    async writeClaudeConfig(filePath: string, content: string): Promise<void> {
      const res = await authFetch("/api/claude-config/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      if (!res.ok) throw new Error("Failed to save config");
    },

    async createCommand(name: string, content: string): Promise<ClaudeConfigFile> {
      const res = await authFetch("/api/claude-config/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create command");
      }
      const data = await res.json();
      return data.file;
    },

    async deleteClaudeConfig(filePath: string): Promise<void> {
      const res = await authFetch(`/api/claude-config/file?path=${encodeURIComponent(filePath)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete config file");
      }
    },

    // Settings
    async getSettings(): Promise<{
      anthropicKeyHint: string;
      keyMode: "openrouter" | "anthropic";
      models: string[];
      guardrails: {
        maxPromptLength: number;
        maxTurns: number;
        maxAgents: number;
        maxBatchSize: number;
        maxAgentDepth: number;
        maxChildrenPerAgent: number;
        sessionTtlMs: number;
      };
      integrations?: Record<string, { configured: boolean; authMethod: string }>;
      linearConfigured?: boolean;
    }> {
      const res = await authFetch("/api/settings");
      if (!res.ok) throw new Error("Failed to get settings");
      return res.json();
    },

    async setAnthropicKey(key: string): Promise<{ hint: string; keyMode: "openrouter" | "anthropic" }> {
      const res = await authFetch("/api/settings/anthropic-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error("Invalid API key format");
      return res.json();
    },

    async setIntegrations(integrations: {
      githubToken?: string;
      notionApiKey?: string;
      slackToken?: string;
      figmaToken?: string;
      linearApiKey?: string;
    }): Promise<{ ok: boolean; integrations: Record<string, { configured: boolean }> }> {
      const res = await authFetch("/api/settings/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(integrations),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to save integration tokens");
      }
      return res.json();
    },
    async updateGuardrails(settings: {
      maxPromptLength?: number;
      maxTurns?: number;
      maxAgents?: number;
      maxBatchSize?: number;
      maxAgentDepth?: number;
      maxChildrenPerAgent?: number;
      sessionTtlMs?: number;
    }): Promise<{
      ok: boolean;
      guardrails: {
        maxPromptLength: number;
        maxTurns: number;
        maxAgents: number;
        maxBatchSize: number;
        maxAgentDepth: number;
        maxChildrenPerAgent: number;
        sessionTtlMs: number;
      };
    }> {
      const res = await authFetch("/api/settings/guardrails", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update guardrails");
      }
      return res.json();
    },

    // Messages
    async fetchMessages(opts?: {
      to?: string;
      from?: string;
      channel?: string;
      type?: MessageType;
      unreadBy?: string;
      limit?: number;
    }): Promise<AgentMessage[]> {
      const params = new URLSearchParams();
      if (opts?.to) params.set("to", opts.to);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.channel) params.set("channel", opts.channel);
      if (opts?.type) params.set("type", opts.type);
      if (opts?.unreadBy) params.set("unreadBy", opts.unreadBy);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const res = await authFetch(`/api/messages?${params}`);
      if (!res.ok) return [];
      return res.json();
    },

    async postMessage(msg: {
      from: string;
      fromName?: string;
      to?: string;
      channel?: string;
      type: MessageType;
      content: string;
      metadata?: Record<string, unknown>;
    }): Promise<AgentMessage> {
      const res = await authFetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
      if (!res.ok) throw new Error("Failed to post message");
      return res.json();
    },

    async deleteMessage(id: string): Promise<void> {
      const res = await authFetch(`/api/messages/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete message");
    },

    async clearAllMessages(): Promise<{ ok: boolean; deleted: number }> {
      const res = await authFetch("/api/messages", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear messages");
      return res.json();
    },

    // Kill switch
    async getKillSwitchState(): Promise<{ killed: boolean; reason?: string; activatedAt?: string }> {
      const res = await authFetch("/api/kill-switch");
      if (!res.ok) throw new Error("Failed to get kill switch state");
      return res.json();
    },

    async activateKillSwitch(reason?: string): Promise<void> {
      const res = await authFetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to activate kill switch");
      }
    },

    async deactivateKillSwitch(): Promise<void> {
      const res = await authFetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to deactivate kill switch");
      }
    },

    // Download agent logs as a text file
    async downloadAgentLogs(id: string, agentName: string): Promise<void> {
      const res = await authFetch(`/api/agents/${id}/logs?format=text`);
      if (!res.ok) throw new Error("Failed to download logs");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${agentName}-log.txt`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // Cost / usage
    async fetchCostSummary(): Promise<{
      totalTokens: number;
      totalCost: number;
      agentCount: number;
      agents: Array<{
        agentId: string;
        agentName: string;
        tokensUsed: number;
        estimatedCost: number;
        createdAt: string;
        status: string;
      }>;
      allTime: {
        totalCost: number;
        totalTokensIn: number;
        totalTokensOut: number;
        totalRecords: number;
      };
      spendLimit: number | null;
      spendLimitExceeded: boolean;
    }> {
      const res = await authFetch("/api/cost/summary");
      if (!res.ok) throw new Error(`Failed to fetch cost data: ${res.statusText}`);
      return res.json();
    },

    async fetchCostHistory(limit = 500): Promise<{
      records: Array<{
        agentId: string;
        agentName: string;
        model: string;
        tokensIn: number;
        tokensOut: number;
        estimatedCost: number;
        createdAt: string;
        closedAt: string | null;
      }>;
      summary: {
        allTimeCost: number;
        allTimeTokensIn: number;
        allTimeTokensOut: number;
        totalRecords: number;
      };
    }> {
      const res = await authFetch(`/api/cost/history?limit=${limit}`);
      if (!res.ok) throw new Error(`Failed to fetch cost history: ${res.statusText}`);
      return res.json();
    },

    async resetCostHistory(): Promise<{ ok: boolean; deleted: number }> {
      const res = await authFetch("/api/cost/history", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to reset cost history");
      return res.json();
    },

    async fetchSpendLimit(): Promise<{ spendLimit: number | null }> {
      const res = await authFetch("/api/cost/limit");
      if (!res.ok) throw new Error("Failed to fetch spend limit");
      return res.json();
    },

    async setSpendLimit(spendLimit: number | null): Promise<{ ok: boolean; spendLimit: number | null }> {
      const res = await authFetch("/api/cost/limit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spendLimit }),
      });
      if (!res.ok) throw new Error("Failed to set spend limit");
      return res.json();
    },

    // Tasks
    async fetchTasks(opts?: { status?: TaskStatus; ownerAgentId?: string; limit?: number }): Promise<TaskNode[]> {
      const params = new URLSearchParams();
      if (opts?.status) params.set("status", opts.status);
      if (opts?.ownerAgentId) params.set("ownerAgentId", opts.ownerAgentId);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const res = await authFetch(`/api/tasks?${params}`);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },

    async fetchTaskSummary(): Promise<TaskSummary> {
      const res = await authFetch("/api/tasks/summary");
      if (!res.ok) throw new Error("Failed to fetch task summary");
      return res.json();
    },

    async createTask(data: {
      title: string;
      description?: string;
      priority?: TaskPriority;
      dependsOn?: string[];
      requiredCapabilities?: string[];
    }): Promise<TaskNode> {
      const res = await authFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to create task");
      }
      return res.json();
    },

    async deleteTask(id: string): Promise<void> {
      const res = await authFetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete task");
    },

    async clearAllTasks(): Promise<{ deleted: number }> {
      const res = await authFetch("/api/tasks?confirm=true", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear tasks");
      return res.json();
    },

    async assignTask(taskId: string, agentId: string): Promise<TaskNode> {
      const res = await authFetch(`/api/tasks/${taskId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to assign task");
      }
      return res.json();
    },

    async cancelTask(taskId: string): Promise<TaskNode> {
      const res = await authFetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to cancel task");
      }
      return res.json();
    },

    async retryTask(taskId: string): Promise<TaskNode> {
      const res = await authFetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to retry task");
      }
      return res.json();
    },

    async fetchOrchestratorStatus(): Promise<OrchestratorStatus> {
      const res = await authFetch("/api/orchestrator/status");
      if (!res.ok) throw new Error("Failed to fetch orchestrator status");
      return res.json();
    },

    async fetchOrchestratorEvents(limit = 50): Promise<OrchestratorEvent[]> {
      const res = await authFetch(`/api/orchestrator/events?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch orchestrator events");
      return res.json();
    },

    async triggerAssignment(): Promise<{ assignments: Array<{ taskId: string; agentId: string }> }> {
      const res = await authFetch("/api/orchestrator/assign", { method: "POST" });
      if (!res.ok) throw new Error("Failed to trigger assignment");
      return res.json();
    },

    // Confidence grading
    async fetchGrades(opts?: { risk?: RiskLevel; agentId?: string }): Promise<GradeResult[]> {
      const params = new URLSearchParams();
      if (opts?.risk) params.set("risk", opts.risk);
      if (opts?.agentId) params.set("agentId", opts.agentId);
      const res = await authFetch(`/api/grades?${params}`);
      if (!res.ok) return [];
      return res.json();
    },

    async fetchGrade(taskId: string): Promise<GradeResult | null> {
      const res = await authFetch(`/api/grades/${taskId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch grade");
      return res.json();
    },

    async approveGrade(taskId: string): Promise<{ approved: boolean; taskId: string }> {
      const res = await authFetch(`/api/grades/${taskId}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to approve grade");
      }
      return res.json();
    },

    // Repositories
    async listRepositories(): Promise<{ repositories: Repository[] }> {
      const res = await authFetch("/api/repositories");
      if (!res.ok) throw new Error("Failed to list repositories");
      return res.json();
    },

    async cloneRepository(url: string): Promise<Response> {
      return authFetch("/api/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    },

    async deleteRepository(name: string): Promise<void> {
      const res = await authFetch(`/api/repositories/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to delete repository");
      }
    },
    async setRepositoryPat(repoName: string, pat: string): Promise<{ ok: boolean; patConfigured: boolean }> {
      const res = await authFetch(`/api/repositories/${encodeURIComponent(repoName)}/pat`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to save repository PAT");
      }
      return res.json();
    },

    // Repo-gate config
    async getRepoGateConfig(repoName: string): Promise<RepoGateConfig> {
      const res = await authFetch(`/api/repositories/${encodeURIComponent(repoName)}/gate-config`);
      if (!res.ok) throw new Error(`Failed to load gate config: ${res.status}`);
      return res.json();
    },

    async updateRepoGateConfig(repoName: string, overrides: GateOverrides): Promise<RepoGateConfig> {
      const res = await authFetch(`/api/repositories/${encodeURIComponent(repoName)}/gate-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Failed to save gate config: ${res.status}`);
      }
      return res.json();
    },

    async resetRepoGateConfig(repoName: string): Promise<RepoGateConfig> {
      const res = await authFetch(`/api/repositories/${encodeURIComponent(repoName)}/gate-config`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to reset gate config: ${res.status}`);
      return res.json();
    },

    // Context Policy
    async getContextPolicy(): Promise<ContextPolicyResponse> {
      const res = await authFetch("/api/context-policy");
      if (!res.ok) throw new Error("Failed to get context policy");
      return res.json();
    },

    async updateContextPolicy(patch: ContextPolicy): Promise<ContextPolicyResponse> {
      const res = await authFetch("/api/context-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save context policy");
      }
      return res.json();
    },

    async getAgentContextPolicy(agentId: string): Promise<ContextPolicyResponse> {
      const res = await authFetch(`/api/context-policy/${encodeURIComponent(agentId)}`);
      if (!res.ok) throw new Error(`Failed to get context policy for agent: ${res.status}`);
      return res.json();
    },

    async updateAgentContextPolicy(agentId: string, patch: ContextPolicy): Promise<ContextPolicyResponse> {
      const res = await authFetch(`/api/context-policy/${encodeURIComponent(agentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save agent context policy");
      }
      return res.json();
    },

    async resetAgentContextPolicy(agentId: string): Promise<ContextPolicyResponse> {
      const res = await authFetch(`/api/context-policy/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to reset agent context policy: ${res.status}`);
      return res.json();
    },

    // Integration tokens
    async listTokens(): Promise<{ tokens: Record<string, TokenStatus> }> {
      const res = await authFetch("/api/tokens");
      if (!res.ok) throw new Error("Failed to list tokens");
      return res.json();
    },

    async setToken(
      service: string,
      token: string,
      label?: string,
    ): Promise<{ ok: boolean; service: string; hint: string; user?: string; validationWarning?: string }> {
      const res = await authFetch(`/api/tokens/${encodeURIComponent(service)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, label }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to set token");
      }
      return res.json();
    },

    async removeToken(service: string): Promise<{ ok: boolean; hasFallback: boolean }> {
      const res = await authFetch(`/api/tokens/${encodeURIComponent(service)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to remove token");
      }
      return res.json();
    },

    // TOTP
    async getTotpStatus(): Promise<{ enabled: boolean; backupCodesRemaining: number; enabledAt: string | null }> {
      const res = await authFetch("/api/auth/totp/status");
      if (!res.ok) throw new Error("Failed to get TOTP status");
      return res.json();
    },

    async getTotpSetup(): Promise<{
      setupToken: string;
      secret: string;
      qrCodeDataUrl: string;
      backupCodes: string[];
    }> {
      const res = await authFetch("/api/auth/totp/setup");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to get TOTP setup");
      }
      return res.json();
    },

    async enableTotp(setupToken: string, code: string): Promise<{ ok: boolean }> {
      const res = await authFetch("/api/auth/totp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken, code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to enable TOTP");
      }
      return res.json();
    },

    async disableTotp(code: string): Promise<{ ok: boolean }> {
      const res = await authFetch("/api/auth/totp/disable", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to disable TOTP");
      }
      return res.json();
    },

    async regenerateBackupCodes(code: string): Promise<{ backupCodes: string[] }> {
      const res = await authFetch("/api/auth/totp/backup-codes/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to regenerate backup codes");
      }
      return res.json();
    },

    // Pull Requests
    async fetchPullRequests(forceRefresh = false): Promise<{ pullRequests: PullRequestItem[]; error?: string }> {
      const url = forceRefresh ? "/api/pull-requests?refresh=true" : "/api/pull-requests";
      const res = await authFetch(url);
      if (!res.ok) throw new Error("Failed to fetch pull requests");
      return res.json();
    },

    // Workflows
    async fetchWorkflows(): Promise<Workflow[]> {
      const res = await authFetch("/api/workflows");
      if (!res.ok) throw new Error("Failed to fetch workflows");
      return res.json();
    },

    async getWorkflow(id: string): Promise<Workflow> {
      const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Failed to fetch workflow ${id}`);
      return res.json();
    },

    async cancelWorkflow(id: string): Promise<void> {
      const res = await authFetch(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel workflow");
    },

    // Hook config
    async getHookConfig(agentId: string): Promise<HookRule[]> {
      const res = await authFetch(`/api/agents/${agentId}/hooks`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.rules as HookRule[];
    },

    async setHookConfig(agentId: string, rules: HookRule[]): Promise<HookRule[]> {
      const res = await authFetch(`/api/agents/${agentId}/hooks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.rules as HookRule[];
    },

    // Tool timeline
    async getToolTimeline(agentId: string): Promise<ToolTimelineEntry[]> {
      const res = await authFetch(`/api/hooks/${encodeURIComponent(agentId)}/timeline`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.timeline ?? [];
    },

    // Bulk agent ops
    async bulkUpdateAgents(
      ids: string[],
      patch: { status?: string; role?: string },
    ): Promise<{ updated: number; errors: Array<{ id: string; error: string }> }> {
      const res = await authFetch("/api/agents/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, patch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to bulk update agents");
      }
      return res.json();
    },

    async retryAgentTask(agentId: string): Promise<{ ok: boolean }> {
      const res = await authFetch(`/api/agents/${agentId}/retry`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to retry agent task");
      }
      return res.json();
    },

    // Agent batch creation
    async createAgentBatch(
      agents: Array<{
        prompt: string;
        name?: string;
        model?: string;
        role?: string;
        parentId?: string;
        maxTurns?: number;
        dangerouslySkipPermissions?: boolean;
      }>,
    ): Promise<{ results: Array<{ agent?: Agent; error?: string }> }> {
      const res = await authFetch("/api/agents/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to create agent batch");
      }
      return res.json();
    },

    // SSE streams
    agentStateStream(): { stream: Promise<ReadableStream<AgentStateEvent>>; abort: () => void } {
      const controller = new AbortController();
      const stream = authFetch("/api/agents/events", {
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to connect to agent state stream");
        return parseAgentStateSSEStream(res);
      });
      return { stream, abort: () => controller.abort() };
    },

    allAgentLogsStream(opts?: { tail?: number; agentIds?: string[] }): {
      stream: Promise<ReadableStream<StreamEvent & { agentId: string; agentName: string }>>;
      abort: () => void;
    } {
      const controller = new AbortController();
      const params = new URLSearchParams();
      if (opts?.tail) params.set("tail", String(opts.tail));
      if (opts?.agentIds?.length) params.set("agents", opts.agentIds.join(","));
      const qs = params.toString() ? `?${params}` : "";
      const stream = authFetch(`/api/agents/logs/stream${qs}`, {
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to connect to agent logs stream");
        return parseSSEStream(res, { closeOnDone: false }) as ReadableStream<
          StreamEvent & { agentId: string; agentName: string }
        >;
      });
      return { stream, abort: () => controller.abort() };
    },
  };
}

function parseAgentStateSSEStream(res: Response): ReadableStream<AgentStateEvent> {
  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<AgentStateEvent>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith(":") || line.startsWith("id:") || !line.trim()) continue;
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as AgentStateEvent;
                controller.enqueue(event);
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }
      } catch (err: unknown) {
        reader.cancel().catch(() => {});
        if (err instanceof DOMException && err.name === "AbortError") {
          controller.close();
        } else {
          controller.error(err);
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

interface ParseSSEOptions {
  /** When false, `done`/`destroyed` events are enqueued but don't close the stream. Default: true. */
  closeOnDone?: boolean;
}

function parseSSEStream(res: Response, options: ParseSSEOptions = {}): ReadableStream<StreamEvent> {
  const { closeOnDone = true } = options;

  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<StreamEvent>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Skip heartbeat comments and empty lines
            if (line.startsWith(":") || line.startsWith("id:") || !line.trim()) continue;

            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as StreamEvent;
                controller.enqueue(event);

                if (closeOnDone && (event.type === "done" || event.type === "destroyed")) {
                  // Release the underlying reader so the fetch body is freed
                  reader.cancel();
                  controller.close();
                  return;
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }
      } catch (err: unknown) {
        // Always release the underlying reader on error to prevent leaks
        reader.cancel().catch(() => {});
        // Stream aborted (e.g. user sent a new message) - close gracefully
        if (err instanceof DOMException && err.name === "AbortError") {
          controller.close();
        } else {
          controller.error(err);
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
