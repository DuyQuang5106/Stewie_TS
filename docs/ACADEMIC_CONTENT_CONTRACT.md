# Academic Content migration contract

Java source: `C:/Users/LENOVO/Projects/base-stiu/stiu_base/demo1/src/main/java/com/example/demo/academiccontent/`.
Target: `C:/Users/LENOVO/Projects/stw-ts`. Java remains schema owner; no migrations or writes against existing local/staging databases are authorized by this implementation.

This inventory covers 53 routes from all eight Java controllers. Each route has been ported; detailed contracts and local verification scope follow below. Passing these tests does not constitute a deployment or exhaustive equivalence proof.

## Endpoint inventory

| Method | Path | Java controller | State |
|---|---|---|---|
| GET | `/api/academic/topics` | ClassificationController | Previously migrated |
| POST | `/api/academic/topics` | ClassificationController | Implemented; local write parity verified |
| PUT | `/api/academic/topics/{id}` | ClassificationController | Implemented; local write parity verified |
| POST | `/api/academic/topics/{id}/archive` | ClassificationController | Implemented; local write parity verified |
| POST | `/api/academic/topics/{id}/restore` | ClassificationController | Implemented; local write parity verified |
| GET | `/api/academic/skills` | ClassificationController | Previously migrated |
| POST | `/api/academic/skills` | ClassificationController | Implemented; local write parity verified |
| PUT | `/api/academic/skills/{id}` | ClassificationController | Implemented; local write parity verified |
| POST | `/api/academic/skills/{id}/archive` | ClassificationController | Implemented; local write parity verified |
| POST | `/api/academic/skills/{id}/restore` | ClassificationController | Implemented; local write parity verified |
| GET | `/api/academic/public/questions` | PublicQuestionController | Previously migrated |
| GET | `/api/academic/question-banks` | QuestionBankController | Previously migrated |
| GET | `/api/academic/question-banks/{id}` | QuestionBankController | Previously migrated |
| POST | `/api/academic/question-banks` | QuestionBankController | Implemented; local resource write parity verified |
| PUT | `/api/academic/question-banks/{id}` | QuestionBankController | Implemented; local resource write parity verified |
| POST | `/api/academic/question-banks/{id}/archive` | QuestionBankController | Implemented; local resource write parity verified |
| POST | `/api/academic/question-banks/{id}/restore` | QuestionBankController | Implemented; local resource write parity verified |
| GET | `/api/academic/questions` | QuestionController | Previously migrated |
| GET | `/api/academic/questions/{id}` | QuestionController | Previously migrated |
| POST | `/api/academic/questions` | QuestionController | Implemented; question aggregate parity verified locally |
| PUT | `/api/academic/questions/{id}` | QuestionController | Implemented; question aggregate parity verified locally |
| POST | `/api/academic/questions/{id}/publish` | QuestionController | Implemented; question aggregate parity verified locally |
| POST | `/api/academic/questions/{id}/revise` | QuestionController | Implemented; question aggregate parity verified locally |
| POST | `/api/academic/questions/{id}/archive` | QuestionController | Implemented; question aggregate parity verified locally |
| POST | `/api/academic/questions/{id}/restore` | QuestionController | Implemented; question aggregate parity verified locally |
| POST | `/api/academic/questions/{id}/duplicate` | QuestionController | Implemented; question aggregate parity verified locally |
| POST | `/api/academic/questions/{id}/transfer-ownership` | QuestionController | Implemented; question aggregate parity verified locally |
| GET | `/api/academic/questions/{id}/versions` | QuestionController | Previously migrated |
| POST | `/api/academic/question-imports/validate` | QuestionImportExportController | Implemented; local workflow parity verified |
| POST | `/api/academic/question-imports/{batchId}/commit` | QuestionImportExportController | Implemented; local workflow parity verified |
| GET | `/api/academic/question-imports/{batchId}` | QuestionImportExportController | Implemented; local workflow parity verified |
| GET | `/api/academic/question-exports` | QuestionImportExportController | Implemented; local workflow parity verified |
| POST | `/api/academic/question-versions/{versionId}/reviews` | QuestionQualityReviewController | Implemented; local workflow parity verified |
| GET | `/api/academic/question-versions/{versionId}/reviews` | QuestionQualityReviewController | Implemented; local HTTP parity verified |
| GET | `/api/academic/question-reviews` | QuestionQualityReviewController | Implemented; local HTTP parity verified |
| GET | `/api/academic/stimuli` | StimulusController | Previously migrated |
| GET | `/api/academic/stimuli/{id}` | StimulusController | Previously migrated |
| POST | `/api/academic/stimuli` | StimulusController | Implemented; local resource write parity verified |
| PUT | `/api/academic/stimuli/{id}` | StimulusController | Implemented; local resource write parity verified |
| POST | `/api/academic/stimuli/{id}/publish` | StimulusController | Implemented; local resource write parity verified |
| POST | `/api/academic/stimuli/{id}/archive` | StimulusController | Implemented; local resource write parity verified |
| POST | `/api/academic/stimuli/{id}/restore` | StimulusController | Implemented; local resource write parity verified |
| GET | `/api/academic/tag-groups` | TagController | Previously migrated |
| GET | `/api/academic/tag-groups/{id}` | TagController | Previously migrated |
| POST | `/api/academic/tag-groups` | TagController | Implemented; local write parity verified |
| PUT | `/api/academic/tag-groups/{id}` | TagController | Implemented; local write parity verified |
| DELETE | `/api/academic/tag-groups/{id}` | TagController | Implemented; local write parity verified |
| GET | `/api/academic/tags/{id}` | TagController | Previously migrated |
| GET | `/api/academic/tag-groups/{groupId}/tags` | TagController | Previously migrated |
| GET | `/api/academic/tags/by-group/{groupId}` | TagController | Previously migrated |
| POST | `/api/academic/tags` | TagController | Implemented; local write parity verified |
| PUT | `/api/academic/tags/{id}` | TagController | Implemented; local write parity verified |
| DELETE | `/api/academic/tags/{id}` | TagController | Implemented; local write parity verified |

