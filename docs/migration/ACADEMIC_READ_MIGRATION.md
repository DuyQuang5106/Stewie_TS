> Historical source documentation imported from stiu_base/api-ts. See the root README for commands in this repository.

# Academic Content core read migration

Implemented behind READ_API_ENABLED (false by default):

| Routes | Access |
| --- | --- |
| GET /api/academic/tag-groups, /tag-groups/{id} | Any authenticated user |
| GET /api/academic/tags/{id} | Any authenticated user |
| GET /api/academic/tag-groups/{groupId}/tags, /tags/by-group/{groupId} | Any authenticated user |
| GET /api/academic/stimuli, /stimuli/{id} | TEACHER owns created_by; ADMIN unrestricted |
| GET /api/academic/question-banks, /question-banks/{id} | TEACHER owns TEACHER bank; ADMIN unrestricted |
| GET /api/academic/questions, /questions/{id}, /questions/{id}/versions | TEACHER owns question; ADMIN unrestricted |
| GET /api/academic/public/questions | Authenticated; published SYSTEM-bank metadata only |

Stimulus and bank lists preserve archived records; archived is different from
soft-deleted. Soft-deleted question banks/questions are excluded as in Java.
Question versions are returned newest version number first, including snapshots
only for authorized authors. Public catalog responses exclude prompt/content,
answers, explanations, owner/creator information and timestamps.

Question filters: keyword, questionBankId, topicId, skillId, tagId, difficulty,
status, createdFrom/To, updatedFrom/To. Public catalog always requires PUBLISHED
in SYSTEM banks regardless of a valid status query. Keyword search examines title
only in the public catalog, title/prompt for authors; %, _ and backslash are
escaped as literal characters. Date bounds are inclusive local timestamps.
Sort fields for questions match Java: createdAt, updatedAt, difficulty, status,
questionType. Pagination retains the content/page envelope and Spring limits.

UUID, enum, date binding errors, fieldErrors, role restrictions and ownership
errors are compared against the actual Java baseline. All queries are parameterized
and executed in read-only transactions. Dynamic SQL identifiers come only from
internal route mappings and sort allowlists. No schema or write APIs are added.

## Verification

The extended differential suite passed 510 HTTP comparisons locally on
2026-10-19, using Java-issued tokens and a disposable stiu_read_api_test database.
It covers ADMIN, owner TEACHER, other TEACHER and STUDENT; four question types,
two published versions, archived stimuli/banks, soft deletion, literal wildcard
search, public information boundaries, invalid/multiple filters and time bounds.
The same suite runs in the existing GitHub Actions read-api-parity job.

Set-valued ID arrays and role arrays are compared without ordering. Tag groups
and nested tags have no ordering annotation in Java and are normalized by ID for
comparison; their iteration order is not a migration guarantee. Sorted pagination
and version ordering are compared in their returned order.

Run instructions are in READ_API_MIGRATION.md. Tests write fixtures only through
Java and the isolated test DB. Normal local DB, Java source and live routing are
unchanged. CI results must be reviewed on the latest migration PR before merge.

## Remaining Academic Content scope

Quality-review reads, import/export APIs and all create/update/publish/archive/
restore/duplicate/ownership-transfer/delete operations remain in Java. This batch
does not deploy, enable frontend traffic or change migration ownership.
