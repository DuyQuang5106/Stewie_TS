const boundedFetch = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const assert = require('node:assert/strict');

module.exports = async function catalogWriteParity({
  baseline,
  migrated,
  identities,
  db,
  app,
  DatabaseService,
}) {
  const [admin, teacher, student] = identities;
  const headers = (user) =>
    user ? { Authorization: `Bearer ${user.token}` } : {};
  const root = '/api/academic';
  const missing = '00000000-0000-0000-0000-000000000000';
  const tables = ['topic', 'skill', 'tag_group', 'tag'];
  const columns = {
    topic: ['id', 'name', 'slug', 'status', 'created_at', 'updated_at'],
    skill: ['id', 'name', 'slug', 'status', 'created_at', 'updated_at'],
    tag_group: ['id', 'name', 'code', 'created_at', 'updated_at'],
    tag: ['id', 'name', 'slug', 'tag_group_id', 'created_at', 'updated_at'],
  };
  let compared = 0;
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
      for (const table of ['tag', 'tag_group', 'topic', 'skill']) {
        await client.query(
          `DELETE FROM ${table} WHERE NOT (id = ANY($1::uuid[]))`,
          [before[table].map((r) => r.id)],
        );
      }
      for (const table of ['topic', 'skill', 'tag_group', 'tag']) {
        const fields = columns[table];
        await client.query(
          `INSERT INTO ${table} (${fields.join(',')}) SELECT ${fields.join(',')} FROM json_populate_recordset(NULL::${table}, $1::json)
          ON CONFLICT (id) DO UPDATE SET ${fields
            .filter((f) => f !== 'id')
            .map((f) => `${f} = EXCLUDED.${f}`)
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
  function normalize(value, generatedId) {
    if (Array.isArray(value))
      return value.map((v) => normalize(v, generatedId));
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
          .map(([k, v]) => [k, normalize(v, generatedId)]),
      );
    return generatedId && value === generatedId ? '<generated-id>' : value;
  }
  function state(before, generatedId) {
    return Object.fromEntries(
      tables.map((table) => [
        table,
        before[table]
          .map((r) => normalize(r, generatedId))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ]),
    );
  }
  const canonicalTime = (value) =>
    value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  async function request(base, method, path, body, user) {
    const response = await boundedFetch(base + root + path, {
      method,
      headers: { ...headers(user), 'Content-Type': 'application/json' },
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
  async function compare(method, path, body, user = admin, expectedStatus) {
    const before = await snapshot();
    const a = await request(baseline, method, path, body, user);
    const afterJava = await snapshot();
    await restore(before);
    const b = await request(migrated, method, path, body, user);
    const afterTs = await snapshot();
    assert.equal(
      b.status,
      a.status,
      `${method} ${path} ${JSON.stringify(body)} status; ${JSON.stringify(a.body)} vs ${JSON.stringify(b.body)}`,
    );
    if (expectedStatus !== undefined)
      assert.equal(b.status, expectedStatus, `${method} ${path}`);
    const generatedJava = a.status === 201 ? a.body.id : undefined;
    const generatedTs = b.status === 201 ? b.body.id : undefined;
    if (generatedTs) assert.match(generatedTs, /^[0-9a-f-]{36}$/);
    // Hibernate exposes the first Set violation when both @NotBlank and @Pattern fail.
    // That order varies across JVMs; both concrete messages remain constrained here.
    if (
      a.status === 400 &&
      b.status === 400 &&
      typeof body?.slug === 'string' &&
      !body.slug.trim()
    ) {
      for (const response of [a, b]) {
        assert.ok(
          [
            'must not be blank',
            'slug ch\u1ec9 g\u1ed3m ch\u1eef th\u01b0\u1eddng, s\u1ed1 v\u00e0 d\u1ea5u g\u1ea1ch ngang',
          ].includes(response.body.fieldErrors.slug),
        );
        response.body.fieldErrors.slug = '<NotBlank-or-Pattern>';
      }
    }
    assert.deepEqual(
      normalize(b.body, generatedTs),
      normalize(a.body, generatedJava),
      `${method} ${path} body`,
    );
    assert.deepEqual(
      state(afterTs, generatedTs),
      state(afterJava, generatedJava),
      `${method} ${path} persisted changes`,
    );
    if (b.status >= 400)
      assert.deepEqual(
        afterTs,
        before,
        `${method} ${path} must not mutate state on failure`,
      );
    if (b.status < 300 && b.body) {
      const table = path.startsWith('/topics')
        ? 'topic'
        : path.startsWith('/skills')
          ? 'skill'
          : path.startsWith('/tag-groups')
            ? 'tag_group'
            : 'tag';
      const row = afterTs[table].find((r) => r.id === b.body.id);
      for (const [api, column] of [
        ['createdAt', 'created_at'],
        ['updatedAt', 'updated_at'],
      ]) {
        assert.match(b.body[api], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/);
        assert.equal(
          canonicalTime(b.body[api]),
          canonicalTime(row[column]),
          `${api} must match stored local timestamp`,
        );
      }
    }
    compared++;
    return b.body;
  }
  const flagBefore = process.env.ACADEMIC_WRITE_API_ENABLED;
  try {
    // Only this suite's catalog fixtures, inside the DB-name-checked disposable DB.
    await db.query(
      "DELETE FROM tag WHERE slug IN ('catalog-tag','new-catalog-tag','cascade-a','cascade-b','rollback-child')",
    );
    await db.query(
      "DELETE FROM tag_group WHERE code IN ('CATALOG_GROUP','OTHER_CATALOG','UPDATED_CATALOG','WITH_TAGS','RACE_CATALOG')",
    );
    for (const table of ['topic', 'skill'])
      await db.query(
        `DELETE FROM ${table} WHERE slug LIKE 'catalog-%' OR slug IN ('race-catalog','rollback-probe')`,
      );
    process.env.ACADEMIC_WRITE_API_ENABLED = 'false';
    const before = await snapshot();
    assert.equal(
      (
        await request(
          migrated,
          'POST',
          '/topics',
          { name: 'Disabled', slug: 'disabled' },
          admin,
        )
      ).status,
      404,
    );
    await assert.rejects(
      app
        .get(DatabaseService)
        .writeTransaction((c) =>
          c.query(
            "INSERT INTO topic(id,name,slug,status) VALUES(gen_random_uuid(),'Disabled','disabled','ACTIVE')",
          ),
        ),
      /disabled/,
    );
    assert.deepEqual(await snapshot(), before);
    process.env.ACADEMIC_WRITE_API_ENABLED = 'true';
    for (const resource of ['topics', 'skills']) {
      const valid = { name: '  Catalog name  ', slug: `catalog-${resource}` };
      for (const user of [null, teacher, student])
        await compare('POST', `/${resource}`, valid, user, user ? 403 : 401);
      for (const body of [
        {},
        { name: 'Good' },
        { name: ' ', slug: 'good' },
        { name: 'x'.repeat(101), slug: 'good' },
        { name: 'Good', slug: 'UPPER' },
        { name: 'Good', slug: 'a'.repeat(101) },
        { name: {}, slug: 'good' },
        null,
        { name: 'Good', slug: '' },
        { name: 'Good', slug: ' ' },
      ]) {
        await compare(
          'POST',
          `/${resource}`,
          body,
          admin,
          body === null || typeof body.name === 'object' ? 500 : 400,
        );
      }
      // MVC validation occurs before method-level role enforcement.
      await compare('POST', `/${resource}`, {}, teacher, 400);
      const item = await compare(
        'POST',
        `/${resource}`,
        { ...valid, ignored: 'Java ignores unknown fields' },
        admin,
        201,
      );
      await compare('POST', `/${resource}`, valid, admin, 409);
      await compare('PUT', `/${resource}/${missing}`, valid, admin, 404);
      await compare('PUT', `/${resource}/invalid`, valid, admin, 400);
      await compare('PUT', `/${resource}/${item.id}`, valid, teacher, 403);
      await compare('PUT', `/${resource}/${item.id}`, {}, admin, 400);
      const unchanged = await compare(
        'PUT',
        `/${resource}/${item.id}`,
        valid,
        admin,
        200,
      );
      assert.equal(
        unchanged.updatedAt,
        item.updatedAt,
        'No-op update keeps Hibernate timestamp',
      );
      const second = await compare(
        'POST',
        `/${resource}`,
        { name: 'Second', slug: `catalog-second-${resource}` },
        admin,
        201,
      );
      await compare('PUT', `/${resource}/${second.id}`, valid, admin, 409);
      await compare(
        'PUT',
        `/${resource}/${item.id}`,
        { name: 'Renamed', slug: `catalog-renamed-${resource}` },
        admin,
        200,
      );
      await compare('POST', `/${resource}/${item.id}/restore`, {}, admin, 409);
      await compare(
        'POST',
        `/${resource}/${item.id}/archive`,
        {},
        teacher,
        403,
      );
      await compare('POST', `/${resource}/${missing}/archive`, {}, admin, 404);
      await compare('POST', `/${resource}/${item.id}/archive`, {}, admin, 200);
      await compare('POST', `/${resource}/${item.id}/archive`, {}, admin, 409);
      await compare('PUT', `/${resource}/${item.id}`, valid, admin, 409);
      await compare('POST', `/${resource}/${item.id}/restore`, {}, admin, 200);
      await compare('POST', `/${resource}/${item.id}/restore`, {}, admin, 409);
    }
    for (const user of [admin, teacher, student, null])
      await compare(
        'POST',
        '/topics',
        { __rawJson: '{' },
        user,
        user ? 500 : 401,
      );
    for (const body of [undefined, 42, true, []])
      await compare('POST', '/topics', body, admin, 500);
    const groupBody = { name: '  Catalog group  ', code: 'Catalog_group' };
    for (const user of [null, teacher, student])
      await compare('POST', '/tag-groups', groupBody, user, user ? 403 : 401);
    for (const body of [
      {},
      { name: 'Good' },
      { name: ' ', code: 'VALID' },
      { name: 'x'.repeat(51), code: 'VALID' },
      { name: 'Good', code: 'bad code' },
      { name: 'Good', code: 'x'.repeat(51) },
    ])
      await compare('POST', '/tag-groups', body, admin, 400);
    const group = await compare('POST', '/tag-groups', groupBody, admin, 201);
    await compare(
      'POST',
      '/tag-groups',
      { ...groupBody, code: 'catalog_GROUP' },
      admin,
      409,
    );
    await compare('PUT', `/tag-groups/${group.id}`, groupBody, teacher, 403);
    await compare('PUT', `/tag-groups/${missing}`, groupBody, admin, 404);
    await compare('PUT', '/tag-groups/invalid', groupBody, admin, 400);
    const otherGroup = await compare(
      'POST',
      '/tag-groups',
      { name: 'Other', code: 'OTHER_CATALOG' },
      admin,
      201,
    );
    await compare('PUT', `/tag-groups/${otherGroup.id}`, groupBody, admin, 409);
    await compare(
      'PUT',
      `/tag-groups/${group.id}`,
      { name: 'Updated', code: 'Updated_catalog' },
      admin,
      200,
    );
    const tagBody = {
      name: '  Catalog tag  ',
      slug: 'catalog-tag',
      tagGroupId: group.id,
    };
    for (const user of [null, teacher, student])
      await compare('POST', '/tags', tagBody, user, user ? 403 : 401);
    for (const body of [
      {},
      { name: 'Good', slug: 'good' },
      { ...tagBody, tagGroupId: 'invalid' },
      { ...tagBody, name: ' ' },
      { ...tagBody, name: 'x'.repeat(101) },
      { ...tagBody, slug: 'UPPER' },
      { ...tagBody, slug: 'x'.repeat(101) },
    ])
      await compare(
        'POST',
        '/tags',
        body,
        admin,
        body.tagGroupId === 'invalid' ? 500 : 400,
      );
    await compare(
      'POST',
      '/tags',
      { ...tagBody, tagGroupId: missing },
      admin,
      404,
    );
    const tag = await compare('POST', '/tags', tagBody, admin, 201);
    await compare('POST', '/tags', tagBody, admin, 409);
    await compare('PUT', `/tags/${tag.id}`, tagBody, teacher, 403);
    await compare('PUT', `/tags/${missing}`, tagBody, admin, 404);
    await compare('PUT', '/tags/invalid', tagBody, admin, 400);
    await compare(
      'PUT',
      `/tags/${tag.id}`,
      { name: 'New tag', slug: 'new-catalog-tag', tagGroupId: otherGroup.id },
      admin,
      200,
    );
    await compare(
      'PUT',
      `/tag-groups/${group.id}`,
      { name: 'With tags', code: 'WITH_TAGS' },
      admin,
      200,
    );
    for (const [resource, id] of [
      ['tags', tag.id],
      ['tag-groups', group.id],
    ]) {
      await compare('DELETE', `/${resource}/${id}`, undefined, teacher, 403);
      await compare('DELETE', `/${resource}/${missing}`, undefined, admin, 404);
      await compare('DELETE', `/${resource}/invalid`, undefined, admin, 400);
    }
    await compare('DELETE', `/tags/${tag.id}`, undefined, admin, 204);
    await compare('DELETE', `/tags/${tag.id}`, undefined, admin, 404);
    await compare(
      'POST',
      '/tags',
      { ...tagBody, slug: 'cascade-a' },
      admin,
      201,
    );
    await compare(
      'POST',
      '/tags',
      { ...tagBody, slug: 'cascade-b' },
      admin,
      201,
    );
    await compare('DELETE', `/tag-groups/${group.id}`, undefined, admin, 204);
    assert.equal(
      (
        await db.query('SELECT count(*) FROM tag WHERE tag_group_id = $1', [
          group.id,
        ])
      ).rows[0].count,
      '0',
    );
    const used = (
      await db.query(
        'SELECT t.id, t.tag_group_id FROM tag t JOIN question_tag qt ON qt.tag_id = t.id LIMIT 1',
      )
    ).rows[0];
    assert.ok(used, 'Existing Java fixtures must include a referenced tag');
    await compare('DELETE', `/tags/${used.id}`, undefined, admin, 409);
    await compare(
      'POST',
      '/tags',
      {
        name: 'Rollback child',
        slug: 'rollback-child',
        tagGroupId: used.tag_group_id,
      },
      admin,
      201,
    );
    await compare(
      'DELETE',
      `/tag-groups/${used.tag_group_id}`,
      undefined,
      admin,
      409,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM tag WHERE slug = 'rollback-child'"))
        .rows[0].count,
      '1',
      'Cascade failure rolls back previously deleted child',
    );
    const rollbackBefore = await snapshot();
    await assert.rejects(
      app.get(DatabaseService).writeTransaction(async (client) => {
        await client.query(
          "INSERT INTO topic(id,name,slug,status) VALUES(gen_random_uuid(),'Rollback','rollback-probe','ACTIVE')",
        );
        throw new Error('rollback probe');
      }),
      /rollback probe/,
    );
    assert.deepEqual(await snapshot(), rollbackBefore);
    for (const resource of ['topics', 'tag-groups']) {
      const body =
        resource === 'topics'
          ? { name: 'Race', slug: 'race-catalog' }
          : { name: 'Race', code: 'RACE_CATALOG' };
      const responses = await Promise.all([
        request(migrated, 'POST', `/${resource}`, body, admin),
        request(migrated, 'POST', `/${resource}`, body, admin),
      ]);
      assert.deepEqual(
        responses.map((r) => r.status).sort(),
        [201, 409],
        'Concurrent duplicate must create exactly one row',
      );
      const field = resource === 'topics' ? 'slug' : 'code';
      const table = resource === 'topics' ? 'topic' : 'tag_group';
      assert.equal(
        (
          await db.query(`SELECT count(*) FROM ${table} WHERE ${field} = $1`, [
            body[field],
          ])
        ).rows[0].count,
        '1',
      );
    }
    return compared;
  } finally {
    if (flagBefore === undefined) delete process.env.ACADEMIC_WRITE_API_ENABLED;
    else process.env.ACADEMIC_WRITE_API_ENABLED = flagBefore;
  }
};