## Review read contract

Both routes require a valid current DB user with TEACHER or ADMIN role. JWT roles do not override DB roles. Unauthenticated requests return 401; student requests return 403. Uses the same feature flag and Java-compatible error envelope as existing read routes.

### GET /api/academic/question-versions/{versionId}/reviews

UUID parameter uses Java-compatible conversion. Missing version: 404. Teacher can access only versions whose question.owner is that teacher; foreign or null owner: 403. Admin can read all. Archived questions remain accessible under the ownership rules. For a soft-deleted question, the current Java implementation returns 500 for teachers, and for admins when history is nonempty, because Hibernate cannot resolve the deleted entity. Preserve and document this behavior; changing it requires a separate contract decision.

Response: array ordered by createdAt descending, empty when version exists with no history. Each item: id, questionId, questionVersionId, versionNumber, status, comment (nullable), reviewerAccountId, createdAt (local timestamp).

### GET /api/academic/question-reviews

Query: status defaults to PENDING (also for empty/whitespace-only values); supported PENDING, APPROVED, CHANGES_REQUESTED. Invalid status: 400 parameter conversion error. page/size follow existing Spring-compatible resolver; size capped at 2000. Allowed sorts: publishedAt, versionNumber, reviewStatus; unsupported sort gives 400 `Review sort field không được hỗ trợ: FIELD`. No default ordering contract. Teacher sees only own question versions; admin sees all. Archived versions are included. Content excludes soft-deleted questions. Spring optimizes partial-page totals, but the admin derived count query counts matching versions without the question join, so totals on full/empty later pages can include deleted-question versions. This baseline inconsistency is preserved and tested.

Response: {content: [{questionId, questionVersionId, versionNumber, questionBankId, reviewStatus, publishedAt}], page: {size, number, totalElements, totalPages}}.

## Migration sequence

1. Review reads and their differential tests (current batch).
2. Classification and tag writes: implemented in src/academic-write; 121 HTTP/DB differential cases passed locally.
3. Stimulus and bank writes: implemented; 137 HTTP/state differential cases plus real Java/TypeScript optimistic-update races.
4. Question writes: implemented with type-specific validation, immutable snapshots, duplicate/ownership audit, aggregate rollback and concurrency tests.
5. Review decisions: admin-only, append-only history plus version state update in one transaction.
6. Import/export: document validation, batch ownership, atomic commit, repeated commit behavior and export schema.

Each write batch requires a separate isolated mutable test database; do not relax the existing read-only snapshot helper or grant write access to shared databases.

## Controller request/response and permission index

This index records controller declarations, not full service authorization. Request DTO validation annotations are under `dto/`; ownership/state checks are under the corresponding `service/`. Refer to the detailed contract above for review reads. Classification/tag, Stimuli/Question Banks and Question writes are ported and verified. Review decisions and import/export are also implemented; see the workflow contract below.

