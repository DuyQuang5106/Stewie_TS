# Stewie TypeScript API

NestJS 12, TypeScript 6, ESM, Bun 1.4.2 for dependency management/build tooling,
Node.js 24.14.0 for deployed execution. Existing starter controller/service and
Vitest tests are retained. Migrated services do not change PostgreSQL schema.

## Local setup (PowerShell)

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
# Edit .env for your local PostgreSQL; do not commit secrets.
bun run start:dev
```

Bun loads the local .env for commands it launches. Production startup is
`bun run start:prod`, which runs compiled ESM with Node and an optional .env.
The service listens on port 3001 by default. Health routes:
`/health/live` (process) and `/health/ready` (PostgreSQL SELECT 1).

READ_API_ENABLED defaults to false. To enable migrated reads, configure
READ_API_ENABLED=true and APP_JWTSECRET equal to Java's raw UTF-8 JWT secret.
OAuth2, refresh/logout and migrations remain in Java. Migrated writes for Topics/Skills/Tag groups/Tags and Stimuli/Question Banks/Questions require ACADEMIC_WRITE_API_ENABLED=true in addition to reads; the write flag defaults to false. Other business writes remain in Java.
The frontend's CORS origin must be listed in CORS_ALLOWED_ORIGINS.

## Verification

```powershell
bun run typecheck
bun run lint
bun run test
bun run test:e2e
```

Vitest executes the original unit test and the ported foundation tests. HTTP tests
import compiled ESM from dist so Nest decorator metadata matches deployed code.
The typecheck command builds first because e2e types also refer to compiled declarations.
Integration tests run separately:

```powershell
$env:READ_API_TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:55442/stiu_read_api_test'
$env:JAVA_BASE_URL = 'http://127.0.0.1:18081'
bun run test:integration
```

The Java baseline must run against the same disposable DB with dev-login enabled
and the public test secret `read-api-parity-secret-at-least-32-bytes`. Its fixtures
exercise 982 HTTP contract comparisons (594 read, 121 catalog writes and 137 Stimuli/Banks writes, 130 question operations), with persisted-state checks including role/ownership and public data
boundaries. Tests reject other read API DB names. Never use a normal local,
staging or production database for integration fixtures.

For isolated pool failure/recovery tests, set TEST_DATABASE_URL to a disposable
`stiu_ci` or `stiu_foundation_test` database and run test:integration. The suites
are independent; absent environment settings skip the corresponding integration
suite. The default test command covers unavailable DB behavior without PostgreSQL.

## Docker

```powershell
docker build -t stiu-api-ts:ci .
node test/docker-smoke.cjs
```

The smoke test creates and removes its own PostgreSQL/container/network. Docker
build uses Bun's frozen lockfile, a Node runtime and non-root user. No .env is copied.
On Windows, a container reaches a host PostgreSQL through host.docker.internal,
not localhost. Supply container configuration separately from local .env.

## CI and Java baseline

The verify job runs install, typecheck, lint, unit/foundation/e2e tests, PostgreSQL
pool tests and Docker smoke. The parity job checks out a pinned Java commit from
`leedoekahn401/stiu_base` (see `.github/workflows/ci.yml`).

That Java repository is private. Add the Actions secret **JAVA_BASELINE_READ_TOKEN**
with read-only access to that repository before expecting the parity job to pass.
Use a dedicated fine-grained token or suitable GitHub App token, not a credential
committed into source. Checkout does not persist that credential. The normal
GITHUB_TOKEN in this repo does not grant access to another private repository.
No Java source is copied into this public repository or uploaded as an artifact.

## Migration provenance

Source: `stiu_base/api-ts` at commit daeca46883a45de2d745be3f69fdd2713033808d.
Java baseline: 4b52a4c260a57b288d58048a96565e93ba554b4f.
Historical source docs are in docs/migration; their npm paths and old CI results
are source history, not instructions/results for this repository.

Migrated: JWT-compatible reads for Identity, classifications, tags, stimuli,
question banks, author questions/versions and public question metadata. Nothing
is automatically deployed and Java traffic routing remains unchanged.
Cloudflare's existing Java Worker/Preview configuration is intentionally excluded.
The old api-ts tree is retained until this import is reviewed and accepted.

## Academic Content continuation

Current contract and endpoint inventory: [docs/ACADEMIC_CONTENT_CONTRACT.md](docs/ACADEMIC_CONTENT_CONTRACT.md). Review queue/history reads, 14 catalog write routes and 9 Stimuli/Question Banks and 8 Question write routes are implemented. Review decisions and all four import/export routes are implemented. The parity suite asserts 1057 comparisons plus rollback/concurrency checks. See the contract for the retained concurrent-import limitation.

Academic Content writes are opt-in. Use a dedicated development database and credentials that have the required write rights before enabling the flag. The application does not grant PostgreSQL privileges or migrate schema. See the contract for the tested Java error behavior.


## Vocabulary and Assessment continuation

Implemented 10 Vocabulary and 33 Assessment routes on top of the merged Academic Content foundation. Contracts and review notes: [Vocabulary](docs/VOCABULARY_CONTRACT.md), [Assessment](docs/ASSESSMENT_CONTRACT.md), [migration review](docs/DOMAIN_MIGRATION_REVIEW.md).

All new routes are disabled by default. A dedicated development database must already have the Java-managed schema. Enable READ_API_ENABLED with the compatible JWT secret, then VOCABULARY_API_ENABLED and/or ASSESSMENT_API_ENABLED as needed. Each domain checks its own write permission flag independently. Do not enable ASSESSMENT_SCHEDULER_ENABLED while Java still runs expiry jobs on the same database.

The CI parity job uses a local dictionary stub for deterministic lookup tests. The full mandatory parity suite now registers 1462 comparisons: the previous 1057 plus 135 Vocabulary, 69 Assessment authoring, 139 taking/result and 62 catalog/history/stats. Independent assertions cover optimistic review races, concurrent submit idempotency, late rollback, exact numeric grading, expiry sweeps and stale-deadline/extension locking. These counts describe bounded test coverage, not a production traffic switch or a proof for every input/clock boundary.
