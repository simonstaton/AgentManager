import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import {
  type MCPServerConfig,
  MCP_SERVERS,
  exchangeCodeForToken,
  generateAuthUrl,
  getValidToken,
  revokeToken,
  validateState,
} from "../mcp-oauth-manager";
import { getAllTokens, isTokenExpired, loadToken } from "../mcp-oauth-storage";
import { errorMessage } from "../types";

export function createMcpRouter() {
  const router = express.Router();

  /**
   * GET /api/mcp/servers
   * List all configured MCP servers and their auth status
   */
  router.get("/api/mcp/servers", (_req: Request, res: Response) => {
    try {
      const settingsPath = path.join("/home/agent/.claude/settings.json");
      let configuredServers: Record<string, any> = {};

      // Read current MCP settings
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        configuredServers = settings.mcpServers || {};
      }

      // Get stored tokens
      const storedTokens = getAllTokens();
      const tokenMap = new Map(storedTokens.map((t) => [t.server, t]));

      // Build server list
      const servers = Object.entries(MCP_SERVERS).map(([name, config]) => {
        const token = tokenMap.get(name);
        const isConfigured = !!configuredServers[name];

        return {
          name,
          type: config.type,
          url: config.url,
          authRequired: config.authMethod === "oauth",
          authMethod: config.authMethod || "none",
          authenticated: !!token && !isTokenExpired(token),
          authenticatedAt: token?.authenticatedAt,
          configured: isConfigured,
          tokenExpired: token ? isTokenExpired(token) : false,
        };
      });

      res.json({ servers });
    } catch (err) {
      console.error("[MCP-Routes] Error listing servers:", err);
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /api/mcp/auth/:server
   * Initiate OAuth flow for a specific server
   */
  router.post("/api/mcp/auth/:server", (req: Request, res: Response) => {
    try {
      const { server } = req.params;

      if (!MCP_SERVERS[server]) {
        res.status(404).json({ error: `Unknown MCP server: ${server}` });
        return;
      }

      const config = MCP_SERVERS[server];
      if (config.authMethod !== "oauth" || !config.oauthConfig) {
        res.status(400).json({ error: `Server ${server} does not support OAuth` });
        return;
      }

      const authUrl = generateAuthUrl(server);
      if (!authUrl) {
        res.status(500).json({ error: "Failed to generate authorization URL" });
        return;
      }

      console.log(`[MCP-Routes] Initiating OAuth flow for ${server}`);
      res.json({
        authUrl,
        message: "Visit this URL in your browser to authenticate",
        server,
      });
    } catch (err) {
      console.error("[MCP-Routes] Error initiating OAuth:", err);
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/mcp/callback
   * OAuth callback endpoint
   * Query params: code, state
   */
  router.get("/api/mcp/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error, error_description } = req.query;

      // Handle OAuth error responses
      if (error) {
        console.error(`[MCP-Routes] OAuth error:`, error, error_description);
        res.status(400).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authentication Failed</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
                .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
                h1 { color: #c33; }
                code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>❌ Authentication Failed</h1>
                <p><strong>Error:</strong> <code>${error}</code></p>
                ${error_description ? `<p>${error_description}</p>` : ""}
                <p>Please try again or contact support.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      if (!code || !state || typeof code !== "string" || typeof state !== "string") {
        res.status(400).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Invalid Request</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
                .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
                h1 { color: #c33; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>❌ Invalid Request</h1>
                <p>Missing required parameters: code and state</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      // Validate state token
      const server = validateState(state);
      if (!server) {
        console.error("[MCP-Routes] Invalid or expired state token");
        res.status(400).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Invalid State</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
                .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
                h1 { color: #c33; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>❌ Invalid or Expired State</h1>
                <p>The authentication state token is invalid or has expired. Please try again.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      console.log(`[MCP-Routes] Exchanging code for token (server: ${server})`);

      // Exchange authorization code for access token
      const token = await exchangeCodeForToken(server, code);

      if (!token) {
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Token Exchange Failed</title>
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
                .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
                h1 { color: #c33; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>❌ Token Exchange Failed</h1>
                <p>Failed to exchange authorization code for access token. Please try again.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      console.log(`[MCP-Routes] Successfully authenticated ${server}`);

      // Return success page
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                padding: 40px;
                max-width: 600px;
                margin: 0 auto;
                text-align: center;
              }
              .success {
                background: #efe;
                border: 1px solid #cfc;
                padding: 30px;
                border-radius: 8px;
              }
              h1 { color: #3c3; margin-bottom: 20px; }
              .server {
                font-size: 1.2em;
                font-weight: bold;
                color: #333;
                margin: 20px 0;
              }
              p { color: #666; line-height: 1.6; }
              .close-hint {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #ddd;
                font-size: 0.9em;
                color: #999;
              }
            </style>
          </head>
          <body>
            <div class="success">
              <h1>✅ Authentication Successful!</h1>
              <div class="server">${server.toUpperCase()}</div>
              <p>Your ${server} account has been successfully connected.</p>
              <p>You can now close this window and return to Claude Swarm.</p>
              <p>All agents will have access to your ${server} account.</p>
              <div class="close-hint">
                This window can be closed.
              </div>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("[MCP-Routes] Error in OAuth callback:", err);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Error</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
              .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
              h1 { color: #c33; }
            </style>
          </head>
          <body>
            <div class="error">
              <h1>❌ Server Error</h1>
              <p>An unexpected error occurred. Please try again.</p>
              <p><small>${errorMessage(err)}</small></p>
            </div>
          </body>
        </html>
      `);
    }
  });

  /**
   * GET /api/mcp/token/:server
   * Get current token status for a server
   */
  router.get("/api/mcp/token/:server", async (req: Request, res: Response) => {
    try {
      const { server } = req.params;

      if (!MCP_SERVERS[server]) {
        res.status(404).json({ error: `Unknown MCP server: ${server}` });
        return;
      }

      const token = await getValidToken(server);

      if (!token) {
        res.json({
          server,
          authenticated: false,
          message: "No valid token available",
        });
        return;
      }

      res.json({
        server,
        authenticated: true,
        tokenType: token.tokenType,
        scope: token.scope,
        authenticatedAt: token.authenticatedAt,
        expiresAt: token.expiresAt,
        expired: isTokenExpired(token),
      });
    } catch (err) {
      console.error("[MCP-Routes] Error getting token status:", err);
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * DELETE /api/mcp/token/:server
   * Revoke OAuth token for a server
   */
  router.delete("/api/mcp/token/:server", async (req: Request, res: Response) => {
    try {
      const { server } = req.params;

      if (!MCP_SERVERS[server]) {
        res.status(404).json({ error: `Unknown MCP server: ${server}` });
        return;
      }

      const success = await revokeToken(server);

      if (success) {
        console.log(`[MCP-Routes] Revoked token for ${server}`);
        res.json({ success: true, message: `Token revoked for ${server}` });
      } else {
        res.status(404).json({ error: "No token found to revoke" });
      }
    } catch (err) {
      console.error("[MCP-Routes] Error revoking token:", err);
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}