| Endpoint | Role gate | Body DTO | Response DTO |
|---|---|---|---|
| GET `/api/academic/topics` | TEACHER / ADMIN; ownership in service | Path/query only | Page<ClassificationResponseDTO> |
| POST `/api/academic/topics` | ADMIN | CreateClassificationRequestDTO | ClassificationResponseDTO |
| PUT `/api/academic/topics/{id}` | ADMIN | UpdateClassificationRequestDTO | ClassificationResponseDTO |
| POST `/api/academic/topics/{id}/archive` | ADMIN | Path/query only | ClassificationResponseDTO |
| POST `/api/academic/topics/{id}/restore` | ADMIN | Path/query only | ClassificationResponseDTO |
| GET `/api/academic/skills` | TEACHER / ADMIN; ownership in service | Path/query only | Page<ClassificationResponseDTO> |
| POST `/api/academic/skills` | ADMIN | CreateClassificationRequestDTO | ClassificationResponseDTO |
| PUT `/api/academic/skills/{id}` | ADMIN | UpdateClassificationRequestDTO | ClassificationResponseDTO |
| POST `/api/academic/skills/{id}/archive` | ADMIN | Path/query only | ClassificationResponseDTO |
| POST `/api/academic/skills/{id}/restore` | ADMIN | Path/query only | ClassificationResponseDTO |
| GET `/api/academic/public/questions` | Authenticated | Path/query only | Page<PublicQuestionMetadataDTO> |
| GET `/api/academic/question-banks` | TEACHER / ADMIN; ownership in service | Path/query only | Page<QuestionBankResponseDTO> |
| GET `/api/academic/question-banks/{id}` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionBankResponseDTO |
| POST `/api/academic/question-banks` | TEACHER / ADMIN; ownership in service | CreateQuestionBankRequestDTO | QuestionBankResponseDTO |
| PUT `/api/academic/question-banks/{id}` | TEACHER / ADMIN; ownership in service | UpdateQuestionBankRequestDTO | QuestionBankResponseDTO |
| POST `/api/academic/question-banks/{id}/archive` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionBankResponseDTO |
| POST `/api/academic/question-banks/{id}/restore` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionBankResponseDTO |
| GET `/api/academic/questions` | TEACHER / ADMIN; ownership in service | Path/query only | Page<QuestionSummaryResponseDTO> |
| GET `/api/academic/questions/{id}` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionAuthorResponseDTO |
| POST `/api/academic/questions` | TEACHER / ADMIN; ownership in service | CreateQuestionRequestDTO | QuestionAuthorResponseDTO |
| PUT `/api/academic/questions/{id}` | TEACHER / ADMIN; ownership in service | UpdateQuestionRequestDTO | QuestionAuthorResponseDTO |
| POST `/api/academic/questions/{id}/publish` | TEACHER / ADMIN; ownership in service | PublishQuestionRequestDTO | QuestionAuthorResponseDTO |
| POST `/api/academic/questions/{id}/revise` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionAuthorResponseDTO |
| POST `/api/academic/questions/{id}/archive` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionAuthorResponseDTO |
| POST `/api/academic/questions/{id}/restore` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionAuthorResponseDTO |
| POST `/api/academic/questions/{id}/duplicate` | TEACHER / ADMIN; ownership in service | DuplicateQuestionRequestDTO | QuestionAuthorResponseDTO |
| POST `/api/academic/questions/{id}/transfer-ownership` | ADMIN | TransferQuestionOwnershipRequestDTO | QuestionAuthorResponseDTO |
| GET `/api/academic/questions/{id}/versions` | TEACHER / ADMIN; ownership in service | Path/query only | List<QuestionVersionResponseDTO> |
| POST `/api/academic/question-imports/validate` | TEACHER / ADMIN; ownership in service | QuestionImportDocumentDTO | QuestionImportBatchResponseDTO |
| POST `/api/academic/question-imports/{batchId}/commit` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionImportBatchResponseDTO |
| GET `/api/academic/question-imports/{batchId}` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionImportBatchResponseDTO |
| GET `/api/academic/question-exports` | TEACHER / ADMIN; ownership in service | Path/query only | QuestionExportDocumentDTO |
| POST `/api/academic/question-versions/{versionId}/reviews` | ADMIN | CreateQuestionReviewRequestDTO | QuestionReviewResponseDTO |
| GET `/api/academic/question-versions/{versionId}/reviews` | TEACHER / ADMIN; ownership in service | Path/query only | List<QuestionReviewResponseDTO> |
| GET `/api/academic/question-reviews` | TEACHER / ADMIN; ownership in service | Path/query only | Page<QuestionReviewQueueItemDTO> |
| GET `/api/academic/stimuli` | TEACHER / ADMIN; ownership in service | Path/query only | Page<StimulusResponseDTO> |
| GET `/api/academic/stimuli/{id}` | TEACHER / ADMIN; ownership in service | Path/query only | StimulusResponseDTO |
| POST `/api/academic/stimuli` | TEACHER / ADMIN; ownership in service | CreateStimulusRequestDTO | StimulusResponseDTO |
| PUT `/api/academic/stimuli/{id}` | TEACHER / ADMIN; ownership in service | UpdateStimulusRequestDTO | StimulusResponseDTO |
| POST `/api/academic/stimuli/{id}/publish` | TEACHER / ADMIN; ownership in service | Path/query only | StimulusResponseDTO |
| POST `/api/academic/stimuli/{id}/archive` | TEACHER / ADMIN; ownership in service | Path/query only | StimulusResponseDTO |
| POST `/api/academic/stimuli/{id}/restore` | TEACHER / ADMIN; ownership in service | Path/query only | StimulusResponseDTO |
| GET `/api/academic/tag-groups` | Authenticated | Path/query only | List<TagGroupResponseDTO> |
| GET `/api/academic/tag-groups/{id}` | Authenticated | Path/query only | TagGroupResponseDTO |
| POST `/api/academic/tag-groups` | ADMIN | CreateTagGroupRequestDTO | TagGroupResponseDTO |
| PUT `/api/academic/tag-groups/{id}` | ADMIN | UpdateTagGroupRequestDTO | TagGroupResponseDTO |
| DELETE `/api/academic/tag-groups/{id}` | ADMIN | Path/query only | Void |
| GET `/api/academic/tags/{id}` | Authenticated | Path/query only | TagResponseDTO |
| GET `/api/academic/tag-groups/{groupId}/tags` | Authenticated | Path/query only | List<TagResponseDTO> |
| GET `/api/academic/tags/by-group/{groupId}` | Authenticated | Path/query only | List<TagResponseDTO> |
| POST `/api/academic/tags` | ADMIN | CreateTagRequestDTO | TagResponseDTO |
| PUT `/api/academic/tags/{id}` | ADMIN | UpdateTagRequestDTO | TagResponseDTO |
| DELETE `/api/academic/tags/{id}` | ADMIN | Path/query only | Void |

