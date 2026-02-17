# Figma Integration Guide

ClaudeSwarm supports Figma MCP (Model Context Protocol) integration, allowing Claude agents to interact with Figma files, components, and design systems directly.

## Features

With Figma MCP enabled, agents can:

- **Read Figma files**: Access file structure, frames, and component hierarchies
- **Inspect designs**: Extract design tokens, colors, typography, and spacing
- **Export assets**: Retrieve images and SVGs from Figma frames
- **Analyze components**: Review component properties and variants
- **Design system documentation**: Auto-generate documentation from Figma libraries

## Setup

### 1. Get a Figma Personal Access Token

1. Go to [Figma Settings](https://www.figma.com/settings)
2. Scroll to **Personal Access Tokens**
3. Click **Create new token**
4. Give it a descriptive name (e.g., "ClaudeSwarm Agent Access")
5. Copy the token (it starts with `figd_`)

### 2. Add Token to Environment

#### For local development

Add to `.env`:

```bash
FIGMA_TOKEN=figd_your_token_here
```

#### For production (Terraform)

Add to `terraform/terraform.tfvars`:

```hcl
figma_token = "figd_your_token_here"
```

Then apply and redeploy:

```bash
cd terraform
terraform apply
gcloud run services update claude-swarm \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/claude-swarm/claude-swarm:latest \
  --region=$REGION --project=$PROJECT_ID
```

### 3. Verify Configuration

The Figma MCP server is pre-configured in `mcp/settings-template.json`. On startup, if `FIGMA_TOKEN` is present, the MCP server will automatically activate.

## Usage Examples

### Inspecting a Figma File

```
Agent: Can you analyze the design system in this Figma file?
https://www.figma.com/file/ABC123/Design-System

Agent will:
- Read the file structure
- Extract color palette
- Document typography scale
- List component variants
```

### Exporting Assets

```
Agent: Export all icons from the "Icons" frame as SVG
```

### Design-to-Code

```
Agent: Generate React components based on the button variants
in frame "Button Components"
```

### Documentation Generation

```
Agent: Create a markdown document of our design tokens
from the Figma library
```

## API Access in Code

Agents can also use the Figma REST API directly for custom workflows:

```bash
# Get file metadata
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/FILE_KEY"

# Export images
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/FILE_KEY?ids=NODE_ID&format=svg"
```

## Permissions & Security

- Figma tokens grant access to all files the token owner can view
- Tokens are stored as environment variables and injected securely
- In production, tokens are managed via GCP Secret Manager
- Never commit tokens to version control

## Troubleshooting

### MCP Server Not Loading

Check that:
1. `FIGMA_TOKEN` is set in your environment
2. The token is valid and not expired
3. Agent container has been restarted after adding the token

### Permission Denied Errors

Ensure:
- The Figma token has access to the requested file
- The file URL is correct and publicly accessible or shared with the token owner

### Rate Limits

Figma API has rate limits:
- 1000 requests per minute per token
- Agents should implement retry logic for rate limit errors

## Additional Resources

- [Figma API Documentation](https://www.figma.com/developers/api)
- [Figma MCP Server Source](https://github.com/anthropics/anthropic-mcp-servers/tree/main/figma)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
