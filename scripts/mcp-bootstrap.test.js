'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { injectApiKeySuffix, mergeMcpSettings, loadStoredToken } = require('./mcp-bootstrap.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bootstrap-test-'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// injectApiKeySuffix
// ---------------------------------------------------------------------------

describe('injectApiKeySuffix', () => {
  let dir;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the last 20 chars of authKey into customApiKeyResponses', () => {
    const claudeJsonPath = path.join(dir, '.claude.json');
    writeJson(claudeJsonPath, { hasCompletedOnboarding: true });

    const authKey = 'sk-ant-' + 'x'.repeat(40);
    injectApiKeySuffix({ claudeJsonPath, authKey });

    const cfg = readJson(claudeJsonPath);
    expect(cfg.customApiKeyResponses.approved).toEqual([authKey.slice(-20)]);
    expect(cfg.customApiKeyResponses.rejected).toEqual([]);
  });

  it('does nothing when authKey is empty', () => {
    const claudeJsonPath = path.join(dir, '.claude.json');
    writeJson(claudeJsonPath, { hasCompletedOnboarding: true });

    injectApiKeySuffix({ claudeJsonPath, authKey: '' });

    const cfg = readJson(claudeJsonPath);
    expect(cfg.customApiKeyResponses).toBeUndefined();
  });

  it('does nothing when .claude.json is missing', () => {
    // Should not throw even if file is absent.
    expect(() =>
      injectApiKeySuffix({
        claudeJsonPath: path.join(dir, 'nonexistent.json'),
        authKey: 'sk-test-key',
      })
    ).not.toThrow();
  });

  it('throws on corrupt .claude.json', () => {
    const claudeJsonPath = path.join(dir, '.claude.json');
    fs.writeFileSync(claudeJsonPath, 'not-json');

    expect(() => injectApiKeySuffix({ claudeJsonPath, authKey: 'sk-test-key' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadStoredToken
// ---------------------------------------------------------------------------

describe('loadStoredToken', () => {
  let dir;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when token file is absent', () => {
    expect(loadStoredToken(dir, 'github')).toBeNull();
  });

  it('returns the token when valid', () => {
    const token = { accessToken: 'abc123' };
    writeJson(path.join(dir, 'github.json'), token);
    expect(loadStoredToken(dir, 'github')).toEqual(token);
  });

  it('returns null when token is expired', () => {
    const token = { accessToken: 'abc123', expiresAt: new Date(0).toISOString() };
    writeJson(path.join(dir, 'github.json'), token);
    expect(loadStoredToken(dir, 'github')).toBeNull();
  });

  it('returns token when expiresAt is in the future', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const token = { accessToken: 'abc123', expiresAt: future };
    writeJson(path.join(dir, 'github.json'), token);
    expect(loadStoredToken(dir, 'github')).toEqual(token);
  });

  it('returns null when token file contains invalid JSON', () => {
    fs.writeFileSync(path.join(dir, 'broken.json'), 'not-json');
    expect(loadStoredToken(dir, 'broken')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeMcpSettings
// ---------------------------------------------------------------------------

describe('mergeMcpSettings', () => {
  let dir;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does nothing when template file is absent', () => {
    const settingsPath = path.join(dir, 'settings.json');
    writeJson(settingsPath, {});

    expect(() =>
      mergeMcpSettings({
        templatePath: path.join(dir, 'missing-template.json'),
        settingsPath,
        tokenDir: dir,
        env: {},
      })
    ).not.toThrow();

    expect(readJson(settingsPath)).toEqual({});
  });

  it('activates a stdio server when all env vars are present', () => {
    const templatePath = path.join(dir, 'settings-template.json');
    const settingsPath = path.join(dir, 'settings.json');

    writeJson(templatePath, {
      mcpServers: {
        myServer: {
          command: 'npx',
          args: ['-y', 'my-mcp-server'],
          env: { MY_TOKEN: '${MY_TOKEN}' },
        },
      },
    });
    writeJson(settingsPath, {});

    mergeMcpSettings({
      templatePath,
      settingsPath,
      tokenDir: dir,
      env: { MY_TOKEN: 'secret-value' },
    });

    const settings = readJson(settingsPath);
    expect(settings.mcpServers.myServer.env.MY_TOKEN).toBe('secret-value');
  });

  it('does not activate a stdio server when required env var is missing', () => {
    const templatePath = path.join(dir, 'settings-template.json');
    const settingsPath = path.join(dir, 'settings.json');

    writeJson(templatePath, {
      mcpServers: {
        myServer: {
          command: 'npx',
          args: [],
          env: { MY_TOKEN: '${MY_TOKEN}' },
        },
      },
    });
    writeJson(settingsPath, {});

    mergeMcpSettings({
      templatePath,
      settingsPath,
      tokenDir: dir,
      env: {}, // MY_TOKEN not present
    });

    const settings = readJson(settingsPath);
    expect(settings.mcpServers).toBeUndefined();
  });

  it('activates an HTTP server with _alwaysActivate', () => {
    const templatePath = path.join(dir, 'settings-template.json');
    const settingsPath = path.join(dir, 'settings.json');

    writeJson(templatePath, {
      mcpServers: {
        remoteService: {
          type: 'http',
          url: 'https://example.com/mcp',
          _alwaysActivate: true,
        },
      },
    });
    writeJson(settingsPath, {});

    mergeMcpSettings({
      templatePath,
      settingsPath,
      tokenDir: dir,
      env: {},
    });

    const settings = readJson(settingsPath);
    expect(settings.mcpServers.remoteService.url).toBe('https://example.com/mcp');
  });

  it('activates an HTTP server from env token and injects auth header', () => {
    const templatePath = path.join(dir, 'settings-template.json');
    const settingsPath = path.join(dir, 'settings.json');

    writeJson(templatePath, {
      mcpServers: {
        svc: {
          type: 'http',
          url: 'https://api.example.com',
          _tokenEnv: 'SVC_TOKEN',
          _tokenHeader: 'Authorization',
          _tokenPrefix: 'Bearer ',
        },
      },
    });
    writeJson(settingsPath, {});

    mergeMcpSettings({
      templatePath,
      settingsPath,
      tokenDir: dir,
      env: { SVC_TOKEN: 'my-api-token' },
    });

    const settings = readJson(settingsPath);
    expect(settings.mcpServers.svc.headers.Authorization).toBe('Bearer my-api-token');
  });

  it('creates settings file if missing', () => {
    const templatePath = path.join(dir, 'settings-template.json');
    const settingsPath = path.join(dir, 'nonexistent-settings.json');

    writeJson(templatePath, {
      mcpServers: {
        svc: {
          type: 'http',
          url: 'https://api.example.com',
          _alwaysActivate: true,
        },
      },
    });

    mergeMcpSettings({
      templatePath,
      settingsPath,
      tokenDir: dir,
      env: {},
    });

    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = readJson(settingsPath);
    expect(settings.mcpServers.svc.url).toBe('https://api.example.com');
  });
});