## Service constraints confirmed during review

- Classification writes: ADMIN only; create normalizes name/slug and starts ACTIVE. Case-insensitive duplicate slug gives 409. Update requires ACTIVE. Archive requires ACTIVE; restore requires ARCHIVED. Missing ID gives 404. Request DTO validation also applies before these rules.
- Tag/group writes: ADMIN only. Duplicate group code or tag slug gives 409. Delete returns 204; resources still referenced cannot be deleted (409).
- Stimulus writes: TEACHER owns via createdBy, ADMIN may manage all. New items start DRAFT. Update/publish require DRAFT; restore changes ARCHIVED to DRAFT. Content must be a nonempty JSON object within 100000 serialized characters. Wrong lifecycle gives 409; foreign teacher gets 403.
- Bank writes: teacher may create only TEACHER scope for self. ADMIN creating SYSTEM cannot supply human owner; TEACHER scope must name a TEACHER owner. Names are unique within system scope or owner, case-insensitive. Update requires ACTIVE; archive/restore enforce status. Foreign teacher gets 403; missing owner/bank gives 404.
- Review decision writes: ADMIN only. PENDING is not a decision. CHANGES_REQUESTED requires nonblank comment. Normalize comment; insert review and change version.reviewStatus in one transaction. Body validation rejects missing/invalid status before business checks.
- Import validation: schemaVersion 1; 1..100 questions, max 1000000 serialized UTF-8 bytes. An existing actor/importKey returns its existing batch. Duplicate externalId yields per-item error; candidate validation uses QuestionService. Batch ends VALIDATED or FAILED. Validation itself persists a batch (not a pure read).
- Import commit: only batch creator, even for ADMIN. COMMITTED returns existing result; other than VALIDATED gives 409. Question creation and batch update share one transaction. Concurrent/repeated commit behavior must be tested before port acceptance.
- Batch detail: creator or ADMIN. Export: ADMIN or owner of TEACHER bank; optional question status; order createdAt ascending; over 1000 questions gives 413. Export response schemaVersion 1 includes generatedAt and transferable question data. Dynamic timestamps must be normalized only in differential tests that need it.
- Question writes are implemented with type-specific validation, relationship checks, immutable snapshots, lifecycle transitions, optimistic locking and answer secrecy. See the detailed Question write contract below and the aggregate differential tests.

## Verification of current batch (2026-10-21)

594 HTTP comparisons against real Java passed locally (510 existing + 84 new). New cases cover four DB roles, history order/empty/not-found, UUID conversion, enum conversion including whitespace, allowed/rejected sort, paging, null owner and soft-deleted questions. Java creates review fixtures; TypeScript endpoints remain read-only. Expected baseline 500 cases are asserted, not ignored. Temporary PostgreSQL 17 on port 55443; no shared database modified. Remote parity CI still requires JAVA_BASELINE_READ_TOKEN and is not claimed passed here.

Final checks for this batch: build/typecheck PASS; oxlint PASS; 6 unit/foundation tests PASS; starter e2e PASS; 594 HTTP comparisons PASS on both reused and freshly initialized isolated PostgreSQL. The separate pool integration test was skipped because TEST_DATABASE_URL was not set; DatabaseService was unchanged. Docker image build and remote CI were not rerun for this batch. Changes are local and uncommitted.

## Catalog write contract (Topics/Skills/Tag groups/Tags)

14 routes, ADMIN only. Require READ_API_ENABLED=true, APP_JWTSECRET matching Java and ACADEMIC_WRITE_API_ENABLED=true. The write flag defaults to false and is checked both by the HTTP guard and DatabaseService.writeTransaction. Enabling it with reads disabled is a startup configuration error. Existing readSnapshot remains READ ONLY. No schema migration, environment secret or existing database was modified.

### Request schemas

| Resources/actions | Input | Validation before normalization |
|---|---|---|
| POST topics/skills; PUT topics/skills/{id} | name, slug | Both required/nonblank, max 100 UTF-16 code units. Slug: lowercase ASCII letters/digits separated by single hyphens. |
| POST tag-groups; PUT tag-groups/{id} | name, code | Both required/nonblank, max 50. Code: ASCII letters/digits separated by hyphen/underscore. |
| POST tags | tagGroupId, name, slug | Required UUID parent; name/slug required/nonblank, max 100. Slug pattern as classifications. |
| PUT tags/{id} | name, slug | Same string validation; tagGroupId is not an update field and is ignored. |
| POST topics/skills/{id}/archive or restore; DELETE tags/tag-groups/{id} | No body required | Path UUID conversion applies. |

