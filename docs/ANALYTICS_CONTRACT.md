# Student Analytics API contract

Java baseline: `leedoekahn401/stiu_base@4b52a4c260a57b288d58048a96565e93ba554b4f`.
Source: `analytics/controller/StudentAnalyticsController`, `StudentAnalyticsService`,
`AnalyticsAttemptSelector`, `PerformanceAggregator`, `AnalyticsTimeHelper`.

All routes are GET under `/api/analytics/me`, require an existing Java JWT and a
live database STUDENT role. ADMIN/TEACHER without STUDENT receive 403. Only the
current student's attempts are selected. Enable `READ_API_ENABLED=true` and
`ANALYTICS_API_ENABLED=true`; the latter defaults to false and does not enable
Academic, Vocabulary or Assessment writes. Every operation uses a read-only
repeatable-read transaction. Schema and migrations remain Java-owned.

| Route | Parameters and behavior |
| --- | --- |
| `assessment-history` | Optional type/status/from/to, page=0, size=20 (1..100). Filters by startedAt, descending. Content/page response; empty page retains Java's totalElements=0 behavior. |
| `summary` | Required type, optional from/to/allTime=false. Counts started/completed/pending/final released attempts, equal-weight mean percentage. |
| `performance` | Required groupBy TOPIC/SKILL/DIFFICULTY (case-insensitive), optional type/from/to/allTime=false. Snapshot classifications and weighted points, fully correct rate, unclassified counts. |
| `score-trend` | Exactly one type or assessmentId. Optional from/to/allTime=false. Eligible results in submittedAt ascending order. |
| `time-summary` | Optional type/from/to/allTime=false. Includes submitted attempts even when pending or unreleased; positive result.totalTime only. Without type, returns all three type breakdowns. |
| `recap` | Optional timeZone=Asia/Ho_Chi_Minh, from/to. Default local calendar period today minus 29 days through tomorrow. Previous period has equal instant duration. |
| `next-practice` | Optional from/to/allTime=true. Weakest eligible skill with at least five graded attempt-question rows and a currently published question. Recommendation is informational: canStartDrill=false. |

Explicit ranges are inclusive from / exclusive to, must be paired, and from must
precede to. Rolling defaults cover the last 30 times 24 hours. allTime=true
ignores range bounds after parameter binding; malformed values still fail.
History does not have an allTime parameter. Recap validates the Java zone ID;
invalid zones return 400 instead of silently falling back.

A result contributes to score aggregates only when SUBMITTED, no question is
UNGRADED/PENDING_REVIEW, release policy permits viewing, a result exists and
maxGrade is positive. History also distinguishes gradingState/releaseState/
scoreStatus; missing/hidden scores are null. IMMEDIATE, MANUAL and AFTER_DEADLINE
policies match Java. This is stricter than the legacy Assessment my-stats policy.

Mean scores weight each attempt equally: round each percentage to four places,
then average and round to two, HALF_UP. Group earned/possible points use exact
base-10 amounts; percentages have two places and correctness rates four.
Partially correct counts separately from fully correct. Insufficient data means
fewer than five graded attempt-question rows, not five distinct content IDs.
Repeated content in multiple attempts remains multiple graded observations.

Classification is read from the pinned question-version snapshot, not live
classification. Duplicate IDs are collapsed. Missing labels use
`Retired/Unknown (UUID)`; empty classification uses UNCLASSIFIED. Recommendation
availability uses Java's live published-question query, including its existing
scope/bank filtering behavior. It does not start a drill or modify learning data.

`test/analytics-parity.cjs` compares Java and TypeScript HTTP status/JSON on the
same disposable stiu_read_api_test database and is invoked by the existing CI
parity job. It covers roles, invalid input, empty data, all seven responses,
pending/missing/zero-max results, hidden/released results, time data, grouping,
recommendation reasons and a before/after data snapshot proving read-only use.
Dynamic envelope timestamps and default rolling clock boundaries are normalized;
persisted IDs, counts, scores, messages and array order are compared.

No production routing, Cloudflare deployment, scheduler ownership or OAuth/token
issuance is changed by this batch. Staging and full Auth migration remain separate.
