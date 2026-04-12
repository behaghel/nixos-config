# Example: Iteration Plan for JWT Refresh Token Rotation

**Source spec:** `spec/auth-refresh-tokens.md`
**Vertical-slice rule:** each iteration must be user-interactive and end-to-end.

| # | Slice Goal | User Interaction Path | Tests to Write First | Expected Red Signal | Minimal Green Target | Feedback Checkpoint |
|---|-----------|----------------------|---------------------|--------------------|--------------------|-------------------|
| 1 | Valid refresh token returns new access token | `POST /auth/refresh` with valid refresh cookie → 200 + new tokens | `TestRefreshHappyPath`: send expired access + valid refresh, assert 200 with new access token and rotated refresh cookie | 404 — endpoint doesn't exist yet | Add `/auth/refresh` route, refresh token table, rotation logic | Demo: curl the endpoint with a crafted refresh cookie. Ask: "Does the response shape match what the frontend expects?" |
| 2 | Reused refresh token revokes all user tokens | `POST /auth/refresh` with already-spent token → 401 + all tokens revoked | `TestRefreshReuse`: use same refresh token twice, assert second call returns 401 and subsequent refresh with any token for that user also fails | Second call returns 200 (reuse not detected) | Track token generation, detect reuse, revoke family | Demo: show the revocation in action with two sequential requests. Ask: "Is revoking ALL tokens the right response, or should we scope to the token family?" |
| 3 | Expired refresh token returns proper error | `POST /auth/refresh` with >7 day old token → 401 REFRESH_TOKEN_EXPIRED | `TestRefreshExpired`: create token with past expiry, assert 401 with correct error code | Returns generic 401 (no expiry-specific error) | Add TTL check before rotation, return typed error | Demo: show error response body. Ask: "Is the error code/message clear enough for the frontend to show the right re-login prompt?" |
| 4 | Logout revokes all refresh tokens | `POST /auth/logout` → all refresh tokens deleted | `TestLogoutRevokesRefresh`: create multiple refresh tokens, call logout, assert all are invalid | Logout doesn't touch refresh tokens | Extend logout handler to delete refresh token rows | Demo: logout then try to refresh. Ask: "Should we also revoke from other devices/sessions?" |
| 5 | Missing/invalid refresh cookie returns 401 | `POST /auth/refresh` with no cookie → 401 INVALID_REFRESH_TOKEN | `TestRefreshNoCookie`, `TestRefreshMalformedCookie`: missing and garbage cookie cases | Unhandled error or 500 | Add input validation at top of refresh handler | Demo: curl without cookie, with garbage. Ask: "Any other malformed input we should handle?" |

## Why this plan works

- **Iteration 1** delivers the core value — users can refresh tokens. Everything after adds safety.
- **Each iteration is exercisable** — curl commands demonstrate the behavior.
- **Feedback checkpoints surface design questions early** — "scope to family?" in iteration 2 could change the data model.
- **Edge cases come last** — iterations 4-5 harden, they don't introduce new architecture.
- **All 47 existing tests remain untouched** — the spec's invariants are preserved by scope.