Unknown JSON properties are ignored as in Java, without changing Nest's global DTO whitelist policy. Jackson scalar-to-string coercion is supported. Name trimming follows Java String.trim; group code normalizes to uppercase, slug to lowercase after validation. This does not make uppercase or whitespace-padded slugs valid input.

### Responses and errors

- Create: 201. Update/archive/restore: 200. Delete: 204 without response body.
- Classification response: id, name, slug, status, createdAt, updatedAt.
- Tag response: id, tagGroupId, name, slug, createdAt, updatedAt. Tag group response: id, name, code, createdAt, updatedAt, tags (including existing children on update).
- DB role is authoritative. Unauthenticated requests give 401. Valid non-admin requests give 403. As in Spring MVC, binding/DTO validation happens before method-level authorization, so invalid bodies can yield validation/deserialization errors for authenticated non-admins.
- Validation: 400 with Java fieldErrors and messages. A blank slug violates both NotBlank and Pattern; Java chooses the first unordered Hibernate violation. Differential tests accept only those two precise messages for those ambiguous cases, while still asserting the remaining error envelope and state.
- Malformed JSON, missing/null/scalar body, object in String field and invalid body UUID currently produce 500 in Java's catch-all. That behavior is preserved and explicitly tested; no parser error text leaks to the response. Unauthorized malformed requests still yield 401. Path UUID errors give 400. Missing resources/parent group give 404. Duplicate slug/code or invalid lifecycle gives 409.
- Delete tag group mirrors Java cascade/orphanRemoval: remove all child tags, then parent in one transaction. If any child is referenced by a question, the entire transaction rolls back, including previously deleted unreferenced children. A nonempty unreferenced group can be deleted.
- No-op updates preserve updatedAt, matching Hibernate dirty checking. All returned timestamps are checked against stored local timestamp values. New UUIDs and mutation timestamps necessarily differ across independently executed Java/TypeScript writes.

### Verification method

The suite runs only in the DB-name-checked disposable stiu_read_api_test database. For each write case it snapshots all four catalog tables, invokes Java, records response and resulting rows, restores the snapshot, invokes TypeScript, then compares both response and persisted state. Only generated UUIDs and timestamp values are normalized across the two executions. Failure cases must leave the full table snapshot unchanged. Timestamp response format and equality to each backend's stored value are checked separately.

121 write cases plus 594 existing read cases = 715 differential cases. Additional assertions cover disabled writes (HTTP and direct transaction helper), rollback/pool reuse, atomic cascade failure and simultaneous duplicate creates (one 201, one 409, exactly one row). Test HTTP calls have a 15-second deadline. Fixture cleanup is limited to this suite's own catalog fixture keys in the already isolated test database.

Remaining Academic Content work: review decisions and import/export. No production traffic switch, commit/push or remote CI run is included in this batch.

Final catalog batch verification: typecheck/build and lint PASS; 6 unit tests PASS; starter e2e PASS; both integration files PASS against freshly initialized isolated databases. Remote CI and Docker image build not rerun. See IMPORT_VERIFICATION.md for evidence scope.

## Resource write contract: Stimuli and Question Banks (2026-10-22)

9 new routes under the existing ACADEMIC_WRITE_API_ENABLED flag (default false). They require current DB TEACHER or ADMIN roles, with ownership/scope checks below. No schema migrations or permission grants are performed. Java remains the schema owner. The inventory counts both tag aliases, hence 53 total routes.

### Stimuli

- POST /stimuli: body title (nonblank, max 255 UTF-16 units), content (required JSON node), optional source (max 1000). Returns 201, DRAFT, createdByAccountId=current actor.
- PUT /stimuli/{id}: same body, only DRAFT. Returns 200. Teacher must be creator; ADMIN may manage all, including legacy null-creator rows. No-op updates keep persisted updated_at.
- POST /stimuli/{id}/publish: DRAFT -> PUBLISHED, revalidates stored content. POST archive: DRAFT/PUBLISHED -> ARCHIVED; repeated archive gives 409. POST restore: ARCHIVED -> DRAFT; other states give 409. Each returns 200.
- Content must be a nonempty object and JSON serialization length <=100000 UTF-16 code units, matching Java String.length. Missing content gives DTO NotNull error; explicit JSON null, empty object, arrays/scalars give the service's 400 object-content error. Tests exercise exact 100000 ASCII serialization, oversized content and multibyte Unicode within the limit. JSON parser allows up to 1 MB so the business character limit is not prematurely rejected as a byte limit.
- Source normalizes blank to null, otherwise Java-trims; title is Java-trimmed after validation. Unknown fields are ignored. Object in String field/unreadable body preserves the known Java 500 behavior. Valid student requests give 403; invalid path UUID gives 400; missing resource 404; wrong lifecycle 409. Ownership precedes state/content business checks.
- Response fields: id, title, content, source, status, createdByAccountId, createdAt, updatedAt. Current Java DTO timing is preserved: create timestamps are null in the immediate response although nonnull in DB after commit. Updates/lifecycle responses contain pre-flush timestamps; subsequent GET shows committed timestamps. The differential harness explicitly checks nullability and the appropriate before/after DB timestamp, rather than ignoring this discrepancy.

