# Current migration status — 2026-10-24

This describes implementation and verification, not deployed traffic.

| Scope | Current state |
| --- | --- |
| Foundation and Identity reads | Merged in Stewie_TS |
| Academic Content | All 53 inventoried routes merged, PR #1 |
| Vocabulary | All 10 inventoried routes merged, PR #2 |
| Assessment | All 33 inventoried routes and opt-in expiry worker merged, PR #2 |
| Student Analytics | 7 GET routes merged, PR #3 |
| Full Auth | Implemented on feat/auth-migration; awaiting PR review and staging browser acceptance |
| Staging and route cutover | Not deployed or switched by this work |

The required differential suite has 1,682 cases. Actual observed verification
results are recorded in [IMPORT_VERIFICATION.md](../IMPORT_VERIFICATION.md).
Contracts: [Academic](../ACADEMIC_CONTENT_CONTRACT.md),
[Vocabulary](../VOCABULARY_CONTRACT.md), [Assessment](../ASSESSMENT_CONTRACT.md),
[Analytics](../ANALYTICS_CONTRACT.md), [Auth](../AUTH_CONTRACT.md).

All domain flags remain false by default. Java owns schema/migrations. Before
switching traffic, validate staging and decide which backend owns background
expiry; no simultaneous Java/TypeScript expiry workers on the same DB.
