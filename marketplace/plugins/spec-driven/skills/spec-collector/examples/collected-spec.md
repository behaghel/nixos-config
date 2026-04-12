# Example: Well-Collected Spec

This example shows a complete spec produced by the 6-phase collection process. Each section traces back to a specific collection phase.

---

# Spec: JWT Refresh Token Rotation

## Problem

Users are forced to re-authenticate every 15 minutes when their access token expires. This causes session interruption during long workflows (document editing, multi-step forms) and is the top support complaint this quarter.

## Context

- Auth module: `src/auth/` — uses `jsonwebtoken` library, tokens stored in httpOnly cookies
- Existing middleware: `src/middleware/authenticate.ts` validates access tokens on every request
- Token issuance: `src/auth/issueToken.ts` creates access tokens (15min TTL, no refresh flow)
- 47 existing tests in `src/auth/__tests__/` covering current token validation
- Frontend stores no auth state — relies entirely on cookie-based tokens

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Refresh token storage | Database (`users` table, `refresh_token_hash` column) | Enables server-side revocation; team already uses this pattern for API keys |
| Token rotation | Single-use refresh tokens (rotate on every use) | Prevents replay attacks; detects token theft via reuse |
| Reuse detection | Revoke ALL tokens for the user if a used refresh token is presented | Industry standard defense against token theft |
| Access token TTL | Keep at 15 minutes | No change — refresh tokens handle the UX problem |
| Refresh token TTL | 7 days | Balances security with "remember me" convenience |

## Acceptance Criteria

- [ ] AC-1: Given a valid access token that has expired, when the client calls POST /auth/refresh with a valid refresh token cookie, then a new access token and a new refresh token are issued
- [ ] AC-2: Given a refresh token that was just used, when the same refresh token is presented again (replay), then ALL refresh tokens for that user are revoked and the request returns 401
- [ ] AC-3: Given a refresh token older than 7 days, when it is presented, then return 401 with error code REFRESH_TOKEN_EXPIRED
- [ ] AC-4: Given a user who calls POST /auth/logout, when the request completes, then all refresh tokens for that user are revoked
- [ ] AC-5: Given the refresh endpoint, when called without a valid refresh token cookie, then return 401 with error code INVALID_REFRESH_TOKEN
- [ ] AC-6: Given any authenticated endpoint, when the access token is expired and no refresh attempt is made, then return 401 (existing behavior unchanged)

## Invariants

- All 47 existing tests in `src/auth/__tests__/` pass unchanged
- Access token validation logic in `authenticate.ts` middleware is unchanged for non-expired tokens
- No changes to the public API response shapes of any existing endpoints
- No new runtime dependencies

## Scope

**May modify:** `src/auth/issueToken.ts`, `src/auth/refreshToken.ts` (new file), `src/middleware/authenticate.ts` (add refresh awareness), `src/routes/auth.ts` (add refresh and logout endpoints), database migration for `refresh_token_hash` column

**Must not modify:** `src/routes/api.ts`, `src/middleware/rateLimit.ts`, any frontend code, CI pipeline configuration

## Verification Plan

| Criterion | Method | Automated? |
|-----------|--------|------------|
| AC-1 | Integration test: expired access token + valid refresh cookie → new tokens in response | Yes |
| AC-2 | Integration test: reuse spent refresh token → all tokens revoked, 401 returned | Yes |
| AC-3 | Unit test: refresh token with creation date > 7 days ago → 401 REFRESH_TOKEN_EXPIRED | Yes |
| AC-4 | Integration test: POST /auth/logout → all refresh tokens for user deleted from DB | Yes |
| AC-5 | Unit test: refresh endpoint with missing/malformed cookie → 401 INVALID_REFRESH_TOKEN | Yes |
| AC-6 | Existing test: verified by current test suite (no changes needed) | Yes |

## References

- [RFC 6749: OAuth 2.0](https://tools.ietf.org/html/rfc6749) — refresh token specification
- [Auth0: Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) — reuse detection pattern
- Existing auth module: `src/auth/`
- Existing test suite: `src/auth/__tests__/`

---

## Why This Spec Works

- **Problem is concrete:** States why AND quantifies impact
- **Decisions have rationale:** Each choice explains WHY, not just WHAT was chosen
- **Criteria are testable:** Every AC uses Given/When/Then with observable outcomes
- **Scope is file-level:** Clear boundaries, explicit exclusions
- **Verification is mapped:** Every criterion has a specific test type
- **No implementation details:** Says what the system does, not how the code works
