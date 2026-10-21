> Historical source documentation imported from stiu_base/api-ts. See the root README for commands in this repository.

# Foundation verification — 2026-10-19

This records observed results, not a deployment claim.

| Check | Result / evidence |
| --- | --- |
| Clean dependency install | PASS: `npm ci --offline --no-audit --no-fund` replaced node_modules using lockfile |
| Versions | Node 24.14.0 locally and in Docker/CI configuration; NestJS 11; TypeScript strict |
| Typecheck/build | PASS: `npm run typecheck`; `npm run build` |
| Foundation suite | PASS: 5 tests (`npm test`): configuration, CORS/preflight/health, DTO validation, startup JSON error, stalled DB handshake timeout |
| Local PostgreSQL | PASS: HTTP on 127.0.0.1:3001; live=200 and ready=200 with existing localhost:5432/stewiesat_test; only SELECT 1 |
| Development command | PASS: `npm run dev` served live=200 and ready=200 on localhost:3001 |
| Isolated PostgreSQL integration | PASS: PostgreSQL 18 at port 55439, stiu_foundation_test; readiness, incorrect password rejection, network outage/recovery, zero remaining app sessions after app.close |
| Docker build | PASS: `stiu-api-ts:foundation`, also tagged `stiu-api-ts:ci`; Node 24.14.0 multi-stage image |
| Docker runtime | PASS: `node test/docker-smoke.cjs`; isolated PostgreSQL 17; UID=1000, health, DB stop/restart, SIGTERM exit, JSON log parsing and credential exclusion |
| Secrets | `.env`, node_modules and dist ignored by Git; Docker context excludes .env; no real credentials in tracked source |
| GitHub Actions | PASS: [GitHub Actions run 39183843419](https://github.com/leedoekahn401/stiu_base/actions/runs/39183843419), source commit b7858d5; includes PostgreSQL integration and Docker runtime smoke tests |
| Staging | DOCUMENTED ONLY: see STAGING.md; no target selected and no deployment performed |

The disposable local PostgreSQL cluster was stopped after testing. Docker smoke
removes its test containers, volumes and network in finally cleanup.
Existing Java schema, data, source and Cloudflare routes were not modified by this work.
Local `.env` was created from existing Java local connection settings without
printing credentials. No database roles were created or permissions changed.

CI passed on source commit b7858d5 (link above). This evidence-only documentation
update will also trigger CI; check the latest run on the PR before merge.
The existing Java
merge was resolved in commit 803501a, preserving both analytics and assessment
catalog queries. Java package build and all 198 Java tests passed against isolated PostgreSQL 17 on
port 55441; the Java-owned local database was not used for these tests.
Existing feature commits were preserved rather than recreated. Generated Python
bytecode removal and seed identity sanitization were committed separately.
The foundation commit contains only api-ts/ and its GitHub Actions workflow.

References: [pg pool](https://node-postgres.com/apis/pool),
[Nest lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events).

Review links: [Java reconciliation PR #15](https://github.com/leedoekahn401/stiu_base/pull/15)
and [TypeScript foundation PR #16](https://github.com/leedoekahn401/stiu_base/pull/16).
Both are drafts; neither has been merged. PR #16 is based on the reconciliation
branch to keep its diff limited to TypeScript. Merge/review #15 first, then retarget
#16 to main when appropriate. Staging remains undeployed.
