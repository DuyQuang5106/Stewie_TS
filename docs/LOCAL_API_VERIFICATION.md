# Local API verification

Observed at 2026-10-24T06:56:08.380Z, against http://127.0.0.1:3001.

- HTTP checks: 246/246 passed, 0 failed.
- Source inventory: 115 method/path routes.
- Successful 2xx responses: 113 distinct routes, with static routes distinguished from parameter routes.
- Every protected route was also called without a JWT and returned the expected 401.
- Both Google OAuth routes returned the expected 404 because GOOGLE_OAUTH_ENABLED is false. Real Google login was not tested here.
- Dictionary lookup HTTP status: 200.

## Executed flows

Identity reads and ADMIN/STUDENT permissions; Topics/Skills lifecycle; Tag groups/Tags CRUD; Stimulus lifecycle; Question bank lifecycle; Question create/update/publish/revise/archive/restore/duplicate/transfer; quality review/history; import validate/commit/detail/export; Vocabulary playlist/word/due/streak/review/undo/lookup; Assessment authoring/assignment/catalog, SOFT and STRICT taking/resume/clock/answers/flag/question time, module/section transitions, submit/result/review, manual release and close; all seven Analytics reads; Auth login/refresh/replay invalidation/logout.

A correct answer in the SOFT fixture was asserted to produce totalGrade=1 and maxGrade=1 after manual release. Expected authorization and mode errors (401/403/404/409) are counted only when their status matches the case. Authenticated role denial uses a valid body so validation does not mask role checks.

## Data and limitations

The runner creates uniquely tagged accounts/resources using local-smoke-TIMESTAMP. Latest fixture prefix: local-smoke-1792824966435. Fixtures are retained for inspection; temporary tags/groups are deleted through the API. Earlier trial runs also created fixtures with the same prefix pattern. Existing user data was not reset or directly modified through SQL.

This is live HTTP smoke coverage of each enabled route, not exhaustive input, concurrency, timer or failure-injection coverage. The separate migration parity suite has 1,682 cases and previously passed in CI; it was not rerun as part of this local smoke run. No DB outage or scheduler fault was injected into the running user instance. Google browser login and deployment are still separate acceptance steps.

## Repeat

Keep the local API running with dev login enabled, then from the TypeScript repo:

```powershell
node test/local-api-smoke.cjs
```

Each run creates new local fixtures. Detailed status/timing/coverage results are written to .temp/local-api-report.json (Git ignored); tokens are not stored in the report. The runner accepts only loopback URLs.
