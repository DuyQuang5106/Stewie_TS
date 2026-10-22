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

## Follow-up: Academic review reads (2026-10-21)

The original import result above remains historical (510 comparisons). The review read batch extends the suite to 594 comparisons, passed against real Java locally. See ACADEMIC_CONTENT_CONTRACT.md for scope and baseline edge cases. This does not change the remote CI limitation above.

## Follow-up: catalog writes (2026-10-21)

Implemented 14 ADMIN-only Topics/Skills/Tag groups/Tags write routes behind ACADEMIC_WRITE_API_ENABLED=false by default. Existing read-only transaction policy remains intact; writes use a separate opt-in transaction helper.

Final observed checks: build/typecheck PASS; oxlint PASS (no warnings); 6 unit/foundation tests PASS; starter e2e PASS; both PostgreSQL integration suites PASS on fresh isolated databases. Contract suite asserts exactly 594 read and 121 write comparisons (715 total), including persisted state, plus independent rollback and concurrency assertions. Malformed request handling and known baseline validation ambiguity are described in ACADEMIC_CONTENT_CONTRACT.md.

PostgreSQL 17 container used only temporary stiu_read_api_test and stiu_ci databases on port 55443; Java baseline used port 18081. No shared DB/schema, real secrets, existing Java source or production traffic changed. Temporary processes/container removed after verification. Docker image build and remote CI were not rerun. Changes remain local and uncommitted.

## Follow-up: Stimuli / Question Banks writes (2026-10-22)

Implemented 9 additional opt-in resource write routes, using the existing ACADEMIC_WRITE_API_ENABLED flag (default false). Teacher ownership, admin scope/owner validation, lifecycle rules, 100000-character stimulus content limit, soft deletion, case-insensitive name conflicts and optimistic bank version checks are preserved. Timestamp DTO/flush timing follows the Java baseline and is explicitly asserted.

Final PostgreSQL integration run: both suites PASS, direct Bun/Vitest process exit 0. Exactly 594 read + 121 catalog write + 137 resource write comparisons = 852 total; additional concurrency tests force same-version updates against BOTH Java and TypeScript and verify one success/one 409 with a single version increment. Concurrent bank name creation also yields one row and one conflict. Parser/lifecycle-body behavior is covered. The resource batch passed from a clean DB with 130 cases; seven lifecycle malformed-body cases were then added and passed in the final 137-case run on the same disposable DB.

PostgreSQL 17 disposable container at port 55443 used stiu_read_api_test and stiu_ci; Java baseline at 18081. No normal local/staging/production DB, schema, real credentials or Java source changed. Docker image build and remote GitHub CI were not rerun. Changes remain local/uncommitted; temporary test processes/container are removed after verification. See ACADEMIC_CONTENT_CONTRACT.md for exact behavior and remaining endpoints.

Final resource batch command exits: typecheck=0, lint=0, test=0 (6 unit/foundation), test:e2e=0 (1 starter e2e), test:integration=0 (both files). The API/DB comparison count is asserted exactly as 594 + 121 + 137. No dependencies or lockfile were changed.

## Follow-up: Question aggregate writes (2026-10-22)

Implemented 8 opt-in routes: create/update, publish/revise, archive/restore, duplicate and admin ownership transfer. New modules: src/academic-write/question.binding.ts, question.service.ts and question.controller.ts. Existing ACADEMIC_WRITE_API_ENABLED remains false by default; no new dependency or schema migration was introduced.

Final observed checks: build/typecheck exit 0; oxlint exit 0 (no warnings); unit/foundation exit 0 (6 tests); starter e2e exit 0 (1 test); both PostgreSQL integration files PASS, direct Bun/Vitest exit 0. Final integration was run from a freshly initialized isolated stiu_read_api_test database with a separate stiu_ci pool-test DB on PostgreSQL 17 in a disposable Docker container at port 55443. Java baseline ran at port 18081.

Exact asserted differential count: 594 read + 121 catalog write + 137 resource write + 130 Question operations = 982. The Question suite checks HTTP responses, nested validation paths and every row of seven aggregate tables (including version and join rows), immutable version snapshots and raw legacy JSON copying/normalization. Generated UUIDs, timestamp values and unordered ID sets are normalized, with timestamp persistence checked separately. Failure cases preserve full aggregate/timestamp state.

