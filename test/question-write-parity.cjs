const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
module.exports = async function questionWrites({
  baseline,
  migrated,
  identities,
  db,
  app,
  DatabaseService,
}) {
  const [admin, teacher, student] = identities;
  const suffix = Date.now();
  const h = await require('./question-contract-harness.cjs')({
    baseline,
    migrated,
    db,
  });
  const { compare, request } = h;
  const login = await fetch(
    baseline +
      '/api/auth/dev-login?email=question.other@stewiesat.test&role=TEACHER',
    { method: 'POST', signal: AbortSignal.timeout(15000) },
  );
  assert.equal(login.status, 200);
  const token = (await login.json()).accessToken;
  const other = { token, id: jwt.decode(token).sub };
  const missing = '00000000-0000-0000-0000-000000000000';
  async function fixture(path, body, user = admin) {
    const result = await request(baseline, 'POST', path, body, user);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  }
  const bank = await fixture(
    '/question-banks',
    { name: 'QWrite-owned-' + suffix, scope: 'TEACHER' },
    teacher,
  );
  const system = await fixture('/question-banks', {
    name: 'QWrite-system-' + suffix,
    scope: 'SYSTEM',
  });
  const foreign = await fixture(
    '/question-banks',
    { name: 'QWrite-other-' + suffix, scope: 'TEACHER' },
    other,
  );
  const passage = await fixture(
    '/stimuli',
    {
      title: 'QWrite-passage',
      content: { text: 'Original passage' },
      source: 'Original source',
    },
    teacher,
  );
  const foreignPassage = await fixture(
    '/stimuli',
    { title: 'QWrite-foreign', content: { text: 'Foreign' } },
    other,
  );
  const topic = await fixture('/topics', {
    name: 'QWrite-topic',
    slug: 'qwrite-topic-' + suffix,
  });
  const skill = await fixture('/skills', {
    name: 'QWrite-skill',
    slug: 'qwrite-skill-' + suffix,
  });
  const group = await fixture('/tag-groups', {
    name: 'QWrite',
    code: 'QWRITE_' + suffix,
  });
  const tag = await fixture('/tags', {
    tagGroupId: group.id,
    name: 'QWrite-tag',
    slug: 'qwrite-tag-' + suffix,
  });
  const base = {
    questionBankId: bank.id,
    questionType: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: {
      title: 'QWrite-title',
      prompt: 'Prompt 😀',
      options: [
        { id: 'A', content: 'One' },
        { id: 'B', content: 'Two' },
      ],
    },
    answer: { correctOptionIds: ['A'] },
    explanation: { text: 'Explanation' },
    topicIds: [topic.id],
    skillIds: [skill.id],
    tagIds: [tag.id],
  };
  const previous = process.env.ACADEMIC_WRITE_API_ENABLED;
  try {
    process.env.ACADEMIC_WRITE_API_ENABLED = 'false';
    assert.equal(
      (await request(migrated, 'POST', '/questions', base, teacher)).status,
      404,
    );
    process.env.ACADEMIC_WRITE_API_ENABLED = 'true';
    for (const user of [null, student])
      await compare('POST', '/questions', base, user, user ? 403 : 401);
    await compare('POST', '/questions', {}, student, 400);
    for (const body of [
      {},
      null,
      [],
      { ...base, questionBankId: 'invalid' },
      { ...base, questionType: 'invalid' },
      { ...base, content: { ...base.content, prompt: '' } },
      { ...base, explanation: { text: ' ' } },
      {
        ...base,
        content: { ...base.content, options: [{ id: '', content: 'One' }] },
      },
      { ...base, content: { ...base.content, title: 'x'.repeat(256) } },
      { ...base, answer: null },
      { ...base, explanation: null },
    ]) {
      await compare(
        'POST',
        '/questions',
        body,
        teacher,
        body === null ||
          Array.isArray(body) ||
          body.questionBankId === 'invalid' ||
          body.questionType === 'invalid'
          ? 500
          : 400,
      );
    }
    for (const body of [
      { ...base, content: { ...base.content, prompt: 'x'.repeat(20001) } },
      {
        ...base,
        content: {
          ...base.content,
          options: [
            { id: 'A', content: 'x'.repeat(5001) },
            { id: 'B', content: 'Two' },
          ],
        },
      },
      { ...base, answer: { correctOptionIds: ['x'.repeat(51)] } },
      {
        ...base,
        questionType: 'FILL_IN',
        content: { title: 'Fill', prompt: 'Prompt' },
        answer: { acceptedAnswers: ['x'.repeat(1001)] },
      },
      {
        ...base,
        questionType: 'ESSAY',
        content: { title: 'Essay', prompt: 'Prompt' },
        answer: { gradingGuide: 'x'.repeat(10001) },
      },
      { ...base, explanation: { text: 'x'.repeat(20001) } },
    ])
      await compare('POST', '/questions', body, teacher, 400);
    await compare('POST', '/questions', { __rawJson: '{' }, teacher, 500);
    await compare(
      'POST',
      '/questions',
      { ...base, questionBankId: system.id },
      teacher,
      403,
    );
    await compare(
      'POST',
      '/questions',
      { ...base, questionBankId: foreign.id },
      teacher,
      403,
    );
    await compare(
      'POST',
      '/questions',
      { ...base, questionBankId: missing },
      teacher,
      404,
    );
    await compare(
      'POST',
      '/questions',
      { ...base, stimulusId: missing },
      teacher,
      404,
    );
    await compare(
      'POST',
      '/questions',
      { ...base, stimulusId: foreignPassage.id },
      teacher,
      403,
    );
    for (const field of ['tagIds', 'topicIds', 'skillIds'])
      await compare(
        'POST',
        '/questions',
        { ...base, [field]: [missing] },
        teacher,
        404,
      );
    const invalid = [
      {
        content: {
          ...base.content,
          options: [
            { id: 'A', content: 'One' },
            { id: 'A', content: 'Two' },
          ],
        },
      },
      { content: { ...base.content, options: [] } },
      { answer: { correctOptionIds: [] } },
      { answer: { correctOptionIds: ['Z'] } },
      { answer: { correctOptionIds: ['A'], acceptedAnswers: ['x'] } },
      { answer: { correctOptionIds: ['A'], gradingGuide: 'guide' } },
      {
        questionType: 'FILL_IN',
        content: { title: 'Title', prompt: 'Prompt' },
        answer: { acceptedAnswers: [] },
      },
      { questionType: 'FILL_IN', answer: { acceptedAnswers: ['x'] } },
      {
        questionType: 'SHORT_ANSWER',
        content: { title: 'Title', prompt: 'Prompt' },
        answer: { acceptedAnswers: [' '] },
      },
      {
        questionType: 'ESSAY',
        content: { title: 'Title', prompt: 'Prompt' },
        answer: {},
      },
      {
        questionType: 'ESSAY',
        content: { title: 'Title', prompt: 'Prompt' },
        answer: { gradingGuide: 'guide', correctOptionIds: ['A'] },
      },
    ];
    for (const change of invalid)
      await compare('POST', '/questions', { ...base, ...change }, teacher, 400);
    for (const type of ['FILL_IN', 'SHORT_ANSWER', 'ESSAY']) {
      const body = {
        ...base,
        questionType: type,
        content: { title: type, prompt: 'Prompt' },
        answer:
          type === 'ESSAY'
            ? { gradingGuide: 'Guide' }
            : { acceptedAnswers: ['42', null], gradingMode: 'NUMERIC' },
      };
      await compare('POST', '/questions', body, teacher, 201);
    }
    const q = await compare(
      'POST',
      '/questions',
      { ...base, ignored: true },
      teacher,
      201,
    );
    const publicQ = await compare(
      'POST',
      '/questions',
      { ...base, questionBankId: system.id },
      admin,
      201,
    );
    await compare('PUT', `/questions/${q.id}`, base, teacher, 200);
    await compare(
      'PUT',
      `/questions/${q.id}`,
      { ...base, answer: { correctOptionIds: ['B'] } },
      teacher,
      200,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      {
        ...base,
        topicIds: [],
        skillIds: [],
        tagIds: [],
        questionBankId: foreign.id,
      },
      teacher,
      200,
    );
    assert.equal(
      (
        await db.query('SELECT question_bank_id FROM question WHERE id=$1', [
          q.id,
        ])
      ).rows[0].question_bank_id,
      bank.id,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      { ...base, topicIds: [], skillIds: [], tagIds: [] },
      teacher,
      200,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      { ...base, topicIds: [topic.id, topic.id], tagIds: [tag.id, tag.id] },
      teacher,
      200,
    );
    for (const field of ['tagIds', 'topicIds', 'skillIds'])
      await compare(
        'PUT',
        `/questions/${q.id}`,
        { ...base, [field]: [missing] },
        teacher,
        404,
      );
    for (const [action, body] of [
      ['update', base],
      ['publish', {}],
      ['revise', undefined],
      ['archive', undefined],
      ['restore', undefined],
      ['duplicate', { targetQuestionBankId: bank.id }],
    ]) {
      const method = action === 'update' ? 'PUT' : 'POST';
      const path = `/questions/${q.id}${action === 'update' ? '' : '/' + action}`;
      await compare(method, path, body, null, 401);
      await compare(method, path, body, student, 403);
      await compare(method, path, body, other, 403);
      await compare(
        method,
        `/questions/${missing}${action === 'update' ? '' : '/' + action}`,
        body,
        admin,
        404,
      );
    }
    await compare('PUT', '/questions/invalid', base, teacher, 400);
    await compare(
      'POST',
      `/questions/${q.id}/publish`,
      undefined,
      teacher,
      500,
    );
    await compare(
      'POST',
      `/questions/${q.id}/publish`,
      { changeSummary: 'x'.repeat(1001) },
      teacher,
      400,
    );
    await compare('POST', `/questions/${q.id}/revise`, undefined, teacher, 409);
    await compare(
      'POST',
      `/questions/${q.id}/restore`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      { ...base, stimulusId: passage.id },
      teacher,
      200,
    );
    await compare('POST', `/questions/${q.id}/publish`, {}, teacher, 409);
    assert.equal(
      (
        await request(
          baseline,
          'POST',
          `/stimuli/${passage.id}/publish`,
          undefined,
          teacher,
        )
      ).status,
      200,
    );
    await compare(
      'POST',
      `/questions/${q.id}/publish`,
      { changeSummary: '  Version one  ' },
      teacher,
      200,
    );
    const frozen = (
      await db.query(
        'SELECT snapshot FROM question_version WHERE question_id=$1',
        [q.id],
      )
    ).rows[0].snapshot;
    await compare('POST', `/questions/${q.id}/publish`, {}, teacher, 409);
    await compare('PUT', `/questions/${q.id}`, base, teacher, 409);
    await compare(
      'POST',
      `/questions/${q.id}/archive`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'POST',
      `/questions/${q.id}/archive`,
      undefined,
      teacher,
      409,
    );
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: bank.id },
      teacher,
      201,
    );
    await compare(
      'POST',
      `/questions/${q.id}/restore`,
      undefined,
      teacher,
      200,
    );
    assert.equal(
      (await db.query('SELECT status FROM question WHERE id=$1', [q.id]))
        .rows[0].status,
      'PUBLISHED',
    );
    await compare(
      'POST',
      `/questions/${q.id}/revise`,
      { __rawJson: '{' },
      teacher,
      200,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      {
        ...base,
        content: { ...base.content, prompt: 'Revised prompt' },
        answer: { correctOptionIds: ['B'] },
      },
      teacher,
      200,
    );
    await db.query(
      `UPDATE question SET content=content || '{"legacy":"snapshot-content"}'::jsonb WHERE id=$1`,
      [q.id],
    );
    await db.query(
      `UPDATE question_answer SET answer=answer || '{"legacy":"snapshot-answer"}'::jsonb,explanation=explanation || '{"legacy":"snapshot-explanation"}'::jsonb WHERE question_id=$1`,
      [q.id],
    );
    await compare('POST', `/questions/${q.id}/publish`, {}, teacher, 200);
    assert.deepEqual(
      (
        await db.query(
          'SELECT snapshot FROM question_version WHERE question_id=$1 AND version_number=1',
          [q.id],
        )
      ).rows[0].snapshot,
      frozen,
      'Published snapshot must remain immutable',
    );
    assert.equal(
      (
        await db.query(
          'SELECT snapshot FROM question_version WHERE question_id=$1 AND version_number=2',
          [q.id],
        )
      ).rows[0].snapshot.answer.legacy,
      'snapshot-answer',
    );
    await compare(
      'GET',
      `/questions/${q.id}/versions`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: bank.id },
      teacher,
      201,
    );
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: system.id },
      teacher,
      403,
    );
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: foreign.id },
      admin,
      201,
    );
    await compare('POST', `/questions/${q.id}/duplicate`, {}, teacher, 400);
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: missing },
      teacher,
      404,
    );
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: system.id },
      admin,
      201,
    );
    for (const user of [teacher, student])
      await compare(
        'POST',
        `/questions/${q.id}/transfer-ownership`,
        { targetQuestionBankId: foreign.id, reason: 'reason' },
        user,
        403,
      );
    await compare(
      'POST',
      `/questions/${q.id}/transfer-ownership`,
      {},
      admin,
      400,
    );
    await compare(
      'POST',
      `/questions/${q.id}/transfer-ownership`,
      { targetQuestionBankId: bank.id, reason: 'reason' },
      admin,
      409,
    );
    await compare(
      'POST',
      `/questions/${q.id}/transfer-ownership`,
      { targetQuestionBankId: missing, reason: 'reason' },
      admin,
      404,
    );
    await compare(
      'POST',
      `/questions/${q.id}/transfer-ownership`,
      {
        targetQuestionBankId: foreign.id,
        reason: '  Transfer to other teacher  ',
      },
      admin,
      200,
    );
    await compare('POST', `/questions/${q.id}/revise`, undefined, teacher, 403);
    await compare(
      'POST',
      `/questions/${q.id}/transfer-ownership`,
      { targetQuestionBankId: system.id, reason: 'Move system' },
      admin,
      200,
    );
    assert.equal(
      (await db.query('SELECT owner_id FROM question WHERE id=$1', [q.id]))
        .rows[0].owner_id,
      null,
    );
    await compare(
      'POST',
      `/questions/${q.id}/transfer-ownership`,
      { targetQuestionBankId: bank.id, reason: 'Back' },
      admin,
      200,
    );
    await compare('POST', `/questions/${q.id}/revise`, undefined, teacher, 200);
    await db.query(
      "UPDATE question SET status='ARCHIVED',previous_status=NULL WHERE id=$1",
      [q.id],
    );
    await compare(
      'POST',
      `/questions/${q.id}/restore`,
      undefined,
      teacher,
      200,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      {
        ...base,
        content: { ...base.content, prompt: 'Revised prompt' },
        answer: { correctOptionIds: ['B'] },
      },
      teacher,
      200,
    );
    assert.equal(
      (
        await db.query(
          "SELECT answer ? 'legacy' OR explanation ? 'legacy' AS extra FROM question_answer WHERE question_id=$1",
          [q.id],
        )
      ).rows[0].extra,
      false,
      'DTO update removes legacy JSON fields even when typed answer is unchanged',
    );
    for (const type of ['topic', 'skill']) {
      const item = type === 'topic' ? topic : skill;
      await db.query(`UPDATE ${type} SET status='ARCHIVED' WHERE id=$1`, [
        item.id,
      ]);
      await compare('POST', '/questions', base, teacher, 409);
      await compare('POST', `/questions/${q.id}/publish`, {}, teacher, 409);
      await compare(
        'POST',
        `/questions/${q.id}/duplicate`,
        { targetQuestionBankId: bank.id },
        teacher,
        201,
      );
      await db.query(`UPDATE ${type} SET status='ACTIVE' WHERE id=$1`, [
        item.id,
      ]);
    }
    await db.query("UPDATE question_bank SET status='ARCHIVED' WHERE id=$1", [
      bank.id,
    ]);
    await compare('POST', '/questions', base, teacher, 409);
    await compare('POST', `/questions/${q.id}/publish`, {}, teacher, 409);
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: bank.id },
      teacher,
      409,
    );
    // Existing drafts may still be edited inside an archived bank, matching Java.
    await compare('PUT', `/questions/${q.id}`, base, teacher, 200);
    await db.query("UPDATE question_bank SET status='ACTIVE' WHERE id=$1", [
      bank.id,
    ]);
    await db.query("UPDATE stimulus SET status='ARCHIVED' WHERE id=$1", [
      passage.id,
    ]);
    await compare(
      'POST',
      '/questions',
      { ...base, stimulusId: passage.id },
      teacher,
      409,
    );
    await compare(
      'PUT',
      `/questions/${q.id}`,
      { ...base, stimulusId: passage.id },
      teacher,
      409,
    );
    await db.query('UPDATE question SET stimulus_id=$2 WHERE id=$1', [
      q.id,
      passage.id,
    ]);
    await compare(
      'POST',
      `/questions/${q.id}/duplicate`,
      { targetQuestionBankId: bank.id },
      teacher,
      409,
    );
    await db.query("UPDATE stimulus SET status='PUBLISHED' WHERE id=$1", [
      passage.id,
    ]);
    await db.query(
      "UPDATE question_answer SET explanation='{}'::jsonb WHERE question_id=$1",
      [q.id],
    );
    await compare('POST', `/questions/${q.id}/publish`, {}, teacher, 400);
    await compare('PUT', `/questions/${q.id}`, base, teacher, 200);
    await db.query('UPDATE question SET deleted_at=NOW() WHERE id=$1', [
      publicQ.id,
    ]);
    await compare('PUT', `/questions/${publicQ.id}`, base, admin, 404);
    await compare('POST', `/questions/${publicQ.id}/publish`, {}, admin, 404);
    // Inject a failure after the question update but before the audit insert completes.
    const before = await h.snapshot();
    const service = app.get(DatabaseService);
    const original = service.writeTransaction.bind(service);
    service.writeTransaction = (work) =>
      original((client) =>
        work(
          new Proxy(client, {
            get(target, property) {
              if (property === 'query')
                return (...args) => {
                  if (/^INSERT INTO question_ownership_audit/i.test(args[0]))
                    throw new Error('Injected audit failure');
                  return target.query(...args);
                };
              return Reflect.get(target, property);
            },
          }),
        ),
      );
    try {
      const failed = await request(
        migrated,
        'POST',
        `/questions/${q.id}/transfer-ownership`,
        { targetQuestionBankId: foreign.id, reason: 'Fail after update' },
        admin,
      );
      assert.equal(failed.status, 500);
      const sorted = (state) =>
        Object.fromEntries(
          Object.entries(state).map(([table, rows]) => [
            table,
            [...rows].sort((a, b) =>
              JSON.stringify(a).localeCompare(JSON.stringify(b)),
            ),
          ]),
        );
      assert.deepEqual(
        sorted(await h.snapshot()),
        sorted(before),
        'Audit failure must roll back owner, bank, version, timestamps and audit',
      );
    } finally {
      service.writeTransaction = original;
    }
    assert.equal(
      (await request(migrated, 'GET', `/questions/${q.id}`, undefined, teacher))
        .status,
      200,
    );
    // Concurrent updates must preserve one-winner optimistic locking.
    const target = q.id;
    for (const server of [baseline, migrated]) {
      const blocker = await db.connect();
      const pending = [];
      const version = (
        await db.query('SELECT version FROM question WHERE id=$1', [target])
      ).rows[0].version;
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM question WHERE id=$1 FOR UPDATE', [
          target,
        ]);
        for (const prompt of ['Concurrent A', 'Concurrent B'])
          pending.push(
            request(
              server,
              'PUT',
              `/questions/${target}`,
              { ...base, content: { ...base.content, prompt } },
              teacher,
            ),
          );
        let waiting = false;
        const deadline = Date.now() + 1800;
        while (Date.now() < deadline) {
          const n = (
            await db.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE 'update question set%'",
            )
          ).rows[0].n;
          if (n >= 2) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        await blocker.query('COMMIT');
        const results = await Promise.all(pending);
        assert.ok(waiting);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          Number(
            (
              await db.query('SELECT version FROM question WHERE id=$1', [
                target,
              ])
            ).rows[0].version,
          ),
          Number(version) + 1,
        );
      } finally {
        await blocker.query('ROLLBACK');
        await Promise.allSettled(pending);
        blocker.release();
      }
    }
    const published = await Promise.all([
      request(migrated, 'POST', `/questions/${target}/publish`, {}, teacher),
      request(migrated, 'POST', `/questions/${target}/publish`, {}, teacher),
    ]);
    assert.deepEqual(published.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(
      (
        await db.query(
          'SELECT array_agg(version_number ORDER BY version_number) AS numbers FROM question_version WHERE question_id=$1',
          [target],
        )
      ).rows[0].numbers,
      [1, 2, 3],
    );
    return h.count;
  } finally {
    if (previous === undefined) delete process.env.ACADEMIC_WRITE_API_ENABLED;
    else process.env.ACADEMIC_WRITE_API_ENABLED = previous;
  }
};
