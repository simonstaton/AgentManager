# Spawn Agent

Create a new sub-agent using the **Platform API** (`POST /api/agents`). This ensures the agent is visible in the UI and supports model selection. Read your CLAUDE.md file to get your agent ID and auth token, then:

1. Use the Platform API (`POST /api/agents`) — **not** the Task tool — so the user can see and interact with the agent.
2. Set the `parentId` field to your own agent ID so the platform knows this is your child.
3. Give the new agent a descriptive name and clear task prompt.
4. Set the `model` field explicitly. Available models (cheapest to most expensive):
   - `claude-haiku-4-5-20251001` — fast and cheap, good for simple tasks
   - `claude-sonnet-4-5-20250929` — balanced (default if omitted)
   - `claude-sonnet-4-6` — newer sonnet, stronger reasoning
   - `claude-opus-4-6` — most capable, use for complex tasks
5. Optionally set a `role` (e.g., "researcher", "coder", "reviewer").
6. The sub-agent will be automatically destroyed when you are destroyed.
7. After spawning, send a message to the new agent with any additional context it needs.

**Important:** If the user requests a specific model (e.g. "use haiku", "use a cheap model"), you MUST pass the corresponding model ID in the API request. The native Task tool cannot change models — it always inherits yours.

Task to delegate: $ARGUMENTS
