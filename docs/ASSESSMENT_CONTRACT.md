# Assessment migration contract

Java reference: `4b52a4c260a57b288d58048a96565e93ba554b4f`. Java retains schema ownership.

33 inventoried HTTP routes are implemented in TypeScript. This is an implementation inventory; verification evidence and limits follow below.

| Method | Path | Java controller |
|---|---|---|
| POST | `/api/assessments` | AssessmentAuthoringController |
| GET | `/api/assessments` | AssessmentAuthoringController |
| GET | `/api/assessments/{id}` | AssessmentAuthoringController |
| PUT | `/api/assessments/{id}` | AssessmentAuthoringController |
| POST | `/api/assessments/{id}/publish` | AssessmentAuthoringController |
| POST | `/api/assessments/{id}/close` | AssessmentAuthoringController |
| POST | `/api/assessments/{id}/clone` | AssessmentAuthoringController |
| POST | `/api/assessments/{id}/sections` | AssessmentAuthoringController |
| POST | `/api/assessments/sections/{sectionId}/modules` | AssessmentAuthoringController |
| POST | `/api/assessments/modules/{moduleId}/questions` | AssessmentAuthoringController |
| POST | `/api/assessments/{id}/assign` | AssessmentAuthoringController |
| PUT | `/api/assessments/{id}/access-mode` | AssessmentAuthoringController |
| POST | `/api/assessments/{id}/release-results` | AssessmentAuthoringController |
| GET | `/api/assessments/{id}/submissions` | AssessmentAuthoringController |
| GET | `/api/assessments/catalog` | AssessmentCatalogController |
| GET | `/api/assessments/catalog/facets` | AssessmentCatalogController |
| GET | `/api/assessments/catalog/{assessmentId}` | AssessmentCatalogController |
| GET | `/api/assessments/my-attempts` | AssessmentCatalogController |
| GET | `/api/assessments/my-stats` | AssessmentCatalogController |
| GET | `/api/assessments/attempts/{attemptId}/result` | AssessmentResultController |
| GET | `/api/assessments/attempts/{attemptId}/review` | AssessmentResultController |
| GET | `/api/assessments/my-assignments` | AssessmentTakingController |
| POST | `/api/assessments/{assessmentId}/start` | AssessmentTakingController |
| GET | `/api/assessments/attempts/{attemptId}/resume` | AssessmentTakingController |
| GET | `/api/assessments/attempts/{attemptId}/current-section` | AssessmentTakingController |
| GET | `/api/assessments/attempts/{attemptId}/clock` | AssessmentTakingController |
| PUT | `/api/assessments/attempts/{attemptId}/answers` | AssessmentTakingController |
| PUT | `/api/assessments/attempts/{attemptId}/flag` | AssessmentTakingController |
| POST | `/api/assessments/attempts/{attemptId}/question-time` | AssessmentTakingController |
| POST | `/api/assessments/attempts/{attemptId}/modules/{moduleId}/complete` | AssessmentTakingController |
| POST | `/api/assessments/attempts/{attemptId}/sections/{sectionId}/complete` | AssessmentTakingController |
| POST | `/api/assessments/attempts/{attemptId}/sections/{sectionId}/start` | AssessmentTakingController |
| POST | `/api/assessments/attempts/{attemptId}/submit` | AssessmentTakingController |

## Enablement and architecture

READ_API_ENABLED and ASSESSMENT_API_ENABLED enable these routes; both default false. Assessment uses a separately gated write transaction, not Academic Content's opt-in. Java owns the existing schema/migrations. No schema, production data, traffic switch or deployment is changed by this migration.

ASSESSMENT_SCHEDULER_ENABLED is a separate flag, false by default, and requires the API flag. Enable it only after Java no longer runs the expiry scheduler against the same database. The worker runs every 30 seconds, prevents overlapping local sweeps and clears/awaits its work during shutdown. HTTP reads do not implicitly expire an attempt, matching Java.

## Authoring contract

Teacher or ADMIN is required. Teachers manage only their own assessments; ADMIN can manage all. Binding/Bean Validation precedes method role checks. Create/update require title <=255, type TEST/DRILL/HOMEWORK and releasePolicy IMMEDIATE/MANUAL/AFTER_DEADLINE. Optional description <=1023, mode/examType <=127, maxAttempts >=1. Access mode is OPEN or ASSIGNED_ONLY (default); timing is STRICT or SOFT (default). Enum numeric binding follows Java declaration order, which differs between these enums. Config remains SQL NULL when omitted.

Schedules require availableFrom <= availableUntil. AFTER_DEADLINE needs resultsReleaseAt or availableUntil; an explicit release time cannot precede availability bounds. Only TEST supports STRICT. Once published/closed, only title, description, access mode and a later closing time may change. A null deadline means no deadline, so null -> finite is shortening and forbidden on a live assessment. Identical PUT leaves the persisted update timestamp unchanged.

Sections/modules/questions may be added only to DRAFT. Section/module orderIndex is >=1 and unique in its parent. Question positions are unique within a module; points default 1 and must be >=0.01. Questions pin an immutable question_version. It must belong to the specified question; SYSTEM bank versions must be APPROVED. Teachers cannot use another teacher's bank. Publishing requires sections, modules in each section, at least one question, no mixed module-timing within a section, and only supported auto-gradable types (MC/FILL_IN). SHORT_ANSWER/ESSAY causes 422. Published duration is frozen from section clocks or summed module durations.

Clone copies structure and pinned versions into a new DRAFT owned by the actor, with no assignments, attempts, released timestamp or published duration copied. Assign updates or creates the student assignment and can extend a live due date but cannot shorten it. AFTER_DEADLINE assignments cannot extend beyond effective result release. The baseline does not validate that an assignee has the STUDENT role. Release-results applies only to MANUAL policy. Close applies only to PUBLISHED.

