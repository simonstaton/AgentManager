#!/usr/bin/env node
/**
 * mcp-bootstrap.js
 *
 * Performs two startup tasks previously embedded as inline `node -e` strings
 * in entrypoint.sh:
 *
 *   1. Injects the API key suffix into ~/.claude.json so the Claude Code trust
 *      dialog auto-approves the current key.
 *
 *   2. Merges MCP server settings from the template at /app/mcp/settings-template.json
 *      into ~/.claude/settings.json, activating only the servers whose required
 *      credentials are present in the environment.
 *
 * Exported functions enable unit testing without spawning a subprocess.
 * Run directly: node scripts/mcp-bootstrap.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. API key suffix injection
// ---------------------------------------------------------------------------

/**
 * Reads ~/.claude.json and adds the last 20 characters of the active API key
 * to customApiKeyResponses.approved so the trust dialog auto-accepts it.
 *
 * @param {object} [opts]
 * @param {string} [opts.claudeJsonPath]  Path to .claude.json (injectable for tests)
 * @param {string} [opts.authKey]         Auth key override (injectable for tests)
 */
function injectApiKeySuffix(opts = {}) {
  const authKey =
    opts.authKey !== undefined
      ? opts.authKey
      : process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';

  if (!authKey) {
    // No key configured — nothing to inject.
    return;
  }

  const claudeJsonPath = opts.claudeJsonPath || '/home/agent/.claude.json';

  if (!fs.existsSync(claudeJsonPath)) {
    console.log('mcp-bootstrap: .claude.json not found, skipping API key suffix injection');
    return;
  }

  const suffix = authKey.slice(-20);

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`mcp-bootstrap: failed to parse ${claudeJsonPath}: ${err.message}`);
  }

  cfg.customApiKeyResponses = { approved: [suffix], rejected: [] };
  fs.writeFileSync(claudeJsonPath, JSON.stringify(cfg, null, 2));
  console.log('mcp-bootstrap: injected API key suffix into .claude.json');
}

// ---------------------------------------------------------------------------
// 2. MCP settings merge
// ---------------------------------------------------------------------------

/**
 * Loads a stored OAuth token for the given MCP server name.
 * Returns null if the token file is absent or expired.
 *
 * @param {string} tokenDir
 * @param {string} serverName
 * @returns {object|null}
 */
function loadStoredToken(tokenDir, serverName) {
  const tokenPath = path.join(tokenDir, serverName + '.json');
  if (!fs.existsSync(tokenPath)) return null;

  let token;
  try {
    token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch (err) {
    console.error(`mcp-bootstrap: failed to load token for ${serverName}: ${err.message}`);
    return null;
  }

  if (token.expiresAt) {
    if (new Date() >= new Date(token.expiresAt)) {
      console.log(`mcp-bootstrap: stored token for ${serverName} is expired`);
      return null;
    }
  }

  return token;
}

/**
 * Merges activated MCP server configs from the template into the settings file.
 *
 * A stdio server is activated when all its env vars are present.
 * An HTTP server is activated when:
 *   - _alwaysActivate is true, OR
 *   - the env var named by _tokenEnv is set, OR
 *   - a valid stored OAuth token exists in tokenDir.
 *
 * @param {object} [opts]
 * @param {string} [opts.templatePath]  Path to settings-template.json
 * @param {string} [opts.settingsPath]  Path to settings.json
 * @param {string} [opts.tokenDir]      Directory containing stored OAuth tokens
 * @param {object} [opts.env]           Environment variables object (injectable for tests)
 */
function mergeMcpSettings(opts = {}) {
  const templatePath = opts.templatePath || '/app/mcp/settings-template.json';
  const settingsPath = opts.settingsPath || '/home/agent/.claude/settings.json';
  const tokenDir = opts.tokenDir || process.env.MCP_TOKEN_DIR || '/persistent/mcp-tokens';
  const env = opts.env || process.env;

  if (!fs.existsSync(templatePath)) {
    // No template — nothing to do. This is a valid configuration.
    return;
  }

  let template;
  try {
    template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  } catch (err) {
    throw new Error(`mcp-bootstrap: failed to parse template ${templatePath}: ${err.message}`);
  }

  let settings;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      throw new Error(`mcp-bootstrap: failed to parse settings ${settingsPath}: ${err.message}`);
    }
  } else {
    // Settings file missing — start with an empty object.
    console.log(`mcp-bootstrap: settings file not found at ${settingsPath}, starting fresh`);
    settings = {};
  }

  const activeMcp = {};

  for (const [name, config] of Object.entries(template.mcpServers || {})) {
    // ── Remote HTTP servers (OAuth + optional token auth) ──
    if (config.type === 'http' && config.url) {
      const alwaysActivate = config._alwaysActivate === true;
      const tokenEnv = config._tokenEnv;
      const tokenVal = tokenEnv ? env[tokenEnv] : null;
      const storedToken = loadStoredToken(tokenDir, name);

      if (!alwaysActivate && !tokenVal && !storedToken) continue;

      const resolved = { type: 'http', url: config.url };

      // Priority: 1. Stored OAuth token, 2. Env var token
      if (storedToken && config._tokenHeader) {
        const prefix = config._tokenPrefix || '';
        resolved.headers = { [config._tokenHeader]: prefix + storedToken.accessToken };
        console.log(`mcp-bootstrap: activated ${name} (OAuth token from storage)`);
      } else if (tokenVal && config._tokenHeader) {
        const prefix = config._tokenPrefix || '';
        resolved.headers = { [config._tokenHeader]: prefix + tokenVal };
        console.log(`mcp-bootstrap: activated ${name} (token auth from env)`);
      } else {
        console.log(
          `mcp-bootstrap: activated ${name} (OAuth - authenticate via /api/mcp/auth/${name})`
        );
      }

      activeMcp[name] = resolved;
      continue;
    }

    // ── Stdio servers (env-var-based activation) ──
    const envVarRefs = Object.values(config.env || {});
    const allPresent = envVarRefs.every((v) => {
      const varName = v.replace(/^\${/, '').replace(/}$/, '');
      return env[varName];
    });

    if (allPresent) {
      const resolved = JSON.parse(JSON.stringify(config));
      for (const [key, val] of Object.entries(resolved.env || {})) {
        const varName = val.replace(/^\${/, '').replace(/}$/, '');
        resolved.env[key] = env[varName] || '';
      }
      activeMcp[name] = resolved;
      console.log(`mcp-bootstrap: activated ${name}`);
    }
  }

  if (Object.keys(activeMcp).length > 0) {
    settings.mcpServers = { ...(settings.mcpServers || {}), ...activeMcp };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`mcp-bootstrap: wrote ${Object.keys(activeMcp).length} MCP server(s) to settings`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (require.main === module) {
  try {
    injectApiKeySuffix();
    mergeMcpSettings();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { injectApiKeySuffix, mergeMcpSettings, loadStoredToken };
