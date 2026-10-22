> Historical source documentation imported from stiu_base/api-ts. See the root README for commands in this repository.

# Phase 3: first migrated read APIs

Implemented (opt-in, no traffic routing changes):

- GET /api/users/me: id, name, email, roles.
- GET /api/users/all, /api/users/by-email and /api/users/{id}: ADMIN-only full user
  information (including createdAt, updatedAt, lastAccessAt), excluding deleted users.
- GET /api/academic/topics and /api/academic/skills: classification DTOs and
  Spring's configured VIA_DTO pagination (`content` and `page`).

## Enable locally

Keep `READ_API_ENABLED=false` until configuring the shared Java JWT secret.
In the ignored `.env`, set READ_API_ENABLED=true and APP_JWTSECRET to exactly
the existing Java app.jwtSecret value (raw UTF-8, not base64-decoded).
The secret must contain at least 32 UTF-8 bytes. Restart `npm run dev`.
Keep your existing DATABASE_URL and explicit CORS allowlist.

Use an existing Java-issued token in `Authorization: Bearer ...` or cookie `token`.
Bearer takes precedence, including when it is invalid. OAuth2, refresh and logout
remain on Java; these endpoints do not issue tokens or change cookies.
Only HS256 (the algorithm Java issues) is allowed. No JWT role claim grants access:
roles are loaded from users/user_roles for every request. Missing/deleted users,
invalid/expired tokens and authentication DB errors return Java-compatible 401.

Topics and skills require TEACHER or ADMIN. Only ADMIN can include archived rows;
TEACHER requests with includeArchived=true still return active rows only.
Sorting uses whitelisted properties, bound paging values and read-only transactions.
No migrations, seeds or writes execute in the application. Health endpoints remain
available without enabling the migrated API. Disabled read endpoints return 404.

## Contract verification

The differential test starts NestJS and calls an actual Java baseline on the same
disposable database named **stiu_read_api_test**. Java migrates that test database;
the test uses Java's dev-login and authoring endpoints to create fixtures.
Never point the test at your normal local, staging or production database.
The Java baseline must have dev-login enabled and use only the public test secret
`read-api-parity-secret-at-least-32-bytes`.

```powershell
$env:READ_API_TEST_DATABASE_URL = 'postgresql://postgres:TEST_PASSWORD@localhost:55442/stiu_read_api_test'
$env:JAVA_BASE_URL = 'http://127.0.0.1:18081'
npm.cmd run test:integration
```

CI provisions its own PostgreSQL 17 database, builds the Java baseline with JDK 17,
starts it on port 18081 and runs the differential test. Neither API is deployed.
The test compares statuses and full JSON, ignoring only dynamic error timestamps
and role array ordering. It checks actual Java-issued tokens, Bearer/cookie
precedence, role gates, archived visibility, pagination, sorting, malformed query
errors, bad/expired/unknown-user tokens, deleted users and forged role claims.
It also verifies PostgreSQL rejects writes inside application read transactions.

## Remaining scope

See [current migration status](MIGRATION_STATUS.md) for the next Identity read batch.
See [Academic Content read migration](ACADEMIC_READ_MIGRATION.md) for tags, stimuli,
question banks, questions, versions and the public metadata catalog.

Local verification (2026-10-19): typecheck and foundation tests passed; differential
89 HTTP contract comparisons passed against the actual Java JAR with isolated PostgreSQL 17 on port 55442.
Java source and normal local database were not modified.
[CI run 39185343032](https://github.com/leedoekahn401/stiu_base/actions/runs/39185343032)
passed both foundation and Java parity jobs on source commit 2267557.
See [migration PR #17](https://github.com/leedoekahn401/stiu_base/pull/17) for checks
on the latest commit. No deployment or traffic switch has occurred.

No frontend routing switch, OAuth migration, write APIs, Assessment or Analytics
migration is included. Further query edge cases should be added to the differential
matrix before routing real traffic. The Java baseline may accept signed JWT
algorithms other than HS256 with sufficiently strong keys; TypeScript intentionally
accepts only the algorithm emitted by Java. Result authorization is based on DB roles.
