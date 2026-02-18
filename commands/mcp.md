# MCP Server Authentication

Check the authentication status of available MCP servers and get OAuth URLs for browser authentication.

**Available MCP Servers:**
- **Figma** — Design and prototyping tool (OAuth or token-based)
- **Linear** — Project management and issue tracking (OAuth or token-based)
- **GitHub** — Version control and collaboration (token-based via GITHUB_TOKEN)
- **Notion** — Workspace and documentation (token-based via NOTION_API_KEY)
- **Slack** — Team communication (token-based via SLACK_TOKEN)
- **Google Calendar** — Calendar integration (token-based via GOOGLE_CREDENTIALS)

## How Authentication Works

**Remote HTTP servers (Figma, Linear):**
- Support two authentication modes:
  1. **OAuth (browser-based)** — No token needed, authenticate via browser when first using the tool
  2. **Token auth** — If an API key env var is set, it's used automatically (skips OAuth)

**Stdio servers (GitHub, Notion, Slack, Google Calendar):**
- Require API tokens provided via environment variables
- Only activated when their required env vars are present

## Checking Authentication Status

Run the following script to see which MCP servers are configured and their authentication status:

```bash
# Read MCP settings
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "=== MCP SERVER STATUS ==="
echo ""

if [ ! -f "$SETTINGS_FILE" ]; then
  echo "No MCP settings found at $SETTINGS_FILE"
  exit 0
fi

# Parse and display MCP servers
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
const mcpServers = settings.mcpServers || {};

if (Object.keys(mcpServers).length === 0) {
  console.log('No MCP servers are currently configured.');
  console.log('');
  console.log('To enable MCP servers, set the required environment variables:');
  console.log('  GITHUB_TOKEN, NOTION_API_KEY, SLACK_TOKEN, FIGMA_TOKEN, LINEAR_API_KEY');
  console.log('');
  console.log('Or use OAuth for Figma and Linear (no tokens needed).');
  process.exit(0);
}

console.log('Configured MCP servers:\\n');

for (const [name, config] of Object.entries(mcpServers)) {
  const type = config.type || 'stdio';

  if (type === 'http') {
    // Remote HTTP server
    const hasToken = config.headers && config.headers.Authorization;
    const authMode = hasToken ? 'Token auth' : 'OAuth (requires browser authentication)';
    console.log(\`✓ \${name} (\${type})\`);
    console.log(\`  URL: \${config.url}\`);
    console.log(\`  Auth: \${authMode}\`);

    if (hasToken === false) {
      // Provide OAuth instructions
      console.log(\`  → Authenticate by using the tool — Claude Code will prompt for OAuth\`);
      console.log(\`  → Alternative: Set \${name.toUpperCase()}_TOKEN env var to use token auth\`);
    }
  } else {
    // Stdio server (always has token if activated)
    console.log(\`✓ \${name} (\${type})\`);
    console.log(\`  Command: \${config.command} \${(config.args || []).join(' ')}\`);
    console.log(\`  Auth: Token configured\`);
  }
  console.log('');
}
" || echo "Failed to parse MCP settings"
```

## OAuth Authentication Flow

For **Figma** and **Linear**, if they are configured without tokens, Claude Code will automatically prompt you to authenticate via browser when you first try to use them.

**Example:**
```
User: "Show me my Linear issues"
Claude: To use Linear, you need to authenticate. Please visit this URL...
[OAuth URL will be provided by Claude Code's MCP handler]
```

The authentication happens automatically through Claude Code's built-in MCP OAuth support — no additional setup needed.

## Getting API Tokens (Optional)

If you prefer token-based auth instead of OAuth:

- **Figma**: [Figma Settings > Personal Access Tokens](https://www.figma.com/settings) → Set `FIGMA_TOKEN`
- **Linear**: [Linear Settings > API](https://linear.app/settings/api) → Set `LINEAR_API_KEY`
- **GitHub**: [GitHub Settings > Tokens](https://github.com/settings/tokens) → Set `GITHUB_TOKEN`
- **Notion**: [Notion Integrations](https://www.notion.so/my-integrations) → Set `NOTION_API_KEY`
- **Slack**: [Slack API > Your Apps](https://api.slack.com/apps) → Set `SLACK_TOKEN`

Tokens should be set as environment variables in your deployment configuration (Terraform, .env file, Cloud Run, etc.).

## Summary

After running the script above, you'll see:
- Which MCP servers are currently active
- Their authentication status (token-based or OAuth)
- OAuth instructions for servers that need browser authentication

$ARGUMENTS
