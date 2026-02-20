# Phase 5.2: Two-Factor Authentication on First Login

**Status:** Planned
**Priority:** Medium
**Estimated effort:** 3-4 days
**Depends on:** None (standalone auth enhancement)

---

## Problem

The current authentication model uses a single shared API key (`API_KEY` env var) exchanged for a JWT via `POST /api/auth/token`. There is no per-user identity and no second authentication factor. Anyone with the API key has full access to the system. Adding 2FA provides a meaningful security layer, especially for a system that runs code with `--dangerously-skip-permissions`.

---

## Architecture Overview

### Auth Flow Today

```
Client                          Server
  |                               |
  |  POST /api/auth/token         |
  |  { apiKey: "shared-key" }     |
  |------------------------------>|
  |                               |  validate apiKey === API_KEY
  |  { token: "jwt..." }         |
  |<------------------------------|
  |                               |
  |  GET /api/agents              |
  |  Authorization: Bearer jwt    |
  |------------------------------>|
```

### Auth Flow with 2FA

**First login (2FA not yet set up):**

```
Client                          Server
  |                               |
  |  POST /api/auth/token         |
  |  { apiKey: "shared-key" }     |
  |------------------------------>|
  |                               |  validate apiKey
  |                               |  detect: no TOTP secret stored
  |  { setupRequired: true,      |
  |    challengeToken: "..." }   |
  |<------------------------------|
  |                               |
  |  (User scans QR code)        |
  |                               |
  |  POST /api/auth/2fa/setup    |
  |  { challengeToken: "...",    |
  |    totpCode: "123456" }      |
  |------------------------------>|
  |                               |  verify TOTP code against secret
  |                               |  store encrypted TOTP secret
  |                               |  generate backup codes
  |  { token: "jwt...",          |
  |    backupCodes: [...] }      |
  |<------------------------------|
```

**Subsequent logins (2FA configured):**

```
Client                          Server
  |                               |
  |  POST /api/auth/token         |
  |  { apiKey: "shared-key" }     |
  |------------------------------>|
  |                               |  validate apiKey
  |                               |  detect: TOTP secret exists
  |  { totpRequired: true,       |
  |    challengeToken: "..." }   |
  |<------------------------------|
  |                               |
  |  POST /api/auth/2fa/verify   |
  |  { challengeToken: "...",    |
  |    totpCode: "123456" }      |
  |------------------------------>|
  |                               |  verify TOTP code
  |  { token: "jwt..." }         |
  |<------------------------------|
```

---

## Detailed Design

### 1. TOTP Implementation (RFC 6238)

Use the `otpauth` npm package for TOTP generation and verification.

**Secret generation:**
```typescript
import { TOTP } from "otpauth";

function generateTotpSecret(): { secret: string; uri: string } {
  const totp = new TOTP({
    issuer: "AgentManager",
    label: "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  return {
    secret: totp.secret.base32,
    uri: totp.toString(),  // otpauth:// URI for QR code
  };
}
```

**Code verification:**
```typescript
function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  // Allow 1 period of clock skew in each direction
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
```

### 2. Challenge Tokens

Short-lived tokens that bind the API key validation step to the 2FA verification step. Prevents replay attacks where someone intercepts the API key exchange and skips 2FA.

```typescript
interface ChallengeToken {
  token: string;         // crypto.randomUUID()
  createdAt: number;     // Date.now()
  expiresAt: number;     // createdAt + 5 minutes
  apiKeyValid: boolean;  // always true (only issued after API key check)
  used: boolean;         // set true after successful 2FA
}
```

- Stored in-memory `Map<string, ChallengeToken>`
- TTL: 5 minutes
- Single use: marked as used after verification
- Cleaned up on a 1-minute interval

### 3. Secret Storage

The TOTP secret must be stored encrypted at rest.

**Encryption:**
- Algorithm: AES-256-GCM
- Key derivation: HKDF from `JWT_SECRET` env var (already exists)
- Storage location: `/persistent/auth/totp.enc` (JSON file with encrypted secret and IV)

```typescript
interface StoredTotpConfig {
  encryptedSecret: string;  // base64-encoded ciphertext
  iv: string;               // base64-encoded IV
  tag: string;              // base64-encoded auth tag
  createdAt: string;        // ISO timestamp
  backupCodesHash: string[];  // bcrypt hashes of unused backup codes
}
```

### 4. Backup Codes

Generated during 2FA setup. Each code is a random 8-character alphanumeric string.

- Generate 10 backup codes
- Store bcrypt hashes (not plaintext)
- Each code is single-use: remove its hash after successful use
- Show codes to user exactly once during setup
- Backup codes work as an alternative to TOTP in the verify endpoint

### 5. JWT Changes

Add an `mfa` claim to the JWT payload:

```typescript
interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  mfa: boolean;  // true if 2FA was completed for this session
}
```

- When 2FA is enabled, only JWTs with `mfa: true` are accepted for protected endpoints
- Agent-service tokens (issued to running agents) skip 2FA -- they are internal and trusted