Additional assertions inject an audit failure after the parent question update and verify complete rollback plus connection reuse, force same-version update races against BOTH Java and TypeScript (one 200 and one 409, one version increment), and submit concurrent publish requests (one winner, no orphan/extra versions; sequence [1,2,3]). Java's collection-replacement version increment behavior is preserved, including repeated identical updates with empty sets.

No existing local/staging/production database, Java source, schema ownership, real environment credentials or traffic routing changed. Temporary baseline/container are removed after validation. Docker image build and remote GitHub CI were not rerun. All changes remain local/uncommitted. Remaining Academic Content scope: review decision POST and four import/export routes; see ACADEMIC_CONTENT_CONTRACT.md for the detailed contract.


## Follow-up: Review decisions and import/export (2026-10-22)

Implemented the last five Academic Content routes: review POST, import validate/commit/detail and export. All 53 inventoried Academic Content routes are now ported. Other backend domains and deployment remain outside this batch. Reused QuestionWriteService inside the batch transaction; validation candidates make no question writes. The global JSON parser limit is 8 MB so the import service can enforce Java's normalized DTO 1,000,000-byte limit.

Final actual check results: typecheck=0, lint=0, unit/foundation=0 (6 tests), starter e2e=0 (1 test), PostgreSQL integration=0 (both files). The final integration run used a freshly initialized stiu_read_api_test schema and separate stiu_ci pool-test DB in temporary PostgreSQL 17 container stw-workflow-tests on port 55443, with Java baseline on 18081. Exactly 594 read + 121 catalog + 137 resource + 130 question + 73 workflow comparisons are asserted: 1055 total. Existing independent rollback/concurrency checks also passed. Combined command output was captured with spawnSync and its actual exit status checked.

The 73 workflow comparisons cover role gates, missing/invalid DTOs, nested validation, Jackson number/string coercion, Unicode review comment normalization, persisted review/version status, import per-item errors, duplicate keys, sequential commit replay, creator-only commit including ADMIN, export filters, ASCII/non-ASCII UTF-8 payload limits and rollback when a later candidate fails after the first question insert. HTTP and every row in nine aggregate/review/import tables are compared against the same Java before-state; generated IDs/timestamps are normalized and persisted timestamps checked separately.

Concurrent commit of the same batch and the 1000/1001 export boundary were not exercised by this workflow suite. Java's lack of batch version/row locking is retained and documented in ACADEMIC_CONTENT_CONTRACT.md; sequential replay passing is not a concurrency guarantee.

No schema migration, dependency, lockfile, existing database, real credential, Java source or traffic routing was changed. No Docker API image build, remote GitHub Actions run, commit or push was performed. Test-only Java process and disposable container were stopped/removed after validation. Changes from these continuation batches remain local/uncommitted.


## Pre-PR review and missing-boundary verification (2026-10-22)

Supersedes the unverified-boundary notes in the previous workflow entry. Added test/workflow-boundaries.cjs and integrated it into the mandatory parity suite. Export with exactly 1000 questions returns 200 and 1000 transfer items; 1001 returns 413, on both Java and TypeScript. Forced concurrent commit tests lock the batch row until both requests have read VALIDATED and reached UPDATE. Each backend returns two 200s and creates four questions for a two-item document; the stored batch lists only two winning IDs. This baseline defect is retained and prominently documented, not silently fixed as part of migration.

Final review checks: typecheck=0, lint=0, 6 unit/foundation tests PASS, 1 starter e2e PASS, both PostgreSQL integration suites PASS (32.95s). Exactly 594 + 121 + 137 + 130 + 75 = 1057 HTTP/DB differential comparisons are asserted, plus separate rollback/concurrency assertions. Tests used a fresh disposable PostgreSQL 17 stiu_read_api_test database and separate stiu_ci DB, with Java baseline at port 18081. No real application DB was used.

Reviewed flag enforcement, authorization, parameterized SQL, transactions, lifecycle rules and config/secret handling; no credential patterns found in candidate files. New source/tests were formatted for review. Dependencies and lockfile did not change.

The existing draft PR is #1 on feat/import-migrated-api. The last remote run before this review had verify PASS and read-api-parity FAIL at the explicit JAVA_BASELINE_READ_TOKEN requirement. Local parity passing does not replace that missing GitHub secret. A new remote run must be checked after push. No deployment or merge is part of this task.
