# Authentication migration contract

Baseline: `leedoekahn401/stiu_base@4b52a4c260a57b288d58048a96565e93ba554b4f`.
Sources: AuthController, DevAuthController, RefreshTokenService, AuthAccountService,
AuthCookies, JwtTokenHelper, OAuth2/OIDC success/failure handlers and origin filter.

| Route | Behavior |
| --- | --- |
| POST `/api/auth/refresh` | JSON refreshToken takes precedence when nonblank; otherwise refreshToken cookie. Rotate once, return accessToken/refreshToken/tokenType=Bearer/expiresIn and two HttpOnly cookies. |
| POST `/api/auth/logout` | Revoke the supplied live refresh token, clear both cookies, 204. Missing/unknown token is allowed. |
| POST `/api/auth/dev-login` | Separate opt-in development-only route; email/name/role defaults match Java. Existing account roles win. Soft-deleted accounts return 409. |
| GET `/oauth2/authorization/google` | Begin OIDC authorization-code login with state, nonce and S256 PKCE. |
| GET `/login/oauth2/code/google` | Validate callback, exchange code, verify ID-token signature/issuer/audience/nonce/time and userinfo subject, provision/link local account, set cookies and redirect to fixed frontend URL. |

## Flags and ownership

AUTH_API_ENABLED requires READ_API_ENABLED and the same raw APP_JWTSECRET as Java.
Both default false. AUTH_DEV_LOGIN_ENABLED, GOOGLE_OAUTH_ENABLED and
AUTH_CLEANUP_ENABLED are independent and default false; each requires Auth enabled.
Dev login is rejected at startup in NODE_ENV=production. Production Auth requires
AUTH_COOKIE_SECURE=true. No password login or registration endpoint is introduced.

Auth transactions are gated independently of Academic/Vocabulary/Assessment writes.
The existing Java schema is reused: users, user_roles, oauth_accounts, refresh_tokens.
No migration or data import is required. Database migrations remain Java-owned.

Access tokens use HS256, subject=user UUID, sorted database roles, iat/exp seconds.
APP_JWTEXPIRATIONMS defaults 900000 (15 minutes); APP_JWTREFRESHEXPIRATIONMS defaults
604800000 (7 days). Set these to the Java deployment's actual values. Refresh
secrets are 32 random bytes, base64url without padding. Only their SHA-256 hashes
are stored. Cookies token/refreshToken are Path=/, HttpOnly, SameSite=Lax with
optional Secure and the corresponding lifetime. Logout expires both.

A refresh performs one conditional atomic UPDATE: matching hash, not revoked and
expires_at > now. Two concurrent refreshes yield one success and one unauthorized.
Reuse of a revoked/used token deletes all refresh sessions for that user, and the
delete commits despite the 401 response. The winning concurrent response may thus
already contain an invalidated refresh token: this is Java's theft-detection policy.
Expired unused tokens return 401 without being marked used. Deleted accounts
cannot refresh. Logout does not revoke already-issued stateless access JWTs;
these remain valid until expiry while the account stays active, matching Java.

Cookies can authenticate browser requests, so unsafe Auth requests enforce the
existing Java Origin/Referer allow-list policy, including its Bearer exemption
and acceptance of non-browser requests without either header. JSON responses
never expose database/exception details. Token values and provider errors are not
logged. OAuth errors expose only access_denied, email_not_verified,
account_disabled, invalid_user_info or the fallback oauth_failed.

## Google account linking

Google login uses openid-client 6 (locked dependency), including signature checks.
Client credentials use the existing Spring-style environment names. Set
GOOGLE_CALLBACK_URI to the backend `/login/oauth2/code/google` URL and register
that exact URI in Google Cloud. APP_OAUTH2_REDIRECTURI is the fixed frontend URL,
default http://localhost:3000/oauth2/redirect. Request parameters and Host headers
cannot override these URLs. HTTPS is required for production redirects.

Only https://accounts.google.com is accepted outside tests. An HTTP loopback
issuer override is allowed exclusively in NODE_ENV=test for the local mock.
Discovery/network operations have a five-second timeout and failed discovery can
retry. No access/refresh provider token is persisted. Transient login state is
AES-256-GCM encrypted in an HttpOnly, SameSite=Lax cookie scoped to the callback,
expires after ten minutes, and is cleared on callback. All instances need the
same JWT secret. This replaces Java's internal session storage; unfinished Java
OAuth flows should complete on Java during cutover, or users restart login on TS.

A linked active provider identity signs into its existing user without changing
stored name/email/roles. New links require a verified provider email; an existing
local account with that email keeps its roles. New accounts get STUDENT. Deleted
emails cannot be recreated. Java's ORM hides linked deleted users, so these fall
through the unlinked-account validation path; that behavior is preserved. Unknown
provider/database failures redirect with oauth_failed rather than leaking details.

## Cleanup and deployment

AUTH_CLEANUP_ENABLED optionally deletes expired refresh rows at 03:30 server local
time. It is off by default; keep Java cleanup as owner until deliberately switched.
Shutdown cancels the timer and waits for in-flight cleanup. Align the Java/Node
server time zones (TZ) because refresh expiry uses the existing timestamp WITHOUT
time zone columns. Start/resume business expiry ownership is unchanged.

Before traffic cutover: provision staging credentials outside Git, register the
callback, align JWT secret/lifetimes/TZ/cookie policy, test real browser Google
login and verify cross-backend refresh. No real Google credentials, staging or
production deployment is exercised by this PR.

## Verification

55 Auth session cases and 30 OIDC browser-flow cases are mandatory alongside the
1,597 existing comparisons: 1,682 total. OIDC uses a loopback provider issuing real
RSA-signed ID tokens and serves discovery/token/userinfo/JWKS endpoints. It exercises
both Java and TypeScript, valid create/link/relogin, disabled/unverified users,
missing identity data and rejection of wrong state, missing cookie, nonce,
signature, issuer, audience and expiry. Session tests cover hash-only storage,
rotation/replay persisted invalidation, expired/unknown tokens, cookie/body
precedence, logout, concurrent refresh and Java-to-TS / TS-to-Java refresh.
A forced late token-insert failure verifies transaction rollback and retry.
Cleanup is invoked directly on an expired fixture; the real daily clock schedule
is not waited for in tests. No claim of live Google deployment is made.

References: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)
and [openid-client](https://github.com/panva/openid-client).