### 6. API Endpoints

**Modified:**
- `POST /api/auth/token` -- returns `{ totpRequired: true, challengeToken }` or `{ setupRequired: true, challengeToken, qrUri }` instead of a JWT when 2FA is enabled/needed

**New:**
- `POST /api/auth/2fa/setup` -- complete first-time 2FA setup
  - Body: `{ challengeToken, totpCode }`
  - Response: `{ token: "jwt...", backupCodes: ["code1", "code2", ...] }`
- `POST /api/auth/2fa/verify` -- verify TOTP code on login
  - Body: `{ challengeToken, totpCode }` or `{ challengeToken, backupCode }`
  - Response: `{ token: "jwt..." }`
- `POST /api/auth/2fa/disable` -- disable 2FA (requires valid JWT with `mfa: true`)
  - Body: `{ totpCode }` (confirm with current code)
  - Response: `{ success: true }`
- `GET /api/auth/2fa/status` -- check if 2FA is configured
  - Response: `{ enabled: boolean }`

---

## File Structure

```
src/
  auth/
    index.ts            -- re-exports, auth middleware updates
    totp.ts             -- TOTP generation, verification, secret management
    challenge.ts        -- Challenge token store
    backup-codes.ts     -- Backup code generation and verification
    auth.test.ts        -- Unit tests
  routes/
    auth.ts             -- Updated auth routes with 2FA endpoints

ui/src/
  components/
    TwoFactorSetup.tsx  -- QR code display, code entry, backup code display
    TwoFactorVerify.tsx -- TOTP code entry on login
  views/
    LoginView.tsx       -- Updated to handle 2FA flow states
```

---

## UI Flow

### First Login (Setup)

1. User enters API key on login screen
2. Server responds with `setupRequired: true` and a QR code URI
3. UI shows:
   - QR code (rendered client-side from URI using `qrcode` package)
   - Manual entry secret for users who cannot scan
   - Text input for the 6-digit verification code
4. User scans QR with authenticator app, enters code
5. Server verifies, returns JWT and backup codes
6. UI shows backup codes with a "I've saved these" confirmation button
7. User proceeds to dashboard

### Subsequent Login

1. User enters API key on login screen
2. Server responds with `totpRequired: true`
3. UI shows a 6-digit code input field
4. User enters code from authenticator app
5. Server verifies, returns JWT
6. User proceeds to dashboard

### Backup Code Recovery

- "Lost your authenticator?" link on the TOTP entry screen
- Switches to a backup code input field
- After successful backup code use, warn user about remaining backup codes

---

## Security Considerations

1. **Rate limiting**: Max 5 failed TOTP attempts per challenge token, then invalidate it
2. **Timing-safe comparison**: Use `crypto.timingSafeEqual` for TOTP verification (handled by `otpauth` library)
3. **Secret encryption at rest**: TOTP secret encrypted with AES-256-GCM derived from JWT_SECRET
4. **No secret exposure**: TOTP secret is only shown during initial setup, never retrievable after
5. **Clock skew tolerance**: Accept codes from 1 period before and after current time (+-30 seconds)
6. **Backup code hashing**: Backup codes stored as bcrypt hashes, not plaintext
7. **Challenge token binding**: Prevents skipping 2FA by requiring a valid challenge token for verification

---

## Dependencies

New npm packages:
- `otpauth` -- TOTP implementation (RFC 6238)
- `qrcode` (UI) -- QR code rendering from otpauth URI

Both are well-maintained, widely used, and have no known vulnerabilities.

---

## Implementation Sequence

1. **TOTP module**: `src/auth/totp.ts` with secret generation, verification, encrypted storage
2. **Challenge tokens**: `src/auth/challenge.ts` with in-memory store and cleanup
3. **Backup codes**: `src/auth/backup-codes.ts` with generation and bcrypt verification
4. **Auth route updates**: Modify `POST /api/auth/token`, add new 2FA endpoints
5. **JWT updates**: Add `mfa` claim, update middleware to check it
6. **UI setup flow**: `TwoFactorSetup.tsx` with QR code and verification
7. **UI verify flow**: `TwoFactorVerify.tsx` with code entry
8. **Login view updates**: Handle the three states (no 2FA, setup required, verify required)
9. **Tests**: Unit tests for TOTP, challenge tokens, backup codes, and route handlers

---

## Open Questions

- **Multi-user support**: The current system has a single shared API key with no per-user identity. Should 2FA be tied to the single shared session, or should this be the trigger to add per-user accounts? Suggest starting with single-session 2FA (simpler) and adding user accounts as a separate future initiative.
- **Agent tokens**: Agents use service tokens that bypass 2FA. Should there be a mechanism to scope agent tokens more narrowly? Suggest deferring to a future RBAC initiative.
- **2FA enforcement**: Should 2FA be optional or mandatory? Suggest optional initially, controlled by a `REQUIRE_2FA=true` env var that defaults to false.

---

*Phase 5.2 - Two-Factor Authentication | AgentManager V3*
