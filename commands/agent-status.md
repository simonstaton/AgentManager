# Agent Status

Get a quick overview of all agents in the swarm — their status, roles, current tasks, and recent activity. This runs a single script that gathers everything in one go.

Run the following bash script (adjust the variables from your CLAUDE.md if needed):

```bash
# Read agent ID and workspace path from CLAUDE.md, then read token from platform-managed file
AGENT_ID=$(grep 'Agent ID' CLAUDE.md | head -1 | sed 's/.*`\(.*\)`.*/\1/')
WORKSPACE=$(grep 'Workspace:' CLAUDE.md | head -1 | sed 's/.*`\(.*\)`.*/\1/')
AUTH_TOKEN=$(cat "$WORKSPACE/.agent-token" 2>/dev/null || cat .agent-token 2>/dev/null || echo "$AGENT_AUTH_TOKEN")
PORT=8080

echo "=== AGENT REGISTRY ==="
curl -s -H "Authorization: Bearer $AUTH_TOKEN" "http://localhost:$PORT/api/agents/registry" | python3 -c "
import sys, json
try:
    agents = json.load(sys.stdin)
    if not agents:
        print('No agents registered.')
    else:
        for a in agents:
            name = a.get('name', '?')
            aid = a.get('id', '?')[:8]
            status = a.get('status', '?')
            role = a.get('role', 'general')
            task = a.get('currentTask', '')
            model = a.get('model', '?')
            task_str = f' — working on: {task}' if task else ''
            print(f'  {name} ({aid}) [{model}] — {role} — {status}{task_str}')
except: print('  (failed to parse registry)')
"

echo ""
echo "=== RECENT MESSAGES (last 10) ==="
curl -s -H "Authorization: Bearer $AUTH_TOKEN" "http://localhost:$PORT/api/messages?limit=10" | python3 -c "
import sys, json
try:
    msgs = json.load(sys.stdin)
    if not msgs:
        print('  No messages.')
    else:
        for m in msgs[-10:]:
            frm = m.get('fromName', m.get('from', '?')[:8])
            mtype = m.get('type', '?')
            content = m.get('content', '')[:120]
            to = m.get('to', 'broadcast')
            if to != 'broadcast': to = to[:8]
            print(f'  [{mtype}] {frm} → {to}: {content}')
except: print('  (failed to parse messages)')
"

echo ""
echo "=== WORKING MEMORY FILES ==="
for f in shared-context/working-memory-*.md; do
  [ -f "\$f" ] || continue
  echo "--- \$(basename \$f) ---"
  head -6 "\$f"
  echo ""
done
```

Summarise what you find concisely. Do NOT send any messages to other agents — this is read-only.

$ARGUMENTS
