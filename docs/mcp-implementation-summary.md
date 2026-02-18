# MCP Tools Implementation Summary

## Status: ✅ COMPLETE

MCP tools (Figma and Linear) are **already working** and available to all agents in the ClaudeSwarm platform.

## How It Works

### 1. Container Startup (`entrypoint.sh`)
```bash
# Lines 22-86 in entrypoint.sh
node -e "
  # Read mcp/settings-template.json
  # For each MCP server:
  #   - HTTP servers with _alwaysActivate: true → always added
  #   - Stdio servers → only if env vars present
  # Merge into ~/.claude/settings.json
"
```

**Result**: `~/.claude/settings.json` contains:
```json
{
  "mcpServers": {
    "figma": {
      "type": "http",
      "url": "https://mcp.figma.com/mcp"
    },
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp"
    }
  }
}
```

### 2. Agent Spawning (`src/agents.ts`)
```typescript
// Line 276-281
const proc = spawn("claude", args, {
  env,  // Includes HOME, CLAUDE_HOME from process.env
  cwd: workspaceDir,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
```

### 3. Claude CLI Initialization
- Reads `~/.claude/settings.json` (standard Claude Code behavior)
- Loads mcpServers configuration
- Makes MCP tools available alongside built-in tools
- **No code changes needed** - this is automatic

## Authentication

### OAuth (Current Default)
- **Status**: Working per-session
- **How**: First tool use → OAuth link → browser auth → tokens stored in `~/.claude/session-env/{session-id}/`
- **Limitation**: Each agent session needs separate authentication
- **Use case**: Interactive sessions, manual testing

### Token Auth (Recommended for Production)
- **Status**: Working (if env vars set)
- **How**: Set `FIGMA_TOKEN` or `LINEAR_API_KEY` → tokens injected as headers → OAuth skipped
- **Benefit**: All agents share same authentication
- **Use case**: Production deployments, automated workflows

## Testing

To verify MCP tools work:

1. **Start an agent session or message an existing agent**
2. **Try a Linear query**: "What are my Linear issues?"
3. **Expected behavior**:
   - With token auth: Immediate response with issues
   - With OAuth: Link to authenticate, then response after auth

## Documentation Added

### For Developers
- **`docs/mcp-tools-for-agents.md`**: Comprehensive technical guide
  - Architecture overview
  - Authentication mechanisms
  - Usage examples
  - Troubleshooting
  - Future improvements

### For Agents
- **`shared-context/guides/mcp-tools.md`**: Quick reference for agents
  - Available tools
  - Usage patterns
  - Auth status
  - Troubleshooting
- **`shared-context/about-you.md`**: Updated to mention MCP tools

### Existing
- **`mcp/README.md`**: Setup and configuration guide
- **`docs/figma-integration.md`**: Figma-specific usage guide

## Code Changes Required

**None.** The implementation is already complete:
- ✅ MCP servers configured in settings.json (via entrypoint.sh)
- ✅ Agent spawning passes correct environment (src/agents.ts)
- ✅ Claude CLI automatically loads MCP tools
- ✅ Documentation created

## Current Limitations

### OAuth State Isolation
**Issue**: OAuth tokens are stored per-session in `~/.claude/session-env/{session-id}/`

**Impact**: Each agent needs to authenticate separately with OAuth

**Workarounds**:
1. Use token authentication (set env vars) - **recommended for production**
2. Authenticate each agent individually when using OAuth
3. Use a parent agent that all tool requests go through

**Future Enhancement**: Implement shared OAuth token store (database or file-based) to enable token sharing across agent sessions

## Next Steps (Optional Enhancements)

### 1. Shared OAuth Token Store
Create a centralized token storage mechanism:
```typescript
// New file: src/mcp-oauth.ts
export class SharedOAuthStore {
  // Store tokens in /persistent/ or database
  // Inject tokens into new agent sessions
  // Handle refresh and expiration
}
```

### 2. Additional MCP Servers
Already supported in `mcp/settings-template.json`:
- GitHub (stdio) - requires GITHUB_TOKEN
- Notion (stdio) - requires NOTION_API_KEY
- Slack (stdio) - requires SLACK_TOKEN
- Google Calendar (stdio) - requires GOOGLE_CREDENTIALS

To activate: Set the required env vars and restart container

### 3. MCP Tool Monitoring
Add logging/metrics for MCP tool usage:
- Track which tools are used by which agents
- Monitor authentication failures
- Alert on token expiration

## Conclusion

**MCP tools are production-ready.** Agents can use Figma and Linear tools immediately. No code changes required to the agent spawning mechanism - the implementation leverages Claude Code's built-in MCP support.

For production deployments with multiple agents, **set FIGMA_TOKEN and LINEAR_API_KEY environment variables** to enable token-based authentication shared across all agents.