Teacher extension locks active attempts and only extends finite deadlines; a null current deadline remains unlimited. The active STRICT section/module is re-capped by its original duration and the new hard deadline. The expiry worker re-reads the deadline after acquiring the same attempt row lock, so an old candidate cannot submit an attempt that was just extended.

Legacy assessments/sections/modules use timestamp without timezone despite Instant DTO fields. Response projection interprets those stored values as UTC, as Java does, rather than using the Node host timezone. Creation/update DTO timestamps preserve Java's response-before-flush behavior; GET timestamps are checked separately.

## Taking and result contract

Taking operations require STUDENT and the student's own attempt. Results/review allow the student, assessment owner or ADMIN. Start checks published state/availability, then returns an existing STARTED attempt if present; otherwise it checks assignment/access, due date, attempts used and section structure. Database uniqueness constrains active/numbered attempts. Each new attempt snapshots its question references into attempt_question rows.

SOFT exposes the full sheet. Strict section/module actions return 409 on SOFT. STRICT opens sections in order; all module durations set means module timing, otherwise the section has one clock. Only the active module's questions are sent for module-timed sections. Taking DTOs never include the snapshot answer or explanation. Snapshot content/options/stimulus remain immutable version data, not current author edits.

Saves, flags and per-question time reports lock the attempt. They enforce STARTED, question membership and active part. The hard deadline and STRICT part clocks allow a five-second save grace. Question-time is STRICT-only, validates up to 200 entries, merges duplicate IDs and clamps reports to time since the last report or relevant part start. First/last viewed and last activity are updated atomically. An injected late persistence failure rolls back the entire answer/activity update.

Module completion opens the next module immediately or closes its section; section completion requires a started part. Repeated completion of a closed part is idempotent even after submission. Starting a later section requires every earlier section closed. Submission is idempotent and serializes under the attempt row lock; a result is created only once. Reason distinguishes STUDENT_SUBMIT, SECTIONS_COMPLETED and DEADLINE_EXPIRED. A start-next-section that detects an expired attempt calls submit then throws; Java rolls that transaction back, and TypeScript retains that behavior.

Worker order is hard-deadline attempts, then STRICT modules, then STRICT sections. It acts only after the grace, rechecks status/deadline under lock, ends a timed-out module at its deadline and starts the next from that deadline (no extra time while absent). Repeated sweeps do not duplicate results. SOFT parts do not expire on module/section clocks.

MC grading compares nonempty sets, supporting string/array/selectedOptionId(s) answers. FILL_IN supports text equality ignoring case or exact bounded rational arithmetic: 3/4 = .75 = 6/8. Numeric input is limited to 32 characters and rejects exponents and zero denominators; BigInt avoids floating-point equality. Points use the persisted two-decimal amounts, with section/topic totals and final result amounts. Answered legacy ESSAY/SHORT_ANSWER remains PENDING_REVIEW; unanswered ones grade INCORRECT.

Result endpoints expose scores only when every question is final and release policy allows it. MANUAL release requires results_released_at; AFTER_DEADLINE uses explicit release time or availableUntil. Teachers/ADMIN may inspect review while hidden from students. A result read still uses the student-facing availability decision, even for teachers, matching Java.

## Catalog, history and stats

Catalog/facets/history/stats require STUDENT. Catalog visibility requires PUBLISHED, in availability window, some question, and either an active attempt or permission to start by OPEN/assignment with no overdue assignment. The baseline does not hide a card just because maxAttempts is exhausted. Filters OR within each group and AND across groups: type/category, literal q, exam substring, skill keywords in section name/code, rounded-minute length buckets, progress status and duration bounds. Facets replace only their own group; switching exams drops the prior exam's skill selection. Card difficulty comes from current question difficulty (not pinned snapshot), ties to harder. This intentional Java inconsistency is retained.

History includes submitted attempts at nondeleted assessments even after closing/unavailability, ordered submittedAt DESC then attempt ID, ignoring client sort. Stats use X-Timezone and a 30-day window for counts/time/accuracy, all history for streaks, and the latest 10 released OPEN TEST results for best score. Accuracy and best-score comparisons use decimal HALF_UP rounding implemented with integer arithmetic.

Known baseline policy inconsistency: history/my-stats use release policy without checking final grading, whereas result/review also require no pending grading. This can surface a legacy provisional score in history/stats before the result endpoint considers it final. Migration preserves it; tightening it requires a separate policy change before relying on legacy manual-grading visibility.

## Verification scope and normalization

Registered comparisons: 69 authoring, 139 taking/result, 62 catalog/history/stats = 270 Assessment cases. Additional assertions force concurrent submits on BOTH Java and TypeScript, check answer rollback, validate time budgets, exercise expiry/manual sweeps and a forced stale-deadline/extension race. HTTP plus ten assessment/attempt/result tables are compared from the same isolated before-state. Tests include exact rational inputs, legacy pending result hiding and hard-deadline timer restoration.

Generated IDs and changing wall-clock instants are normalized, retaining null/non-null distinctions for lifecycle times. Calculated elapsed seconds are checked within the measured wall-clock interval between sequential Java/TypeScript requests; static score/state data remains exact. GET persisted response timestamps are checked separately. ID sets and keyed grade-breakdown section/topic arrays are compared by identity because Java builds them from unordered queries; UI section/module/question ordering remains exact. Dedicated assertions check deadline deltas, microsecond undo (Vocabulary), worker boundary timestamps and result uniqueness. Timer registration does not constitute production deployment or proof for all clock/input boundaries.