### Question Banks

- POST /question-banks: name required/nonblank max 255; optional description max 1000; required scope SYSTEM/TEACHER; optional ownerAccountId UUID. Returns 201 ACTIVE, internal version=0. Names and description normalize after validation; blank description becomes null.
- Teacher can create only TEACHER banks for self (owner omitted or own ID). SYSTEM scope or other owner gives 403. ADMIN creating SYSTEM must not supply an owner (400). ADMIN creating TEACHER must supply an existing nondeleted TEACHER user: missing owner 400, unknown/deleted user 404, other role 400.
- PUT /question-banks/{id}: name/description only; scope/owner fields are ignored because Java's update DTO does not contain them. ACTIVE only. Teacher must own a TEACHER bank; ADMIN may manage all. Returns 200. No-op does not increment version or change timestamps.
- POST archive: ACTIVE -> ARCHIVED; POST restore: ARCHIVED -> ACTIVE; both return 200. Repeated/wrong-state transitions give 409. Missing or soft-deleted bank gives 404. Foreign teacher or SYSTEM bank access by teacher gives 403.
- Duplicate name comparison is case-insensitive within SYSTEM scope or TEACHER owner, including archived banks. Existing SQL unique indexes also include soft-deleted banks even though JPA existence queries exclude them; duplicate creation in that case still gives 409 via constraint handling. Other owners and SYSTEM/TEACHER scopes may reuse a name.
- Every changed update/lifecycle statement compares the loaded version in its WHERE clause and increments version atomically. If another request wins, zero updated rows gives Java-compatible 409 optimistic-conflict message; no stale overwrite or automatic retry. Response omits internal version.
- Create/update responses are post-flush (stored timestamps); archive/restore responses contain pre-flush timestamps, matching Java save versus saveAndFlush. Response: id,name,description,scope,status,ownerAccountId,createdAt,updatedAt.
- JSON enum/UUID binding edge behavior is tested: numeric enum ordinals 0/1 and trimmed enum strings follow Jackson; empty/invalid enum gives known unreadable-body behavior; UUID body conversion is stricter than path UUID conversion.

### Verification and remaining work

137 resource write comparisons check responses and all persisted rows of stimulus/question_bank with before-state restoration between Java and TypeScript, including internal version, disabled flag, four user roles, owner validation, null creator, legacy invalid content, limits and soft deletion. Additional races check unique names and forced same-version updates against BOTH Java and TypeScript: one 200, one 409, exactly one version increment. All HTTP calls have bounded deadlines; expected baseline 500 cases are asserted.

Combined differential count: 594 read + 121 catalog write + 137 resource write = 852 cases, plus separate rollback/concurrency assertions. No production/shared DB, environment secret or traffic routing changed. Remaining writes: review decisions and import/export. No commit/push or remote CI run is included in this batch.

Lifecycle routes do not consume a request body in Java. Malformed JSON supplied to publish/archive/restore is therefore ignored after authentication/authorization; seven additional parity cases cover this, including 401/403 outcomes. Create/update malformed JSON keeps the documented Java error behavior.

## Question write contract (2026-10-22)

8 routes under ACADEMIC_WRITE_API_ENABLED (default false), with the same Java-compatible JWT guard. Current DB TEACHER/ADMIN may manage own questions; ADMIN may manage all. Transfer ownership requires ADMIN. No schema changes or privilege grants are included.

| Method/path under /api/academic | Body | Success |
|---|---|---|
| POST /questions | Create question aggregate | 201 DRAFT, owner from bank, creator=current actor, currentVersionId=null |
| PUT /questions/{id} | Update question aggregate | 200; DRAFT only, bank cannot be changed by this DTO |
| POST /questions/{id}/publish | changeSummary optional, max 1000 | 200; DRAFT -> PUBLISHED, new immutable version |
| POST /questions/{id}/revise | No consumed body | 200; PUBLISHED -> DRAFT, keeps current published version |
| POST /questions/{id}/archive | No consumed body | 200; remembers DRAFT/PUBLISHED in previous_status |
| POST /questions/{id}/restore | No consumed body | 200; ARCHIVED -> previous_status, fallback DRAFT; clears previous_status |
| POST /questions/{id}/duplicate | targetQuestionBankId required UUID | 201; new DRAFT aggregate, no version history, creator=current actor |
| POST /questions/{id}/transfer-ownership | targetQuestionBankId required UUID; reason nonblank max 1000 | 200; ADMIN only, atomically changes bank/owner and inserts audit |

### DTO binding and validation

