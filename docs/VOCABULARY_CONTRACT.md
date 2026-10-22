# Vocabulary migration contract

Java reference: `4b52a4c260a57b288d58048a96565e93ba554b4f`. Java retains schema ownership.

10 inventoried HTTP routes are implemented in TypeScript. This is an implementation inventory; verification evidence and limits follow below.

| Method | Path | Java controller |
|---|---|---|
| GET | `/api/vocab/due` | VocabularyController |
| GET | `/api/vocab/playlists` | VocabularyController |
| GET | `/api/vocab/playlists/{id}` | VocabularyController |
| POST | `/api/vocab/playlists` | VocabularyController |
| GET | `/api/vocab/playlists/{id}/words` | VocabularyController |
| POST | `/api/vocab/playlists/{id}/words` | VocabularyController |
| POST | `/api/vocab/words/{id}/reviews` | VocabularyController |
| DELETE | `/api/vocab/reviews/{id}` | VocabularyController |
| GET | `/api/vocab/streak` | VocabularyController |
| GET | `/api/vocab/lookup` | VocabularyController |

## Enablement and ownership

All routes require a valid current DB user. Unlike Academic Content, Vocabulary is not restricted to STUDENT: ADMIN and TEACHER may maintain their own personal vocabulary too. Enable READ_API_ENABLED and VOCABULARY_API_ENABLED with the Java-compatible JWT secret. Both flags default false. Vocabulary transactions check the Vocabulary flag independently; enabling Academic Content writes does not enable Vocabulary writes or vice versa. Java remains the owner of migrations (including V12 vocabulary schema).

Every playlist, word and review belongs to its creator. A foreign ID yields 404 even for ADMIN; personal data is never shared or globally administered by these routes. JWT roles are resolved from the DB. Unique names/terms are case-insensitive within owner/playlist. Bean Validation precedes service ownership checks; malformed body/invalid DTO scalar binding retains Java's current error envelope.

## Leitner and timezone behavior

A new word starts in box 1, first due tomorrow. Knowing it moves 1 -> 2 -> 3 -> 4 -> learned (null). Missing it returns to box 1, including from learned. Intervals by box are 1, 3, 7 and 14 local calendar days. next_review_at is the local start of the target day; due means before the start of tomorrow, not before the current instant. dueInDays clamps overdue dates to 0 and is null for learned words.

X-Timezone uses IANA zones and supported UTC/GMT offsets; missing/invalid headers fall back to Asia/Ho_Chi_Minh. PostgreSQL timezone arithmetic handles DST/calendar boundaries without assuming each local day is 86400 seconds. Case-invalid zone names fall back rather than using ICU's case-insensitive aliases. Tests cover UTC, Vietnam, New York, Kiritimati, numeric offsets, Z and invalid aliases/case.

Review inserts history and updates the word in one transaction with optimistic version checking. A losing concurrent review returns 409 and leaves no orphan review row. Undo accepts only the latest review, restores from_box/from_next_review_at, decrements seen_count to a minimum of 0 and deletes that review atomically. The stored prior review timestamp is preserved to PostgreSQL microsecond precision.

Streaks count distinct local review days. A current streak may end today or yesterday; the longest streak spans all history. Undo removes the corresponding review from streak/stat calculations. Learned counts are words with box null. Playlist statistics aggregate words/learned/boxes/due and min next review; lastReviewedAt comes from history.

## DTOs, listing and dictionary

Playlist name is required and <=120 UTF-16 code units. Word term/meaning are required and <=200/2000; optional example <=2000. Validation follows Hibernate NotBlank trim semantics, while optional text normalization follows Java isBlank/trim. Review knewIt is a required Boolean with Jackson-compatible coercion.

Word list defaults to size 50, createdAt DESC; invalid page/size values fall back to the controller defaults and size is capped at 2000. Supported sort fields are id, term, box, nextReviewAt, seenCount, createdAt, updatedAt. Filters: due, learned, maxBox, q (literal case-insensitive substring of term/meaning, with percent/underscore/backslash escaped). Invalid criteria produce Java-compatible fieldErrors. Playlist list is createdAt ASC; ties have no extra ordering promise.

Dictionary lookup lowercases a trimmed term of 1..200 characters and defaults to dictionaryapi.dev English entries. DICTIONARY_BASE_URL can point to a controlled test stub. Returns first nonempty definition in the first usable part of speech, with the first example from that same part of speech. Missing entry ->404; unavailable/invalid upstream response ->503. Requests are bounded by a 7-second timeout. The parity suite starts a local stub; CI config points Java at the same stub so no dictionary internet access is needed.

## Verification scope

135 HTTP/database differential cases are registered, plus forced concurrent-review assertions on both backends and a microsecond undo assertion. The harness restores the same isolated DB state before each backend, compares three Vocabulary tables and checks failures preserve all rows/timestamps. GET response timestamps are also checked. Generated IDs and wall-clock timestamps are normalized; calculated calendar dates remain compared. This is bounded test coverage, not proof for every possible input/timezone/upstream payload.
