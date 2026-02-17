# MCP Server Configuration

MCP (Model Context Protocol) servers give Claude agents access to external tools like Notion, GitHub, Slack, etc.

## How it works

On startup, the entrypoint reads `mcp/settings-template.json`, replaces `${VAR_NAME}` placeholders with actual env var values, and merges the result into `~/.claude/settings.json`. Only MCP servers whose required env vars are ALL present get activated.

The `gh` CLI automatically uses the `GITHUB_TOKEN` env var for authentication — no `gh auth login` needed. On container startup, `gh auth setup-git` configures git to use `gh` as a credential helper, so `git push` and `git fetch` to GitHub repos also work automatically.

## Adding credentials

### Via Terraform (production)

Add your tokens to `terraform/terraform.tfvars`:

```hcl
github_token   = "ghp_xxxxx"   # or fine-grained: "github_pat_xxxxx"
notion_api_key = "ntn_xxxxx"
slack_token    = "xoxb-xxxxx"
```

Then apply and redeploy:

```bash
cd terraform
terraform apply
gcloud run services update claude-swarm \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/claude-swarm/claude-swarm:latest \
  --region=$REGION --project=$PROJECT_ID
```

Terraform handles creating the secrets in Secret Manager and injecting them as env vars into Cloud Run. No manual `gcloud secrets` commands needed.

### For local development

Add tokens to your `.env` file (gitignored):

```
GITHUB_TOKEN=ghp_xxxxx
NOTION_API_KEY=ntn_xxxxx
SLACK_TOKEN=xoxb-xxxxx
```

Then `npm run dev` — the entrypoint auto-merges MCP settings when these env vars are present.

## Available integrations

| Server | Env var | Where to get it |
|--------|---------|-----------------|
| GitHub | `GITHUB_TOKEN` | [GitHub Settings > Tokens](https://github.com/settings/tokens) — classic PAT with `repo` scope, or [fine-grained token](https://github.com/settings/personal-access-tokens/new) with Contents + Pull requests (read/write) |
| Notion | `NOTION_API_KEY` | [Notion Integrations](https://www.notion.so/my-integrations) |
| Google Calendar | `GOOGLE_CREDENTIALS` | Google Cloud Console → APIs & Services → Credentials |
| Slack | `SLACK_TOKEN` | [Slack API > Your Apps](https://api.slack.com/apps) → OAuth & Permissions |
| Figma | `FIGMA_TOKEN` | Figma → Settings → Personal Access Tokens ([full setup guide](../docs/figma-integration.md)) |

## Usage Examples

### Figma Integration

Once `FIGMA_TOKEN` is configured, agents can:

```
# Analyze a design file
"Can you extract the color palette from
https://www.figma.com/file/ABC123/Design-System ?"

# Export assets
"Export all icons from the 'Icons' frame as SVG"

# Generate code from designs
"Create React components based on the button variants
in the Figma file"

# Document design systems
"Generate a markdown file documenting all typography
styles from our Figma library"
```

See [docs/figma-integration.md](../docs/figma-integration.md) for detailed examples and API usage.
