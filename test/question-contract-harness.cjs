const assert = require('node:assert/strict');
module.exports = async function questionHarness({
  baseline,
  migrated,
  db,
  workflow = false,
}) {
  assert.equal(
    new URL(db.options.connectionString).pathname,
    '/stiu_read_api_test',
  );
  const tables = [
    'question',
    'question_answer',
    'question_version',
    'question_ownership_audit',
    'question_tag',
    'question_topic',
    'question_skill',
    ...(workflow ? ['question_quality_review', 'question_import_batch'] : []),
  ];
  const joinTables = ['question_tag', 'question_topic', 'question_skill'];
  const columns = {};
  for (const table of tables)
    columns[table] = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [table],
      )
    ).rows.map((r) => r.column_name);
  async function snapshot() {
    const state = {};
    for (const table of tables)
      state[table] = (
        await db.query(`SELECT row_to_json(t) AS data FROM ${table} t`)
      ).rows.map((r) => r.data);
    return state;
  }
  async function restore(state) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        'UPDATE question SET current_version_id=NULL WHERE current_version_id IS NOT NULL',
      );
      for (const table of joinTables) await c.query(`DELETE FROM ${table}`);
      for (const table of [
        ...(workflow
          ? ['question_quality_review', 'question_import_batch']
          : []),
        'question_ownership_audit',
        'question_answer',
        'question_version',
        'question',
      ]) {
        const key = table === 'question_answer' ? 'question_id' : 'id';
        await c.query(
          `DELETE FROM ${table} WHERE NOT(${key}=ANY($1::uuid[]))`,
          [state[table].map((r) => r[key])],
        );
      }
      for (const table of [
        'question',
        'question_answer',
        'question_version',
        'question_ownership_audit',
        ...joinTables,
        ...(workflow
          ? ['question_quality_review', 'question_import_batch']
          : []),
      ]) {
        const fields = columns[table];
        const key = table === 'question_answer' ? 'question_id' : 'id';
        await c.query(
          `INSERT INTO ${table}(${fields.join(',')}) SELECT ${fields.join(',')} FROM json_populate_recordset(NULL::${table},$1::json)
          ${
            joinTables.includes(table)
              ? ''
              : `ON CONFLICT(${key}) DO UPDATE SET ${fields
                  .filter((f) => f !== key)
                  .map((f) => `${f}=EXCLUDED.${f}`)
                  .join(',')}`
          }`,
          [JSON.stringify(state[table])],
        );
      }
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }
  function newIds(before, after) {
    const map = new Map();
    for (const table of [
      'question',
      'question_version',
      'question_ownership_audit',
      ...(workflow ? ['question_quality_review', 'question_import_batch'] : []),
    ]) {
      const old = new Set(before[table].map((r) => r.id));
      const created = after[table].filter((r) => !old.has(r.id));
      if (!workflow)
        assert.ok(
          created.length <= 1,
          'One aggregate mutation creates at most one record per generated-ID table',
        );
      if (workflow && table === 'question') {
        const batches = after.question_import_batch ?? [];
        const ordered = batches.flatMap((b) => b.created_question_ids ?? []);
        created.sort((a, b) => ordered.indexOf(a.id) - ordered.indexOf(b.id));
      }
      created.forEach((row, i) => map.set(row.id, `<generated-${table}-${i}>`));
    }
    return map;
  }
  function normalize(value, ids, key = '') {
    if (Array.isArray(value)) {
      const normalized = value.map((v) => normalize(v, ids));
      return ['topicIds', 'skillIds', 'tagIds', 'correctOptionIds'].includes(
        key,
      )
        ? normalized.sort()
        : normalized;
    }
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([k]) =>
              ![
                'timestamp',
                'createdAt',
                'updatedAt',
                'created_at',
                'updated_at',
                'publishedAt',
                'published_at',
                'changed_at',
                'exportedAt',
                'committedAt',
                'committed_at',
              ].includes(k),
          )
          .map(([k, v]) => [k, normalize(v, ids, k)]),
      );
    return ids.has(value) ? ids.get(value) : value;
  }
  function normalizedState(state, ids) {
    return Object.fromEntries(
      tables.map((t) => [
        t,
        state[t]
          .map((r) => normalize(r, ids))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
    );
  }
  async function request(base, method, path, body, user) {
    const response = await fetch(base + '/api/academic' + path, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
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
  const time = (v) => v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  let count = 0;
  async function compare(method, path, body, user, expected) {
    const before = await snapshot();
    const a = await request(baseline, method, path, body, user);
    const afterJava = await snapshot();
    await restore(before);
    const b = await request(migrated, method, path, body, user);
    const afterTs = await snapshot();
    const label = `${method} ${path} ${JSON.stringify(body)?.slice(0, 160)}`;
    assert.equal(
      b.status,
      a.status,
      `${label} Java=${JSON.stringify(a.body)} TS=${JSON.stringify(b.body)}`,
    );
    if (expected !== undefined) assert.equal(b.status, expected, label);
    assert.deepEqual(
      normalize(b.body, newIds(before, afterTs)),
      normalize(a.body, newIds(before, afterJava)),
      `${label} response`,
    );
    assert.deepEqual(
      normalizedState(afterTs, newIds(before, afterTs)),
      normalizedState(afterJava, newIds(before, afterJava)),
      `${label} database state`,
    );
    if (b.status >= 400) {
      const ordered = (value) =>
        Object.fromEntries(
          tables.map((t) => [
            t,
            [...value[t]].sort((a, b) =>
              JSON.stringify(a).localeCompare(JSON.stringify(b)),
            ),
          ]),
        );
      assert.deepEqual(
        ordered(afterTs),
        ordered(before),
        'Failed mutation leaves aggregate and timestamps unchanged',
      );
    }
    if (b.status < 300 && !Array.isArray(b.body)) {
      const table = !workflow
        ? 'question'
        : path.startsWith('/question-imports')
          ? 'question_import_batch'
          : path.includes('/reviews')
            ? 'question_quality_review'
            : null;
      if (table) {
        const row = afterTs[table].find((q) => q.id === b.body.id);
        for (const [api, column] of [
          ['createdAt', 'created_at'],
          ['updatedAt', 'updated_at'],
          ['committedAt', 'committed_at'],
        ]) {
          if (!(api in b.body)) continue;
          assert.equal(b.body[api] === null, a.body[api] === null);
          if (b.body[api] !== null)
            assert.equal(time(b.body[api]), time(row[column]));
        }
      } else assert.match(b.body.exportedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    }
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
