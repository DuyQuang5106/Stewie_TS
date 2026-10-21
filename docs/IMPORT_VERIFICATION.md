# Import verification ? 2026-10-21

Imported from stiu_base/api-ts at daeca46883a45de2d745be3f69fdd2713033808d.
Destination baseline was a clean feat/import-migrated-api branch at 97d9878.
Original root controller/service and their unit/e2e tests are retained.
The Java repository and its api-ts tree were not modified or removed.

## Observed local results

- Bun 1.4.2 frozen install: PASS.
- NestJS 12 / TypeScript 6 / ESM build and typecheck: PASS.
- Oxlint: PASS.
- Vitest: 6 unit/foundation tests PASS.
- Starter e2e: 1 test PASS (root response preserved).
- Integration: both PostgreSQL pool test and Java contract parity test PASS.
- Contract suite asserts exactly 510 HTTP comparisons executed successfully.
- Real PostgreSQL 17 used a disposable container at port 55443, not the normal DB.
- Docker multi-stage build using frozen bun.lock: PASS.
- Docker smoke: non-root UID, health, DB stop/restart, SIGTERM and JSON logs PASS.

Source tests used CommonJS/node:test; imported tests use ESM/Vitest and compiled
ESM application modules to retain decorator metadata. CJS helper scripts remain
explicit .cjs utilities. Test setup overrides local application settings so Bun's
automatically loaded .env cannot redirect fixtures to a real database.

## CI limitation

The Java baseline repo is private, whereas this destination repo is public.
JAVA_BASELINE_READ_TOKEN is not configured in the destination Actions secrets.
The parity job explicitly reports this missing requirement instead of silently
claiming success. Grant a dedicated read credential for the Java repo and rerun
CI. Local parity success is not a claim that the remote parity job has passed.
Do not upload private Java source or reuse a personal Git credential in this repo.

No deployment or traffic change was performed. Cloudflare Java Preview config,
real .env values and production credentials were not copied.
