const assert = require('node:assert/strict');
const boundedFetch = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) });

module.exports = async function writeHarness({
  baseline,
  migrated,
  db,
  tables,
}) {
  assert.equal(
    new URL(db.options.connectionString).pathname,
    '/stiu_read_api_test',
  );
  const fields = {};
  for (const table of tables) {
    assert.ok(['stimulus', 'question_bank'].includes(table));
    fields[table] = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [table],
      )
    ).rows.map((r) => r.column_name);
  }
  let count = 0;
  async function snapshot() {
    const result = {};
    for (const table of tables)
      result[table] = (
        await db.query(
          `SELECT row_to_json(t) AS data FROM ${table} t ORDER BY id`,
        )
      ).rows.map((r) => r.data);
    return result;
  }
  async function restore(before) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const table of tables) {
        await client.query(
          `DELETE FROM ${table} WHERE NOT(id = ANY($1::uuid[]))`,
          [before[table].map((r) => r.id)],
        );
        const columns = fields[table];
        await client.query(
          `INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.join(',')} FROM json_populate_recordset(NULL::${table},$1::json)
          ON CONFLICT(id) DO UPDATE SET ${columns
            .filter((c) => c !== 'id')
            .map((c) => `${c}=EXCLUDED.${c}`)
            .join(',')}`,
          [JSON.stringify(before[table])],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  function normalize(value, id) {
    if (Array.isArray(value)) return value.map((v) => normalize(v, id));
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
              ].includes(k),
          )
          .map(([k, v]) => [k, normalize(v, id)]),
      );
    return id && value === id ? '<created-id>' : value;
  }
  function normalizedState(rows, id) {
    return Object.fromEntries(
      tables.map((table) => [
        table,
        rows[table]
          .map((r) => normalize(r, id))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ]),
    );
  }
  async function request(base, method, path, body, user) {
    const response = await boundedFetch(base + '/api/academic' + path, {
      method,
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
  const canonicalTime = (v) =>
    v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  async function compare(method, path, body, user, expectedStatus) {
    const before = await snapshot();
    const a = await request(baseline, method, path, body, user);
    const afterJava = await snapshot();
    await restore(before);
    const b = await request(migrated, method, path, body, user);
    const afterTs = await snapshot();
    const label = `${method} ${path} ${JSON.stringify(body)?.slice(0, 300)}`;
    assert.equal(
      b.status,
      a.status,
      `${label}: Java=${JSON.stringify(a.body)} TS=${JSON.stringify(b.body)}`,
    );
    if (expectedStatus !== undefined)
      assert.equal(b.status, expectedStatus, label);
    if (a.status < 300 && a.body)
      for (const field of ['createdAt', 'updatedAt'])
        assert.equal(
          b.body[field] === null,
          a.body[field] === null,
          `${label} ${field} nullability`,
        );
    const javaId = a.status === 201 ? a.body.id : undefined;
    const tsId = b.status === 201 ? b.body.id : undefined;
    assert.deepEqual(
      normalize(b.body, tsId),
      normalize(a.body, javaId),
      `${label} response`,
    );
    assert.deepEqual(
      normalizedState(afterTs, tsId),
      normalizedState(afterJava, javaId),
      `${label} state`,
    );
    if (b.status >= 400)
      assert.deepEqual(afterTs, before, `${label} failure must not write`);
    if (b.status < 300 && b.body) {
      const table = path.startsWith('/stimuli') ? 'stimulus' : 'question_bank';
      const row = afterTs[table].find((r) => r.id === b.body.id);
      const beforeRow = before[table].find((r) => r.id === b.body.id);
      const lateFlush =
        table === 'stimulus' || /\/(archive|restore)$/.test(path);
      for (const [api, column] of [
        ['createdAt', 'created_at'],
        ['updatedAt', 'updated_at'],
      ]) {
        if (b.body[api] === null) {
          assert.ok(row[column], 'Flush must persist the timestamp');
          continue;
        }
        assert.match(b.body[api], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/);
        assert.equal(
          canonicalTime(b.body[api]),
          canonicalTime(
            lateFlush && beforeRow ? beforeRow[column] : row[column],
          ),
          'API timestamp matches Java flush timing',
        );
      }
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