Create requires questionBankId, questionType, difficulty, content, answer, explanation. Update omits questionBankId (unknown properties are ignored), accepts the same other fields. stimulusId is nullable; omitted or null topicIds/skillIds/tagIds become empty sets; UUID/set deserialization follows Jackson. Body UUID syntax is stricter than path UUID syntax. Unknown DTO properties are ignored and scalar String coercion follows the existing Java API. Wrong JSON shapes/invalid enum or UUID body preserve Java's current 500 envelope; Bean Validation produces 400 fieldErrors. Binding/DTO validation precedes method authorization; authentication still occurs first.

- questionType: MULTIPLE_CHOICE, FILL_IN, SHORT_ANSWER, ESSAY. difficulty: EASY, MEDIUM, HARD.
- content: title nonblank <=255; prompt nonblank <=20000; optional ordered options list, each id nonblank <=50 and content nonblank <=5000.
- answer: optional correctOptionIds set (elements <=50); acceptedAnswers ordered list (elements <=1000); gradingMode optional NUMERIC/TEXT_EXACT; gradingGuide optional <=10000.
- explanation: text nonblank <=20000, including drafts. Nested paths match Spring (e.g. content.options[0].id, answer.correctOptionIds[], answer.acceptedAnswers[0]).
- MULTIPLE_CHOICE: >=2 options, unique IDs, at least one valid correctOptionId; no acceptedAnswers/nonblank gradingGuide.
- FILL_IN/SHORT_ANSWER: no options; at least one nonblank acceptedAnswer; no correctOptionIds/nonblank gradingGuide. Null/blank additional acceptedAnswers follow Java behavior.
- ESSAY: no options; nonblank gradingGuide; no correctOptionIds/acceptedAnswers. gradingMode is not an extra type-specific restriction in the Java service.

### Relationships, authorization and lifecycle

Create validates aggregate business rules, then bank, stimulus, tags, topics, skills, in that order. Bank must exist/nondeleted/ACTIVE; teacher must own a TEACHER bank. SYSTEM owner is null, TEACHER owner is bank owner, independently of creator. Stimulus must exist and not be ARCHIVED; teacher must be its creator. Tags must exist; topics/skills must exist and be ACTIVE. Missing references yield 404; archived relationships/wrong lifecycle yield 409; forbidden ownership yields 403.

Update first loads nondeleted question, checks ownership and DRAFT, then validates aggregate and relationships. Existing drafts can still be edited in an archived bank because Java does not resolve the bank again for update. Collections are replaced, not appended. Hibernate dirties the versioned parent even for an otherwise identical update, including empty relationship sets; TypeScript preserves the version increment. Answer/explanation have separate dirty checks/timestamps; DTO updates remove unknown legacy JSON fields as Java does.

Publish checks DRAFT, ACTIVE bank, attached stimulus PUBLISHED, all topics/skills ACTIVE, valid persisted aggregate and nonblank explanation. Snapshot includes question ID/type/difficulty, raw deep-copied content/answer/explanation, bank ID and classification/tag IDs, plus embedded stimulus ID/title/content and optional source. Unknown legacy fields in raw JSON are preserved in snapshots. Version number is max(existing)+1, status PENDING for quality review. Snapshot insertion, current version pointer and question state/version update commit together; older snapshots remain unchanged after revise/edit/publish.

Duplicate checks source question access and target bank access/ACTIVE; rejects an archived attached stimulus. It copies raw JSON and relationships but does not rerun topic/skill ACTIVE validation (so legacy archived classifications may be duplicated). New question has fresh ID/answer, DRAFT, version=0, no previous/current published version and no copied review history. Response still follows DTO projection, hiding unknown legacy fields.

Transfer permits all source question states, resolves ACTIVE target bank and rejects same bank (409). Owner derives from target bank; creator and existing snapshots remain unchanged. Audit records from/to bank, nullable from/to owner, changedBy, trimmed reason, changedAt. Any audit failure rolls back the preceding question update, including version/timestamps.

### Persistence and concurrency

All changes use one opt-in write transaction for question, question_answer, question_tag/topic/skill, question_version and question_ownership_audit. Existing readSnapshot stays READ ONLY. Parent updates compare loaded version and increment atomically; stale writes return Java-compatible optimistic 409. Concurrent publish can also hit the existing unique question/version-number constraint, yielding Java's generic integrity 409; the losing transaction leaves no extra version. No automatic retries change the request semantics.

Response: QuestionAuthorResponseDTO (id, bank/stimulus IDs, type/difficulty/status, projected content/answer/explanation, topic/skill/tag ID sets, owner/creator/current version IDs, createdAt/updatedAt). All write operations use Java saveAndFlush, so response timestamps match committed question values. Options and acceptedAnswers retain order; ID sets have no ordering contract.

### Verification scope

