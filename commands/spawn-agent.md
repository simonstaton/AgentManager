# Spawn Agent

Create sub-agent(s) using the **Platform API**. This ensures agents are visible in the UI and supports model selection. Read your CLAUDE.md file to get your agent ID and auth token, then follow the instructions below.

## Multiple Agents

**CRITICAL:** If the user requests multiple agents (e.g. "spawn a tech lead, PM, and designer"), you MUST create each agent as a **separate, distinct agent** with its own unique name, role, and prompt. Do NOT reuse the same prompt or role for multiple agents.

When spawning **2 or more** agents, use the **batch endpoint** (`POST /api/agents/batch`) with a single request containing all agents at once. Each agent in the batch MUST have a different `name`, `role`, and `prompt` tailored to its specific role.

```
curl -s -X POST http://localhost:8080/api/agents/batch \
  -H "Authorization: Bearer $AGENT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agents": [
      {"name": "tech-lead", "role": "Tech Lead", "prompt": "You are a tech lead...", "model": "claude-opus-4-6", "parentId": "YOUR_ID"},
      {"name": "product-manager", "role": "Product Manager", "prompt": "You are a PM...", "model": "claude-sonnet-4-5-20250929", "parentId": "YOUR_ID"},
      {"name": "designer", "role": "Designer", "prompt": "You are a designer...", "model": "claude-sonnet-4-5-20250929", "parentId": "YOUR_ID"}
    ]
  }'
```

**Do NOT use parallel tool calls to spawn multiple agents via `POST /api/agents`** — this causes race conditions and duplicate agents. Always use the batch endpoint for multiple agents.

## Single Agent

For a single agent, use `POST /api/agents`:

1. Set the `parentId` field to your own agent ID so the platform knows this is your child.
2. Give the new agent a descriptive name and clear task prompt.
3. Set the `model` field explicitly. Available models (cheapest to most expensive):
   - `claude-haiku-4-5-20251001` — fast and cheap, good for simple tasks
   - `claude-sonnet-4-5-20250929` — balanced (default if omitted)
   - `claude-sonnet-4-6` — newer sonnet, stronger reasoning
   - `claude-opus-4-6` — most capable, use for complex tasks
4. Optionally set a `role` (e.g., "researcher", "coder", "reviewer").
5. The sub-agent will be automatically destroyed when you are destroyed.
6. After spawning, send a message to the new agent with any additional context it needs.

**Important:** If the user requests a specific model (e.g. "use haiku", "use a cheap model"), you MUST pass the corresponding model ID in the API request. The native Task tool cannot change models — it always inherits yours.

Task to delegate: $ARGUMENTS
