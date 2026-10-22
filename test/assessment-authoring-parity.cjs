const assert = require('node:assert/strict');
module.exports = async function assessmentAuthoringParity({
  baseline,
  migrated,
  identities,
  db,
}) {
  const [admin, teacher, student] = identities;
  const h = await require('./domain-contract-harness.cjs')({
    baseline,
    migrated,
    db,
    prefix: '/api/assessments',
    tables: [
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
    ],
  });
  const { compare, request } = h;
  const old = process.env.ASSESSMENT_API_ENABLED;
  process.env.ASSESSMENT_API_ENABLED = 'true';
  const base = {
    title: 'Assessment ' + Date.now(),
    type: 'TEST',
    releasePolicy: 'IMMEDIATE',
    accessMode: 'OPEN',
  };
  const missing = '00000000-0000-0000-0000-000000000000';
  try {
    for (const user of [null, student, teacher, admin])
      await compare(
        'GET',
        '?sort=id,asc',
        undefined,
        user,
        user ? (user === student ? 403 : 200) : 401,
      );
    for (const body of [
      {},
      null,
      [],
      { ...base, title: '' },
      { ...base, title: 'x'.repeat(256) },
      { ...base, type: 'bad' },
      { ...base, maxAttempts: 0 },
      { ...base, config: [] },
      { ...base, availableFrom: 'invalid' },
      { ...base, type: 'DRILL', timingMode: 'STRICT' },
      { ...base, releasePolicy: 'AFTER_DEADLINE' },
      {
        ...base,
        availableFrom: '2026-02-02T00:00:00Z',
        availableUntil: '2026-01-01T00:00:00Z',
      },
      base,
    ])
      await compare('POST', '', body, teacher);
    const a = await compare(
      'POST',
      '',
      { ...base, title: 'Lifecycle' },
      teacher,
      201,
    );
    assert.equal(
      (
        await db.query(
          'SELECT config IS NULL AS empty FROM assessments WHERE id=$1',
          [a.id],
        )
      ).rows[0].empty,
      true,
      'Omitted config must remain SQL NULL',
    );
    for (const user of [teacher, admin, student])
      await compare('GET', '/' + a.id, undefined, user);
    await compare('GET', '/' + missing, undefined, teacher, 404);
    await compare('GET', '/invalid', undefined, teacher, 400);
    await compare('POST', '/' + a.id + '/publish', undefined, teacher, 400);
    for (const body of [
      {},
      { name: '', orderIndex: 0 },
      { name: 'Reading', orderIndex: 1, durationSeconds: 0 },
    ])
      await compare('POST', '/' + a.id + '/sections', body, teacher, 400);
    const section = await compare(
      'POST',
      '/' + a.id + '/sections',
      { name: ' Reading ', code: 'RW', orderIndex: 1, durationSeconds: 120 },
      teacher,
      201,
    );
    await compare(
      'POST',
      '/' + a.id + '/sections',
      { name: 'Duplicate', orderIndex: 1 },
      teacher,
      409,
    );
    await compare('POST', '/' + a.id + '/publish', undefined, teacher, 400);
    const module = await compare(
      'POST',
      '/sections/' + section.id + '/modules',
      { name: ' Module ', orderIndex: 1 },
      teacher,
      201,
    );
    await compare('POST', '/' + a.id + '/publish', undefined, teacher, 400);
    await compare(
      'POST',
      '/modules/' + module.id + '/questions',
      { questionId: missing, questionVersionId: missing, position: 1 },
      teacher,
      404,
    );
    const academic = async (path, body, user = teacher) => {
      const response = await fetch(baseline + '/api/academic' + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + user.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, 201, JSON.stringify(value));
      return value;
    };
    const bank = await academic('/question-banks', {
      name: 'Assessment bank ' + Date.now(),
      scope: 'TEACHER',
    });
    const question = await academic('/questions', {
      questionBankId: bank.id,
      questionType: 'MULTIPLE_CHOICE',
      difficulty: 'MEDIUM',
      content: {
        title: 'Item',
        prompt: 'Choose',
        options: [
          { id: 'A', content: 'One' },
          { id: 'B', content: 'Two' },
        ],
      },
      answer: { correctOptionIds: ['A'] },
      explanation: { text: 'Because' },
    });
    const publish = await fetch(
      baseline + '/api/academic/questions/' + question.id + '/publish',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + teacher.token,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    assert.equal(publish.status, 200);
    const published = await publish.json();
    const q = {
      questionId: question.id,
      questionVersionId: published.currentVersionId,
      position: 1,
      points: 2.5,
    };
    for (const body of [
      {},
      { ...q, position: 0 },
      { ...q, points: 0 },
      { ...q, questionVersionId: missing },
    ])
      await compare(
        'POST',
        '/modules/' + module.id + '/questions',
        body,
        teacher,
      );
    await compare(
      'POST',
      '/modules/' + module.id + '/questions',
      q,
      teacher,
      201,
    );
    await compare(
      'POST',
      '/modules/' + module.id + '/questions',
      q,
      teacher,
      409,
    );
    await compare('GET', '/' + a.id, undefined, teacher, 200);
    await compare('POST', '/' + a.id + '/clone', undefined, teacher, 201);
    await compare(
      'PUT',
      '/' + a.id,
      { ...base, title: 'Renamed', description: 'Details' },
      teacher,
      200,
    );
    const stable = (
      await db.query(
        'SELECT updated_at::text AS time FROM assessments WHERE id=$1',
        [a.id],
      )
    ).rows[0].time;
    await compare(
      'PUT',
      '/' + a.id,
      { ...base, title: 'Renamed', description: 'Details' },
      teacher,
      200,
    );
    assert.equal(
      (
        await db.query(
          'SELECT updated_at::text AS time FROM assessments WHERE id=$1',
          [a.id],
        )
      ).rows[0].time,
      stable,
      'Identical update must not touch the Hibernate timestamp',
    );
    await compare(
      'POST',
      '/' + a.id + '/assign',
      { studentId: student.id },
      teacher,
      201,
    );
    await compare(
      'POST',
      '/' + a.id + '/assign',
      { studentId: student.id, dueAt: '2099-01-01T00:00:00Z' },
      teacher,
      201,
    );
    await compare(
      'GET',
      '/my-assignments?sort=id,asc',
      undefined,
      student,
      200,
    );
    await compare(
      'GET',
      '/my-assignments?sort=id,asc',
      undefined,
      teacher,
      403,
    );
    await compare('GET', '/' + a.id + '/submissions', undefined, teacher, 200);
    await compare('POST', '/' + a.id + '/publish', undefined, teacher, 200);
    await compare('POST', '/' + a.id + '/publish', undefined, teacher, 409);
    await compare(
      'POST',
      '/' + a.id + '/sections',
      { name: 'Late', orderIndex: 2 },
      teacher,
      409,
    );
    await compare(
      'PUT',
      '/' + a.id,
      { ...base, title: 'Live title', description: 'Details' },
      teacher,
      200,
    );
    await compare(
      'PUT',
      '/' + a.id,
      { ...base, type: 'DRILL', title: 'Changed type' },
      teacher,
      409,
    );
    await compare(
      'PUT',
      '/' + a.id,
      {
        ...base,
        title: 'Shorter deadline',
        availableUntil: '2099-01-01T00:00:00Z',
      },
      teacher,
      400,
    );
    await compare(
      'PUT',
      '/' + a.id + '/access-mode',
      { accessMode: 'ASSIGNED_ONLY' },
      teacher,
      200,
    );
    await compare('PUT', '/' + a.id + '/access-mode', {}, teacher, 400);
    await compare(
      'POST',
      '/' + a.id + '/release-results',
      undefined,
      teacher,
      400,
    );
    const manual = await compare(
      'POST',
      '',
      { ...base, releasePolicy: 'MANUAL' },
      teacher,
      201,
    );
    await compare(
      'POST',
      '/' + manual.id + '/release-results',
      undefined,
      teacher,
      200,
    );
    await compare('POST', '/' + a.id + '/close', undefined, teacher, 200);
    await compare('POST', '/' + a.id + '/close', undefined, teacher, 409);
    for (const user of [teacher, admin])
      for (const query of [
        '?sort=id,asc',
        '?sort=title,desc&sort=id,asc',
        '?page=99&size=1&sort=id,asc',
        '?size=1&sort=id,asc',
      ])
        await compare('GET', query, undefined, user, 200);
    process.env.ASSESSMENT_API_ENABLED = 'false';
    assert.equal(
      (await request(migrated, 'GET', '', undefined, teacher)).status,
      404,
    );
    return h.count;
  } finally {
    if (old === undefined) delete process.env.ASSESSMENT_API_ENABLED;
    else process.env.ASSESSMENT_API_ENABLED = old;
  }
};