130 question differential cases compare HTTP status/body and all rows of seven aggregate tables, including internal versions and joins. The isolated DB harness restores before-state between executing Java and TypeScript, handles the current_version FK cycle and maps only newly generated UUIDs, timestamps and unordered ID sets. Failure paths must preserve the complete aggregate including timestamps. Extra tests check immutable snapshots with legacy fields, raw clone data, audit failure after parent update, connection reuse, forced same-version races on BOTH Java and TypeScript, and concurrent publish with exactly versions [1,2,3].

Combined asserted count: 594 reads + 121 catalog writes + 137 resource writes + 130 question operations = 982 comparisons, plus independent rollback/concurrency assertions. The subsequent workflow batch below implements the last five Academic Content routes. The original Java source remains the reference; no shared DB, real environment credentials or production traffic are changed. This batch does not include commit/push, Docker image build or remote CI execution.


## Review decisions and import/export (2026-10-22)

Implemented in academic-write/workflow.binding.ts, workflow.service.ts and workflow.controller.ts. All three POST routes use the existing ACADEMIC_WRITE_API_ENABLED guard; batch detail/export remain available under READ_API_ENABLED independently of the write flag. No new migration or dependency is introduced.

| Method/path under /api/academic | Behavior |
|---|---|
| POST question-versions/{versionId}/reviews | ADMIN only; 201; append review and update version review_status in one transaction |
| POST question-imports/validate | TEACHER/ADMIN; 201; persist VALIDATED or FAILED batch with per-item errors |
| POST question-imports/{batchId}/commit | Batch creator only, including for ADMIN; 200; create all questions and mark COMMITTED in one transaction |
| GET question-imports/{batchId} | Creator or ADMIN; 200; includes validation errors and committed question IDs |
| GET question-exports?questionBankId=UUID&status=... | Bank access plus question owner filtering for teachers; 200; portable schemaVersion=1 document |

Review status must be APPROVED or CHANGES_REQUESTED; the latter requires a nonblank comment. Comment max 2000, normalization follows Java isBlank/trim (including Unicode distinctions). PENDING is a valid enum but an invalid decision (400). DTO validation precedes method authorization; invalid enum/JSON retains Java's current 500 envelope. Previous reviews are never overwritten.

Import document requires integer schemaVersion=1, nonblank importKey <=100, targetQuestionBankId and 1..100 nested-valid transfer items. externalId is nonblank <=100. Normalized DTO UTF-8 size is capped at 1,000,000 bytes (413); HTTP JSON parser allows the document through to this business check. A valid DTO can still produce a persisted FAILED batch with per-item business errors: duplicate externalId, missing relationships, invalid aggregate or bank state. Validation does not create questions. Missing/null relation sets stay null in stored payload and become empty sets when constructing a question candidate. Unexpected failures roll back the batch.

Import keys are trimmed and unique per creator. An existing key returns its original batch after document-level validation, before checking the new target bank/items. Commit requires VALIDATED; FAILED gives 409. Sequential repeated commit returns the existing IDs. Candidate creation reuses QuestionWriteService with the same PoolClient, so a later item failure rolls back all earlier inserted questions and leaves the batch/timestamps unchanged. ADMIN may inspect another creator's batch but cannot commit it.

Exports contain schemaVersion, exportedAt, sourceQuestionBankId and transfer items (externalId=question UUID); optional status is DRAFT/PUBLISHED/ARCHIVED. Questions are ordered by created_at ascending and the service rejects more than 1000 results with 413. Equal timestamps have no specified tie-breaker, matching Java. No question ownership/status/version metadata is included in transfer items.

Source-level limitation retained from Java: import batches have neither an optimistic version nor a commit row lock. Sequential replay is verified; concurrent commits of the same VALIDATED batch are not guaranteed to create only one set of questions. Both backends were then tested with two concurrent commit requests held at the batch-row update: both returned 200 and created four questions from a two-item document, while the batch retained only one request's two IDs. The export boundary was also verified: 1000 succeeds, 1001 returns 413. Changing concurrency semantics should be agreed as a contract change.

Verification: 75 workflow differential cases compare HTTP and all nine question/review/import tables, restoring the same before-state for each backend. Coverage includes authorization, DTO coercion/Unicode, nested errors, duplicate keys/external IDs, stored per-item errors, commit ownership/replay, late-item atomic rollback, export filters and normalized UTF-8 payload limits with ASCII/non-ASCII content. Existing read, catalog, resource and question suites remain mandatory. Total asserted comparisons: 594 + 121 + 137 + 130 + 75 = 1057. This is Academic Content scope; other backend domains are not migrated by this batch.


## Pre-PR review

Reviewed request authentication and DB-derived roles, write opt-in checks at both guard and transaction entry, parameterized queries with internal table/action whitelists, aggregate rollback, reference visibility and secret handling. Reformatted the migrated source/tests for review. No credential patterns were found in changed/untracked files; real .env files remain ignored. No unrelated Java changes were included.

The concurrent import flaw above is reproduced deliberately in test/workflow-boundaries.cjs to characterize the Java baseline. This PR retains that behavior; a locking/idempotency fix would change the contract and should be reviewed separately before enabling concurrent import commits. The write feature flag stays false by default. Passing parity is not a claim that baseline behavior is free of defects.
