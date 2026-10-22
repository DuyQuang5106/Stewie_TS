const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const boundedFetch = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) });

module.exports = async function resourceWriteParity({
  baseline,
  migrated,
  identities,
  db,
}) {
  const [admin, teacher, student] = identities;
  const otherResponse = await boundedFetch(
    baseline +
      '/api/auth/dev-login?email=resources.other@stewiesat.test&role=TEACHER',
    { method: 'POST' },
  );
  assert.equal(otherResponse.status, 200);
  const otherToken = (await otherResponse.json()).accessToken;
  const other = { token: otherToken, id: jwt.decode(otherToken).sub };
  const missing = '00000000-0000-0000-0000-000000000000';
  // This suite creates no questions; its own fixtures can be removed between reruns.
  await db.query("DELETE FROM stimulus WHERE title LIKE 'Resource-%'");
  await db.query("DELETE FROM question_bank WHERE name LIKE 'Resource-%'");
  const h = await require('./write-contract-harness.cjs')({
    baseline,
    migrated,
    db,
    tables: ['stimulus', 'question_bank'],
  });
  const { compare, request } = h;
  const previous = process.env.ACADEMIC_WRITE_API_ENABLED;
  const stimulus = {
    title: 'Resource-owned',
    content: {
      text: 'Passage',
      nested: { unicode: 'Bài đọc 😀', enabled: true },
    },
    source: '  source  ',
  };
  const bank = {
    name: 'Resource-owned',
    scope: 'TEACHER',
    description: '  description  ',
  };
  try {
    process.env.ACADEMIC_WRITE_API_ENABLED = 'false';
    const before = await h.snapshot();
    for (const [path, body] of [
      ['/stimuli', stimulus],
      ['/question-banks', bank],
    ])
      assert.equal(
        (await request(migrated, 'POST', path, body, teacher)).status,
        404,
      );
    assert.deepEqual(await h.snapshot(), before);
    process.env.ACADEMIC_WRITE_API_ENABLED = 'true';
    for (const [path, body] of [
      ['/stimuli', stimulus],
      ['/question-banks', bank],
    ]) {
      await compare('POST', path, body, null, 401);
      await compare('POST', path, body, student, 403);
      await compare('POST', path, {}, student, 400);
      for (const user of [admin, student, null])
        await compare('POST', path, { __rawJson: '{' }, user, user ? 500 : 401);
      for (const body of [undefined, null, [], 42])
        await compare('POST', path, body, admin, 500);
    }
    for (const body of [
      {},
      { title: 'Good' },
      { title: ' ', content: { text: 'x' } },
      { title: 'x'.repeat(256), content: { text: 'x' } },
      {
        title: 'Resource-invalid',
        content: { text: 'x' },
        source: 'x'.repeat(1001),
      },
      { title: {}, content: { text: 'x' } },
    ]) {
      await compare(
        'POST',
        '/stimuli',
        body,
        teacher,
        typeof body.title === 'object' ? 500 : 400,
      );
    }
    for (const content of [
      null,
      {},
      [],
      'text',
      42,
      true,
      { text: 'x'.repeat(99990) },
    ])
      await compare(
        'POST',
        '/stimuli',
        { title: 'Resource-invalid', content },
        teacher,
        400,
      );
    for (const body of [
      {},
      { name: ' ', scope: 'SYSTEM' },
      { name: 'x'.repeat(256), scope: 'SYSTEM' },
      {
        name: 'Resource-invalid',
        scope: 'SYSTEM',
        description: 'x'.repeat(1001),
      },
      { name: {}, scope: 'SYSTEM' },
      { name: 'Resource-invalid', scope: 'invalid' },
      { name: 'Resource-invalid', scope: 'system' },
      { name: 'Resource-invalid', scope: 'TEACHER', ownerAccountId: 'invalid' },
    ]) {
      await compare(
        'POST',
        '/question-banks',
        body,
        admin,
        typeof body.name === 'object' ||
          ['invalid', 'system'].includes(body.scope) ||
          body.ownerAccountId === 'invalid'
          ? 500
          : 400,
      );
    }
    const own = await compare(
      'POST',
      '/stimuli',
      { ...stimulus, title: '  Resource-owned  ', ignored: 'ignored' },
      teacher,
      201,
    );
    const foreign = await compare(
      'POST',
      '/stimuli',
      { ...stimulus, title: 'Resource-foreign' },
      other,
      201,
    );
    await compare(
      'POST',
      '/stimuli',
      { title: 'Resource-max-ascii', content: { text: 'x'.repeat(99989) } },
      teacher,
      201,
    );
    await compare(
      'POST',
      '/stimuli',
      { title: 'Resource-max-unicode', content: { text: '😀'.repeat(49994) } },
      teacher,
      201,
    );
    const originalTime = (
      await db.query(
        "SELECT replace(updated_at::text,' ','T') AS time FROM stimulus WHERE id=$1",
        [own.id],
      )
    ).rows[0].time;
    const unchanged = await compare(
      'PUT',
      `/stimuli/${own.id}`,
      stimulus,
      teacher,
      200,
    );
    assert.equal(
      unchanged.updatedAt,
      originalTime,
      'No-op JSON update keeps timestamp',
    );
    for (const user of [teacher, admin, student]) {
      await compare(
        'PUT',
        `/stimuli/${missing}`,
        stimulus,
        user,
        user === student ? 403 : 404,
      );
      await compare('PUT', '/stimuli/invalid', stimulus, user, 400);
    }
    await compare('PUT', `/stimuli/${foreign.id}`, stimulus, teacher, 403);
    await compare(
      'PUT',
      `/stimuli/${own.id}`,
      { title: 'Resource-bad', content: {} },
      teacher,
      400,
    );
    for (const action of ['publish', 'archive', 'restore']) {
      await compare(
        'POST',
        `/stimuli/${foreign.id}/${action}`,
        undefined,
        teacher,
        403,
      );
      await compare(
        'POST',
        `/stimuli/${missing}/${action}`,
        undefined,
        admin,
        404,
      );
      await compare(
        'POST',
        `/stimuli/${own.id}/${action}`,
        undefined,
        student,
        403,
      );
    }
    await compare(
      'POST',
      `/stimuli/${own.id}/restore`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/publish`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'PUT',
      `/stimuli/${own.id}`,
      { title: 'Resource-rejected', content: {} },
      teacher,
      409,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/publish`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/archive`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/archive`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/publish`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/restore`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'PUT',
      `/stimuli/${own.id}`,
      { title: 'Resource-updated', content: { text: 'Updated' }, source: ' ' },
      teacher,
      200,
    );
    await compare(
      'POST',
      `/stimuli/${foreign.id}/publish`,
      undefined,
      admin,
      200,
    );
    // Admin may manage a legacy stimulus without a creator; teachers may not.
    await db.query('UPDATE stimulus SET created_by=NULL WHERE id=$1', [own.id]);
    await compare('PUT', `/stimuli/${own.id}`, stimulus, teacher, 403);
    await compare('PUT', `/stimuli/${own.id}`, stimulus, admin, 200);
    // Publish revalidates persisted content (including legacy invalid data).
    await db.query("UPDATE stimulus SET content='{}'::jsonb WHERE id=$1", [
      own.id,
    ]);
    await compare('POST', `/stimuli/${own.id}/publish`, undefined, admin, 400);
    await compare('PUT', `/stimuli/${own.id}`, stimulus, admin, 200);
    await compare(
      'POST',
      `/stimuli/${own.id}/publish`,
      { __rawJson: '{' },
      student,
      403,
    );
    await compare(
      'POST',
      `/stimuli/${own.id}/publish`,
      { __rawJson: '{' },
      null,
      401,
    );
    for (const action of ['publish', 'archive', 'restore'])
      await compare(
        'POST',
        `/stimuli/${own.id}/${action}`,
        { __rawJson: '{' },
        admin,
        200,
      );

    await compare(
      'POST',
      '/question-banks',
      { ...bank, scope: 'SYSTEM' },
      teacher,
      403,
    );
    await compare(
      'POST',
      '/question-banks',
      { ...bank, ownerAccountId: other.id },
      teacher,
      403,
    );
    await compare('POST', '/question-banks', bank, admin, 400);
    await compare(
      'POST',
      '/question-banks',
      { ...bank, scope: 'SYSTEM', ownerAccountId: teacher.id },
      admin,
      400,
    );
    await compare(
      'POST',
      '/question-banks',
      { ...bank, ownerAccountId: missing },
      admin,
      404,
    );
    await compare(
      'POST',
      '/question-banks',
      { ...bank, ownerAccountId: student.id },
      admin,
      400,
    );
    const owned = await compare(
      'POST',
      '/question-banks',
      { ...bank, ignored: 'ignored' },
      teacher,
      201,
    );
    const second = await compare(
      'POST',
      '/question-banks',
      { ...bank, name: 'Resource-second', ownerAccountId: teacher.id },
      admin,
      201,
    );
    const system = await compare(
      'POST',
      '/question-banks',
      { ...bank, scope: 'SYSTEM' },
      admin,
      201,
    );
    const otherBank = await compare(
      'POST',
      '/question-banks',
      bank,
      other,
      201,
    );
    await compare(
      'POST',
      '/question-banks',
      { ...bank, name: 'resource-OWNED' },
      teacher,
      409,
    );
    await compare(
      'POST',
      '/question-banks',
      { ...bank, name: 'resource-OWNED', scope: 'SYSTEM' },
      admin,
      409,
    );
    const noOp = await compare(
      'PUT',
      `/question-banks/${owned.id}`,
      {
        name: bank.name,
        description: 'description',
        scope: 'SYSTEM',
        ownerAccountId: other.id,
      },
      teacher,
      200,
    );
    assert.equal(noOp.updatedAt, owned.updatedAt);
    assert.equal(noOp.ownerAccountId, teacher.id);
    await compare(
      'PUT',
      `/question-banks/${second.id}`,
      { name: bank.name },
      teacher,
      409,
    );
    for (const user of [teacher, admin, student]) {
      await compare(
        'PUT',
        `/question-banks/${missing}`,
        { name: 'Resource-missing' },
        user,
        user === student ? 403 : 404,
      );
      await compare(
        'PUT',
        '/question-banks/invalid',
        { name: 'Resource-invalid' },
        user,
        400,
      );
    }
    await compare(
      'PUT',
      `/question-banks/${otherBank.id}`,
      { name: 'Resource-stolen' },
      teacher,
      403,
    );
    await compare(
      'PUT',
      `/question-banks/${system.id}`,
      { name: 'Resource-stolen' },
      teacher,
      403,
    );
    await compare(
      'PUT',
      `/question-banks/${owned.id}`,
      { name: 'Resource-updated', description: ' ' },
      teacher,
      200,
    );
    for (const action of ['archive', 'restore']) {
      await compare(
        'POST',
        `/question-banks/${otherBank.id}/${action}`,
        undefined,
        teacher,
        403,
      );
      await compare(
        'POST',
        `/question-banks/${system.id}/${action}`,
        undefined,
        teacher,
        403,
      );
      await compare(
        'POST',
        `/question-banks/${missing}/${action}`,
        undefined,
        teacher,
        404,
      );
      await compare(
        'POST',
        `/question-banks/${owned.id}/${action}`,
        undefined,
        student,
        403,
      );
    }
    await compare(
      'POST',
      `/question-banks/${owned.id}/restore`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/question-banks/${owned.id}/archive`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'POST',
      `/question-banks/${owned.id}/archive`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'PUT',
      `/question-banks/${owned.id}`,
      { name: 'Resource-update-archived' },
      teacher,
      409,
    );
    await compare(
      'POST',
      '/question-banks',
      { name: 'Resource-updated', scope: 'TEACHER' },
      teacher,
      409,
    );
    await compare(
      'POST',
      `/question-banks/${owned.id}/restore`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'POST',
      `/question-banks/${owned.id}/restore`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/question-banks/${system.id}/archive`,
      undefined,
      admin,
      200,
    );
    await compare(
      'POST',
      `/question-banks/${system.id}/restore`,
      undefined,
      admin,
      200,
    );
    for (const action of ['archive', 'restore'])
      await compare(
        'POST',
        `/question-banks/${system.id}/${action}`,
        { __rawJson: '{' },
        admin,
        200,
      );
    await db.query('UPDATE question_bank SET deleted_at=NOW() WHERE id=$1', [
      owned.id,
    ]);
    await compare(
      'PUT',
      `/question-banks/${owned.id}`,
      { name: 'Resource-deleted' },
      admin,
      404,
    );
    await compare(
      'POST',
      `/question-banks/${owned.id}/archive`,
      undefined,
      admin,
      404,
    );
    await compare(
      'POST',
      `/question-banks/${owned.id}/restore`,
      undefined,
      admin,
      404,
    );
    // Existing SQL unique indexes include soft-deleted banks, unlike JPA existence checks.
    await compare(
      'POST',
      '/question-banks',
      { name: 'Resource-updated', scope: 'TEACHER' },
      teacher,
      409,
    );
    await db.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [other.id]);
    await compare(
      'POST',
      '/question-banks',
      {
        name: 'Resource-deleted-owner',
        scope: 'TEACHER',
        ownerAccountId: other.id,
      },
      admin,
      404,
    );
    await db.query('UPDATE users SET deleted_at=NULL WHERE id=$1', [other.id]);
    for (const scope of [0, 1, ' SYSTEM ', '', ' ']) {
      await compare(
        'POST',
        '/question-banks',
        {
          name: `Resource-scope-${JSON.stringify(scope)}`,
          scope,
          ownerAccountId: scope === 1 ? teacher.id : null,
        },
        admin,
      );
    }
    for (const ownerAccountId of ['', ' ', '1-1-1-1-1'])
      await compare(
        'POST',
        '/question-banks',
        { name: 'Resource-owner-edge', scope: 'TEACHER', ownerAccountId },
        admin,
      );
    // Concurrent duplicate creation must be rejected by the database constraint as well as the precheck.
    for (const [scope, user, ownerAccountId] of [
      ['SYSTEM', admin, null],
      ['TEACHER', teacher, teacher.id],
    ]) {
      const body = { name: `Resource-race-${scope}`, scope, ownerAccountId };
      const responses = await Promise.all([
        request(migrated, 'POST', '/question-banks', body, user),
        request(migrated, 'POST', '/question-banks', body, user),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal(
        (
          await db.query('SELECT count(*) FROM question_bank WHERE name=$1', [
            body.name,
          ])
        ).rows[0].count,
        '1',
      );
    }
    // Hold a row lock so both updates read the same version before either may commit.
    const target = system.id;
    for (const base of [baseline, migrated]) {
      const blocker = await db.connect();
      const versionBefore = (
        await db.query('SELECT version FROM question_bank WHERE id=$1', [
          target,
        ])
      ).rows[0].version;
      const pending = [];
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT id FROM question_bank WHERE id=$1 FOR UPDATE',
          [target],
        );
        for (const name of ['Resource-race-update-a', 'Resource-race-update-b'])
          pending.push(
            request(base, 'PUT', `/question-banks/${target}`, { name }, admin),
          );
        let waiting = false;
        const deadline = Date.now() + 1800;
        while (Date.now() < deadline) {
          const locks = await db.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE 'update question_bank%'",
          );
          if (locks.rows[0].n >= 2) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        await blocker.query('COMMIT');
        const responses = await Promise.all(pending);
        assert.ok(waiting, 'Both writes must reach the same-version update');
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const rejected = responses.find((r) => r.status === 409);
        assert.equal(rejected.body.error, 'Conflict');
        assert.match(rejected.body.message, /khác/);
        const after = (
          await db.query('SELECT version,name FROM question_bank WHERE id=$1', [
            target,
          ])
        ).rows[0];
        assert.equal(Number(after.version), Number(versionBefore) + 1);
        assert.ok(
          ['Resource-race-update-a', 'Resource-race-update-b'].includes(
            after.name,
          ),
        );
        await db.query('UPDATE question_bank SET name=$2 WHERE id=$1', [
          target,
          'Resource-owned',
        ]);
      } finally {
        await blocker.query('ROLLBACK');
        await Promise.allSettled(pending);
        blocker.release();
      }
    }
    return h.count;
  } finally {
    if (previous === undefined) delete process.env.ACADEMIC_WRITE_API_ENABLED;
    else process.env.ACADEMIC_WRITE_API_ENABLED = previous;
  }
};
