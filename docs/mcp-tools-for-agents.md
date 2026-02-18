# MCP Tools for Agents

## Overview

MCP (Model Context Protocol) tools are **automatically available** to all agents spawned in the ClaudeSwarm platform. The Claude CLI loads these tools from `~/.claude/settings.json`, which is configured at container startup.

## Currently Available MCP Tools

### Figma
- **Server**: `https://mcp.figma.com/mcp`
- **Authentication**: OAuth (browser-based) or Personal Access Token
- **Capabilities**:
  - Read Figma files and design systems
  - Extract design tokens (colors, typography, spacing)
  - Export assets as SVG or PNG
  - Analyze component structures and variants
  - Generate documentation from Figma libraries

### Linear
- **Server**: `https://mcp.linear.app/mcp`
- **Authentication**: OAuth (browser-based) or API Key
- **Capabilities**:
  - Create, read, update, and search issues
  - Manage projects, teams, and workflows
  - Assign issues and update status
  - Query issue relationships and dependencies
  - Bulk operations on issues

## How MCP Tools Work

### Automatic Loading
1. Container starts → `entrypoint.sh` runs
2. Script reads `mcp/settings-template.json`
3. For each MCP server:
   - **HTTP servers with `_alwaysActivate: true`** → Always added to settings.json
   - **Stdio servers** → Only added if required env vars are present
4. Merged config written to `~/.claude/settings.json`
5. All agent `claude` CLI processes automatically load from this file

### Tool Discovery
MCP tools appear alongside built-in Claude Code tools (Bash, Read, Write, etc.). You can use them just like any other tool - the Claude model will automatically invoke them when appropriate.

Example:
```
User: "What are my assigned Linear issues?"
→ Claude automatically calls Linear MCP tools to query issues
→ Returns formatted results
```

## Authentication

### OAuth Authentication (Recommended for Interactive Use)

**How it works:**
- MCP servers (Figma, Linear) are activated on startup
- First time a tool is used, Claude Code prompts for OAuth authentication
- User clicks a link and authenticates in browser
- OAuth tokens stored in `~/.claude/session-env/{session-id}/`
- **Limitation**: Each agent session has its own session-env directory

**To authenticate:**
1. Message an agent or start a session
2. Try using a Figma or Linear tool (e.g., "What are my Linear issues?")
3. Claude will provide an OAuth link
4. Click the link and authenticate
5. Authentication persists for that agent's session

**Cross-agent limitation:**
OAuth tokens are session-specific. If Agent A authenticates with Linear, Agent B will need to authenticate separately. This is a current limitation of the session-based OAuth storage.

### Token Authentication (Recommended for Production)

**How it works:**
- Set environment variables at container startup
- Tokens injected as headers to MCP HTTP requests
- OAuth flow is skipped entirely
- All agents share the same authentication

**Environment variables:**
- `FIGMA_TOKEN` - Personal Access Token from Figma Settings
- `LINEAR_API_KEY` - API Key from Linear Settings

**For production:**
Add to `terraform/terraform.tfvars`:
```hcl
figma_token    = "figd_xxxxx"
linear_api_key = "lin_api_xxxxx"
```

Then deploy:
```bash
cd terraform
terraform apply
gcloud run services update claude-swarm \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/claude-swarm/claude-swarm:latest \
  --region=$REGION --project=$PROJECT_ID
```

## Usage Examples

### Linear Integration

**Query issues:**
```
"What are my assigned Linear issues?"
"Show me all high-priority bugs in the Backend project"
"Find issues related to authentication"
```

**Create issues:**
```
"Create a Linear issue for adding dark mode support"
"Create a bug report for the login flow timeout"
```

**Update issues:**
```
"Move issue FE-123 to In Progress"
"Assign issue BACK-456 to the DevOps team"
"Update issue FE-123 description to include reproduction steps"
```

### Figma Integration

**Analyze designs:**
```
"Extract the color palette from https://www.figma.com/file/ABC123/Design-System"
"Document all typography styles from our Figma library"
"What spacing tokens are defined in the design system?"
```

**Export assets:**
```
"Export all icons from the 'Icons' frame as SVG"
"Get the logo from the Figma file as PNG"
```

**Generate code:**
```
"Create React components based on the button variants in Figma"
"Generate CSS variables from the Figma color tokens"
```

## Troubleshooting

### "Tool not found" errors
**Cause**: MCP server not activated in settings.json
**Fix**:
1. Check `cat ~/.claude/settings.json` to verify mcpServers section exists
2. If missing, check container startup logs for MCP activation messages
3. Restart container if env vars were added after startup

### OAuth authentication failing
**Cause**: Session-specific OAuth storage, browser authentication issues
**Fix**:
1. Try the OAuth flow in the specific agent's session
2. Check browser console for CORS or network errors
3. Consider using token authentication instead for production use

### "Permission denied" errors
**Cause**: OAuth token or API key doesn't have access to requested resource
**Fix**:
1. Verify the authenticated user has access to the Figma file or Linear project
2. Check that API keys have appropriate scopes
3. Re-authenticate with a user that has proper permissions

### Tools work for one agent but not another
**Cause**: OAuth authentication is session-specific
**Fix**:
1. Each agent needs to authenticate separately with OAuth
2. Use token authentication (env vars) to share auth across all agents
3. This is a known limitation of session-based OAuth storage

## Implementation Details

### Settings Structure
```json
{
  "mcpServers": {
    "figma": {
      "type": "http",
      "url": "https://mcp.figma.com/mcp",
      "headers": {
        "Authorization": "Bearer figd_xxxxx"  // Only if token provided
      }
    },
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer lin_api_xxxxx"  // Only if token provided
      }
    }
  }
}
```

### Agent Spawning Flow
1. `AgentManager.create()` called with prompt
2. `buildClaudeArgs()` constructs CLI arguments
3. `spawn("claude", args, { env, cwd })` starts agent process
4. Claude CLI reads `~/.claude/settings.json`
5. MCP servers loaded and tools become available
6. Agent can immediately use MCP tools

### OAuth Storage Location
- **Settings**: `~/.claude/settings.json` (shared across all agents)
- **Session auth**: `~/.claude/session-env/{session-id}/` (per-agent)
- **Issue**: OAuth tokens in session-env are not shared between agents

## Future Improvements

### OAuth State Sharing
To enable OAuth authentication sharing across agents, we would need to:
1. Implement a shared OAuth token store (database or file-based)
2. Intercept OAuth callbacks and persist tokens globally
3. Inject stored tokens into new agent sessions
4. Handle token refresh and expiration

This is not currently implemented, so **token authentication is recommended for production** where multiple agents need the same MCP access.

### Additional MCP Servers
The platform can be extended with more MCP servers by:
1. Adding to `mcp/settings-template.json`
2. Setting required environment variables
3. Restarting the container
4. Tools automatically available to all agents

Potential integrations:
- GitHub (already supported via stdio)
- Notion (already supported via stdio)
- Slack (already supported via stdio)
- Google Calendar (already supported via stdio)
- Jira (would need HTTP MCP server)
- Confluence (would need HTTP MCP server)
