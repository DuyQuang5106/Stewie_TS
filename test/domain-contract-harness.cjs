const assert = require('node:assert/strict');
module.exports = async function domainHarness({
  baseline,
  migrated,
  db,
  tables,
  prefix,
}) {
  assert.equal(
    new URL(db.options.connectionString).pathname,
    '/stiu_read_api_test',
  );
  for (const t of tables)
    assert.ok(
      [
        'vocab_playlists',
        'vocab_words',
        'vocab_reviews',
        'assessments',
        'assessment_sections',
        'assessment_modules',
        'assessment_questions',
        'assessment_assignments',
        'attempt',
        'attempt_section',
        'attempt_module',
        'attempt_question',
        'results',
      ].includes(t),
    );
  const fields = {};
  for (const t of tables)
    fields[t] = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [t],
      )
    ).rows.map((r) => r.column_name);
  async function snapshot() {
    const state = {};
    for (const t of tables)
      state[t] = (
        await db.query(`SELECT row_to_json(t) AS data FROM ${t} t ORDER BY id`)
      ).rows.map((r) => r.data);
    return state;
  }
  async function restore(state) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      for (const t of [...tables].reverse()) await c.query(`DELETE FROM ${t}`);
      for (const t of tables)
        await c.query(
          `INSERT INTO ${t}(${fields[t].join(',')}) SELECT ${fields[t].join(',')} FROM json_populate_recordset(NULL::${t},$1::json)`,
          [JSON.stringify(state[t])],
        );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  function ids(before, after) {
    const map = new Map();
    for (const t of tables) {
      const existing = new Set(before[t].map((x) => x.id));
      after[t]
        .filter((x) => !existing.has(x.id))
        .sort((a, b) =>
          String(
            a.order_index ??
              a.position ??
              a.name ??
              a.title ??
              a.student_id ??
              a.section_id ??
              a.module_id ??
              a.assessment_question_id ??
              '',
          ).localeCompare(
            String(
              b.order_index ??
                b.position ??
                b.name ??
                b.title ??
                b.student_id ??
                b.section_id ??
                b.module_id ??
                b.assessment_question_id ??
                '',
            ),
          ),
        )
        .forEach((x, i) => map.set(x.id, '<' + t + '-' + i + '>'));
    }
    return map;
  }
  function norm(v, map, key = '') {
    if (
      [
        'time_spent_seconds',
        'total_time',
        'totalTimeSeconds',
        'timeSpentSeconds',
      ].includes(key) &&
      typeof v === 'number'
    )
      return '<elapsed-seconds>';
    if (
      [
        'startedAt',
        'started_at',
        'submittedAt',
        'submitted_at',
        'completedAt',
        'completed_at',
        'serverNow',
        'last_activity_at',
        'last_viewed_at',
        'first_viewed_at',
        'time_reported_at',
        'expiresAt',
        'expires_at',
        'attemptExpiresAt',
        'activeExpiresAt',
      ].includes(key)
    )
      return v === null ? null : '<runtime-instant>';
    if (Array.isArray(v)) {
      const normalized = v.map((x) => norm(x, map));
      if (
        [
          'flaggedQuestionIds',
          'topicIds',
          'skillIds',
          'tagIds',
          'correctOptionIds',
        ].includes(key)
      )
        return normalized.sort();
      // Java builds keyed grade aggregates from an unordered repository query.
      // Their section/topic identity matters; their array position has no contract.
      if (
        normalized.every(
          (x) =>
            x &&
            typeof x === 'object' &&
            Object.hasOwn(x, 'maxPoints') &&
            (x.sectionId || x.topicId),
        )
      )
        return normalized.sort((a, b) =>
          String(a.sectionId ?? a.topicId).localeCompare(
            String(b.sectionId ?? b.topicId),
          ),
        );
      return normalized;
    }
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(
            ([k]) =>
              ![
                'timestamp',
                'createdAt',
                'updatedAt',
                'created_at',
                'updated_at',
                'reviewed_at',
                'lastReviewedAt',
                'assignedAt',
                'assigned_at',
                'resultsReleasedAt',
                'results_released_at',
              ].includes(k),
          )
          .map(([k, x]) => [k, norm(x, map, k)]),
      );
    if (map.has(v)) return map.get(v);
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(v))
      return new Date(v).toISOString();
    return v;
  }
  function stateNorm(state, map) {
    return Object.fromEntries(
      Object.entries(norm(state, map)).map(([table, rows]) => [
        table,
        rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
    );
  }
  async function request(base, method, path, body, user, timezone) {
    const response = await fetch(base + prefix + path, {
      method,
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: 'Bearer ' + user.token } : {}),
        ...(timezone ? { 'X-Timezone': timezone } : {}),
      },
      ...(body === undefined
        ? {}
        : {
            body:
              body && Object.hasOwn(body, '__rawJson')
                ? body.__rawJson
                : JSON.stringify(body),
          }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  function times(v, path = '') {
    if (Array.isArray(v))
      return v.flatMap((x, i) => times(x, path + '[' + i + ']'));
    if (v && typeof v === 'object')
      return Object.entries(v).flatMap(([k, x]) =>
        ['createdAt', 'updatedAt', 'lastReviewedAt'].includes(k)
          ? [[path + '.' + k, x === null ? null : new Date(x).toISOString()]]
          : times(x, path + '.' + k),
      );
    return [];
  }
  let count = 0;
  async function compare(method, path, body, user, expected, zone) {
    const before = await snapshot();
    const runtimeStart = Date.now();
    const a = await request(baseline, method, path, body, user, zone);
    const afterA = await snapshot();
    await restore(before);
    const b = await request(migrated, method, path, body, user, zone);
    const afterB = await snapshot();
    const label =
      method + ' ' + path + ' ' + JSON.stringify(body)?.slice(0, 120);
    const elapsedBound = Math.max(
      1,
      Math.ceil((Date.now() - runtimeStart) / 1000),
    );
    const mapA = ids(before, afterA),
      mapB = ids(before, afterB);
    for (const table of tables) {
      const mapped = new Map(
        afterA[table].map((row) => [mapA.get(row.id) ?? row.id, row]),
      );
      for (const row of afterB[table]) {
        const expected = mapped.get(mapB.get(row.id) ?? row.id);
        if (!expected) continue;
        for (const key of ['time_spent_seconds', 'total_time'])
          if (typeof row[key] === 'number' && typeof expected[key] === 'number')
            assert.ok(
              Math.abs(row[key] - expected[key]) <= elapsedBound,
              label +
                ' ' +
                table +
                '.' +
                key +
                ' must differ only by measured wall-clock interval',
            );
      }
    }
    function responseTimes(v, path = '') {
      if (Array.isArray(v))
        return v.flatMap((x, i) => responseTimes(x, path + '[' + i + ']'));
      if (v && typeof v === 'object')
        return Object.entries(v).flatMap(([k, x]) =>
          ['totalTimeSeconds', 'timeSpentSeconds'].includes(k)
            ? [[path + '.' + k, x]]
            : responseTimes(x, path + '.' + k),
        );
      return [];
    }
    const secondsA = responseTimes(a.body).sort((a, b) =>
        a[0].localeCompare(b[0]),
      ),
      secondsB = responseTimes(b.body).sort((a, b) => a[0].localeCompare(b[0]));
    if (a.status === b.status && a.status < 300) {
      assert.equal(secondsA.length, secondsB.length);
      for (let i = 0; i < secondsA.length; i++) {
        assert.equal(secondsA[i][0], secondsB[i][0]);
        assert.ok(
          Math.abs(secondsA[i][1] - secondsB[i][1]) <= elapsedBound,
          label + ' response elapsed seconds',
        );
      }
    }
    assert.equal(
      b.status,
      a.status,
      label +
        ' Java=' +
        JSON.stringify(a.body) +
        ' TS=' +
        JSON.stringify(b.body),
    );
    if (expected !== undefined) assert.equal(b.status, expected, label);
    if (method === 'GET' && b.status < 300)
      assert.deepEqual(
        times(b.body).sort((a, b) => a[0].localeCompare(b[0])),
        times(a.body).sort((a, b) => a[0].localeCompare(b[0])),
        label + ' persisted response timestamps',
      );
    assert.deepEqual(
      norm(b.body, ids(before, afterB)),
      norm(a.body, ids(before, afterA)),
      label + ' response',
    );
    assert.deepEqual(
      stateNorm(afterB, ids(before, afterB)),
      stateNorm(afterA, ids(before, afterA)),
      label + ' persisted state',
    );
    if (b.status >= 400)
      assert.deepEqual(
        afterB,
        before,
        'Failure must preserve complete database state',
      );
    count++;
    return b.body;
  }
  return {
    compare,
    request,
    snapshot,
    restore,
    get count() {
      return count;
    },
  };
};
