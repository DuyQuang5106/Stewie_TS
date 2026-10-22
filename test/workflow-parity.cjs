const assert = require('node:assert/strict');
module.exports = async function workflows({
  baseline,
  migrated,
  identities,
  db,
}) {
  const [admin, teacher, student] = identities;
  const suffix = Date.now();
  const h = await require('./question-contract-harness.cjs')({
    baseline,
    migrated,
    db,
    workflow: true,
  });
  const { compare, request } = h;
  async function fixture(path, body, user = teacher) {
    const r = await request(baseline, 'POST', path, body, user);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  const bank = await fixture('/question-banks', {
    name: 'Workflow-' + suffix,
    scope: 'TEACHER',
  });
  const item = {
    externalId: 'one',
    questionType: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: {
      title: 'Import',
      prompt: 'Prompt',
      options: [
        { id: 'A', content: 'One' },
        { id: 'B', content: 'Two' },
      ],
    },
    answer: { correctOptionIds: ['A'] },
    explanation: { text: 'Explanation' },
  };
  const base = {
    schemaVersion: 1,
    importKey: 'workflow-' + suffix,
    targetQuestionBankId: bank.id,
    questions: [item],
  };
  let n = 0;
  const document = (patch) => ({
    ...base,
    importKey: base.importKey + '-' + ++n,
    ...patch,
  });
  const missing = '00000000-0000-0000-0000-000000000000';
  const previous = process.env.ACADEMIC_WRITE_API_ENABLED;
  try {
    process.env.ACADEMIC_WRITE_API_ENABLED = 'true';
    for (const user of [null, student])
      await compare(
        'POST',
        '/question-imports/validate',
        base,
        user,
        user ? 403 : 401,
      );
    for (const body of [
      {},
      null,
      [],
      { ...base, schemaVersion: 2 },
      { ...base, importKey: '' },
      { ...base, targetQuestionBankId: 'invalid' },
      { ...base, questions: [] },
      { ...base, questions: Array(101).fill(item) },
      { ...base, questions: [null] },
      { ...base, questions: [{ ...item, externalId: '' }] },
      { ...base, questions: [{ ...item, content: null }] },
    ])
      await compare('POST', '/question-imports/validate', body, teacher);
    for (const patch of [
      {},
      { questions: [item, { ...item }] },
      { questions: [{ ...item, stimulusId: missing }] },
      { questions: [{ ...item, answer: { correctOptionIds: ['C'] } }] },
      { targetQuestionBankId: missing },
    ])
      await compare(
        'POST',
        '/question-imports/validate',
        document(patch),
        teacher,
      );
    const repeated = document({});
    const existing = await compare(
      'POST',
      '/question-imports/validate',
      repeated,
      teacher,
      201,
    );
    await compare(
      'POST',
      '/question-imports/validate',
      {
        ...repeated,
        targetQuestionBankId: missing,
        questions: [{ ...item, stimulusId: missing }],
      },
      teacher,
      201,
    );
    assert.equal(
      (
        await request(
          migrated,
          'GET',
          '/question-imports/' + existing.id,
          undefined,
          teacher,
        )
      ).body.id,
      existing.id,
    );
    for (const value of ['', '1', 1.9, true, '1.9', '1e0'])
      await compare(
        'POST',
        '/question-imports/validate',
        document({ schemaVersion: value }),
        teacher,
      );
    for (const patch of [
      { externalId: 'x'.repeat(101) },
      { difficulty: 'bad' },
      { topicIds: ['bad'] },
      { content: { ...item.content, prompt: '' } },
      { topicIds: [missing] },
      { externalId: ' two ' },
      { externalId: 123 },
    ])
      await compare(
        'POST',
        '/question-imports/validate',
        document({ questions: [{ ...item, ...patch }] }),
        teacher,
      );
    const atomic = await compare(
      'POST',
      '/question-imports/validate',
      document({
        questions: [item, { ...item, externalId: 'late', tagIds: [] }],
      }),
      teacher,
      201,
    );
    // Alter only the isolated stored test batch so its second candidate fails after the first insert.
    await db.query(
      "UPDATE question_import_batch SET payload=jsonb_set(payload,'{questions,1,stimulusId}',to_jsonb($2::text)) WHERE id=$1",
      [atomic.id, missing],
    );
    await compare(
      'POST',
      '/question-imports/' + atomic.id + '/commit',
      undefined,
      teacher,
      404,
    );
    await compare(
      'POST',
      '/question-imports/validate',
      document({
        questions: Array.from({ length: 100 }, (_, i) => ({
          ...item,
          externalId: String(i),
          content: { ...item.content, prompt: 'x'.repeat(11000) },
        })),
      }),
      teacher,
      413,
    );
    await compare(
      'POST',
      '/question-imports/validate',
      document({
        questions: Array.from({ length: 100 }, (_, i) => ({
          ...item,
          externalId: String(i),
          content: { ...item.content, prompt: '\u00e9'.repeat(5500) },
        })),
      }),
      teacher,
      413,
    );
    const batch = await compare(
      'POST',
      '/question-imports/validate',
      document({ questions: [item, { ...item, externalId: 'two' }] }),
      teacher,
      201,
    );
    for (const user of [teacher, admin, student, null])
      await compare(
        'GET',
        '/question-imports/' + batch.id,
        undefined,
        user,
        user === student ? 403 : user ? 200 : 401,
      );
    await compare(
      'POST',
      '/question-imports/' + batch.id + '/commit',
      undefined,
      admin,
      403,
    );
    const committed = await compare(
      'POST',
      '/question-imports/' + batch.id + '/commit',
      undefined,
      teacher,
      200,
    );
    assert.equal(committed.createdQuestionIds.length, 2);
    await compare(
      'POST',
      '/question-imports/' + batch.id + '/commit',
      undefined,
      teacher,
      200,
    );
    for (const id of [missing, 'invalid'])
      for (const method of ['GET', 'POST'])
        await compare(
          method,
          '/question-imports/' + id + (method === 'POST' ? '/commit' : ''),
          undefined,
          teacher,
        );
    const failed = await compare(
      'POST',
      '/question-imports/validate',
      document({ questions: [item, item] }),
      teacher,
      201,
    );
    await compare(
      'POST',
      '/question-imports/' + failed.id + '/commit',
      undefined,
      teacher,
      409,
    );
    for (const query of [
      '',
      '?questionBankId=invalid',
      '?questionBankId=' + missing,
      '?questionBankId=' + bank.id,
      '?questionBankId=' + bank.id + '&status=DRAFT',
      '?questionBankId=' + bank.id + '&status=invalid',
    ])
      await compare('GET', '/question-exports' + query, undefined, teacher);
    for (const user of [admin, student, null])
      await compare(
        'GET',
        '/question-exports?questionBankId=' + bank.id,
        undefined,
        user,
        user === student ? 403 : user ? 200 : 401,
      );
    const q = await fixture('/questions', { ...item, questionBankId: bank.id });
    const published = await request(
      baseline,
      'POST',
      '/questions/' + q.id + '/publish',
      {},
      teacher,
    );
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const version = (
      await db.query('SELECT current_version_id FROM question WHERE id=$1', [
        q.id,
      ])
    ).rows[0].current_version_id;
    for (const user of [teacher, student, null])
      await compare(
        'POST',
        '/question-versions/' + version + '/reviews',
        { status: 'APPROVED' },
        user,
        user ? 403 : 401,
      );
    for (const body of [
      {},
      null,
      { status: 'invalid' },
      { status: 'PENDING' },
      { status: 'CHANGES_REQUESTED' },
      { status: 'APPROVED', comment: 'x'.repeat(2001) },
      { status: 'APPROVED', comment: '   approved   ' },
      { status: 'CHANGES_REQUESTED', comment: ' fix ' },
      { status: 'APPROVED', comment: '\u00a0' },
    ])
      await compare(
        'POST',
        '/question-versions/' + version + '/reviews',
        body,
        admin,
      );
    await compare(
      'POST',
      '/question-versions/' + missing + '/reviews',
      { status: 'APPROVED' },
      admin,
      404,
    );
    await require('./workflow-boundaries.cjs')({
      baseline,
      migrated,
      db,
      teacher,
      fixture,
      h,
      item,
      seed: q,
    });
    process.env.ACADEMIC_WRITE_API_ENABLED = 'false';
    assert.equal(
      (
        await request(
          migrated,
          'POST',
          '/question-imports/validate',
          base,
          teacher,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          migrated,
          'GET',
          '/question-imports/' + batch.id,
          undefined,
          teacher,
        )
      ).status,
      200,
    );
    return h.count;
  } finally {
    process.env.ACADEMIC_WRITE_API_ENABLED = previous;
  }
};
