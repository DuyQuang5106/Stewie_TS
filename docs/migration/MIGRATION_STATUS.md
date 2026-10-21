> Historical source documentation imported from stiu_base/api-ts. See the root README for commands in this repository.

# API migration status

Updated 2026-10-19. This tracks source/test progress, not deployed traffic.

| Scope | State |
| --- | --- |
| Java analytics reconciliation | Merged via PR #15 |
| TypeScript foundation, Docker and CI | Merged via PR #16 |
| Java JWT verification, GET users/me, topics and skills | Merged via PR #17; CI passed |
| GET users/all, users/by-email, users/{id} | Merged via PR #18; 149 differential HTTP checks and CI passed |
| Tags/groups, stimuli, question banks, author/public questions and versions reads | Implemented on feat/typescript-academic-reads; expanded suite of 510 HTTP checks passes locally; see PR checks for CI |
| Quality-review reads, import/export and Academic Content writes | Not migrated |
| Vocabulary | Not migrated |
| Assessment | Not migrated |
| Analytics | Not migrated |
| OAuth2, token issuance, refresh, logout | Still Java |
| Staging deployment and traffic cutover | Not performed |

Identity reads use the existing READ_API_ENABLED switch (false by default),
the shared Java JWT secret and read-only PostgreSQL transactions. List/id/email
lookups are ADMIN-only. users/me remains available to any authenticated user.
Full user responses include createdAt, updatedAt and lastAccessAt, matching Java;
they do not expose phone numbers or authentication data. Soft-deleted users are
excluded. Pagination uses the same content/page shape as classification reads.

The differential suite compares Java and TypeScript HTTP status and JSON for
ADMIN, TEACHER and STUDENT; validates missing/invalid ids/emails, not-found errors,
pagination, allowed sort fields and deleted-user visibility. Dynamic error
timestamps and role array ordering are normalized. Test fixtures are written only
to disposable stiu_read_api_test; application transactions remain read-only.

Review/deploy sequence: review the current PR and merge when accepted; continue
with quality-review/import/export and Academic Content writes in separate batches. Before changing routing, run
staging smoke tests and approve a route-specific cutover with rollback to Java.
