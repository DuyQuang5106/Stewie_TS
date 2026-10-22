const assert = require('node:assert/strict');
module.exports = async function assessmentTakingParity({
  baseline,
  migrated,
  identities,
  db,
  app,
  DatabaseService,
  AssessmentExpiryService,
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
  async function fixture(path, body, user = teacher, status = 201) {
    const r = await request(baseline, 'POST', path, body, user);
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  }
  async function academic(path, body) {
    const r = await fetch(baseline + '/api/academic' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + teacher.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    assert.ok(r.status < 300, JSON.stringify(b));
    return b;
  }
  const bank = await academic('/question-banks', {
    name: 'Taking ' + Date.now(),
    scope: 'TEACHER',
  });
  const q = await academic('/questions', {
    questionBankId: bank.id,
    questionType: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: {
      title: 'Read',
      prompt: 'Pick one',
      options: [
        { id: 'A', content: 'First' },
        { id: 'B', content: 'Second' },
      ],
    },
    answer: { correctOptionIds: ['A'] },
    explanation: { text: 'First is correct' },
  });
  const published = await academic('/questions/' + q.id + '/publish', {});
  async function assessment(
    mode = 'SOFT',
    releasePolicy = 'IMMEDIATE',
    timedModules = false,
  ) {
    const a = await fixture('', {
      title: 'Taking ' + mode,
      type: 'TEST',
      releasePolicy,
      accessMode: 'OPEN',
      timingMode: mode,
      maxAttempts: 3,
    });
    const sections = [];
    const modules = [];
    const questions = [];
    for (let i = 1; i <= 2; i++) {
      const s = await fixture('/' + a.id + '/sections', {
        name: 'Section ' + i,
        orderIndex: i,
        durationSeconds: 600,
      });
      sections.push(s);
      for (let j = 1; j <= 2; j++) {
        const m = await fixture('/sections/' + s.id + '/modules', {
          name: 'Module ' + j,
          orderIndex: j,
          ...(timedModules ? { durationSeconds: 300 } : {}),
        });
        modules.push(m);
        questions.push(
          await fixture('/modules/' + m.id + '/questions', {
            questionId: q.id,
            questionVersionId: published.currentVersionId,
            position: 1,
            points: 1.25,
          }),
        );
      }
    }
    await fixture('/' + a.id + '/publish', undefined, teacher, 200);
    return { a, sections, modules, questions };
  }
  const missing = '00000000-0000-0000-0000-000000000000';
  try {
    const soft = await assessment();
    for (const user of [null, teacher, admin])
      await compare(
        'POST',
        '/' + soft.a.id + '/start',
        undefined,
        user,
        user ? 403 : 401,
      );
    const attempt = await compare(
      'POST',
      '/' + soft.a.id + '/start',
      { timed: false },
      student,
      201,
    );
    const id = attempt.attemptId;
    assert.equal(attempt.timed, false);
    assert.equal(attempt.sheet.sections.length, 2);
    assert.ok(!JSON.stringify(attempt).includes('correctOptionIds'));
    assert.ok(!JSON.stringify(attempt).includes('First is correct'));
    await compare('POST', '/' + soft.a.id + '/start', undefined, student, 201);
    for (const action of [
      'resume',
      'clock',
      'current-section',
      'result',
      'review',
    ])
      await compare(
        'GET',
        '/attempts/' + id + '/' + action,
        undefined,
        student,
      );
    for (const user of [teacher, admin])
      await compare('GET', '/attempts/' + id + '/resume', undefined, user, 403);
    for (const body of [
      {},
      null,
      { assessmentQuestionId: 'invalid' },
      { assessmentQuestionId: missing },
      {
        assessmentQuestionId: soft.questions[0].id,
        answerData: 'x'.repeat(4097),
      },
    ])
      await compare('PUT', '/attempts/' + id + '/answers', body, student);
    for (const answer of [
      null,
      'A',
      ['A'],
      { selectedOptionIds: ['A'] },
      false,
      {},
      [],
    ])
      await compare(
        'PUT',
        '/attempts/' + id + '/answers',
        { assessmentQuestionId: soft.questions[0].id, answerData: answer },
        student,
        200,
      );
    await compare(
      'PUT',
      '/attempts/' + id + '/answers',
      { assessmentQuestionId: soft.questions[0].id, answerData: 'A' },
      student,
      200,
    );
    await compare(
      'PUT',
      '/attempts/' + id + '/flag',
      { assessmentQuestionId: soft.questions[0].id, isFlagged: true },
      student,
      200,
    );
    await compare(
      'GET',
      '/attempts/' + id + '/resume',
      undefined,
      student,
      200,
    );
    await compare(
      'POST',
      '/attempts/' + id + '/question-time',
      { entries: [{ assessmentQuestionId: soft.questions[0].id, seconds: 5 }] },
      student,
      409,
    );
    await compare(
      'POST',
      '/attempts/' + id + '/sections/' + soft.sections[0].id + '/complete',
      undefined,
      student,
      409,
    );
    // Align started_at to now so both backends submit within the same elapsed-second bucket.
    await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [id]);
    const submitted = await compare(
      'POST',
      '/attempts/' + id + '/submit',
      undefined,
      student,
      200,
    );
    assert.equal(submitted.result.totalGrade, 1.25);
    assert.equal(submitted.result.maxGrade, 5);
    await compare(
      'POST',
      '/attempts/' + id + '/submit',
      undefined,
      student,
      200,
    );
    await compare(
      'GET',
      '/attempts/' + id + '/resume',
      undefined,
      student,
      409,
    );
    for (const user of [student, teacher, admin])
      for (const action of ['result', 'review'])
        await compare(
          'GET',
          '/attempts/' + id + '/' + action,
          undefined,
          user,
          200,
        );
    await compare(
      'PUT',
      '/attempts/' + id + '/answers',
      { assessmentQuestionId: soft.questions[0].id, answerData: 'B' },
      student,
      409,
    );
    for (const timedModules of [false, true]) {
      const strict = await assessment('STRICT', 'IMMEDIATE', timedModules);
      const started = await compare(
        'POST',
        '/' + strict.a.id + '/start',
        undefined,
        student,
        201,
      );
      const aid = started.attemptId;
      assert.equal(started.activeSection.sectionId, strict.sections[0].id);
      assert.equal(
        started.activeSection.questions.length,
        timedModules ? 1 : 2,
      );
      assert.equal(started.sheet, null);
      await compare(
        'GET',
        '/attempts/' + aid + '/current-section',
        undefined,
        student,
        200,
      );
      await compare(
        'GET',
        '/attempts/' + aid + '/clock',
        undefined,
        student,
        200,
      );
      await compare(
        'PUT',
        '/attempts/' + aid + '/answers',
        { assessmentQuestionId: strict.questions[2].id, answerData: 'A' },
        student,
        409,
      );
      if (timedModules)
        await compare(
          'PUT',
          '/attempts/' + aid + '/answers',
          { assessmentQuestionId: strict.questions[1].id, answerData: 'A' },
          student,
          409,
        );
      await compare(
        'PUT',
        '/attempts/' + aid + '/answers',
        { assessmentQuestionId: strict.questions[0].id, answerData: 'A' },
        student,
        200,
      );
      await compare(
        'POST',
        '/attempts/' + aid + '/sections/' + strict.sections[1].id + '/start',
        undefined,
        student,
        409,
      );
      if (timedModules) {
        await compare(
          'POST',
          '/attempts/' + aid + '/modules/' + strict.modules[1].id + '/complete',
          undefined,
          student,
          409,
        );
        await compare(
          'POST',
          '/attempts/' + aid + '/modules/' + strict.modules[0].id + '/complete',
          undefined,
          student,
          200,
        );
        await compare(
          'POST',
          '/attempts/' + aid + '/modules/' + strict.modules[0].id + '/complete',
          undefined,
          student,
          200,
        );
      } else
        await compare(
          'POST',
          '/attempts/' + aid + '/modules/' + strict.modules[0].id + '/complete',
          undefined,
          student,
          409,
        );
      await compare(
        'POST',
        '/attempts/' + aid + '/sections/' + strict.sections[0].id + '/complete',
        undefined,
        student,
        200,
      );
      await compare(
        'POST',
        '/attempts/' + aid + '/sections/' + strict.sections[0].id + '/complete',
        undefined,
        student,
        200,
      );
      await compare(
        'POST',
        '/attempts/' + aid + '/sections/' + strict.sections[1].id + '/start',
        undefined,
        student,
        200,
      );
      await compare(
        'POST',
        '/attempts/' + aid + '/sections/' + strict.sections[1].id + '/start',
        undefined,
        student,
        200,
      );
      await compare(
        'GET',
        '/attempts/' + aid + '/resume',
        undefined,
        student,
        200,
      );
      await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [aid]);
      await compare(
        'POST',
        '/attempts/' + aid + '/sections/' + strict.sections[1].id + '/complete',
        undefined,
        student,
        200,
      );
      await compare(
        'POST',
        '/attempts/' + aid + '/submit',
        undefined,
        student,
        200,
      );
    }
    const hidden = await assessment('SOFT', 'MANUAL');
    const hiddenAttempt = await fixture(
      '/' + hidden.a.id + '/start',
      undefined,
      student,
    );
    await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [
      hiddenAttempt.attemptId,
    ]);
    const secret = await compare(
      'POST',
      '/attempts/' + hiddenAttempt.attemptId + '/submit',
      undefined,
      student,
      200,
    );
    assert.equal(secret.result, null);
    await compare(
      'GET',
      '/attempts/' + hiddenAttempt.attemptId + '/review',
      undefined,
      student,
      403,
    );
    await compare(
      'GET',
      '/attempts/' + hiddenAttempt.attemptId + '/review',
      undefined,
      teacher,
      200,
    );
    await fixture(
      '/' + hidden.a.id + '/release-results',
      undefined,
      teacher,
      200,
    );
    await compare(
      'GET',
      '/attempts/' + hiddenAttempt.attemptId + '/result',
      undefined,
      student,
      200,
    );
    await compare(
      'GET',
      '/attempts/' + hiddenAttempt.attemptId + '/review',
      undefined,
      student,
      200,
    );
    await require('./assessment-taking-boundaries.cjs')({
      h,
      db,
      baseline,
      migrated,
      student,
      teacher,
      admin,
      assessment,
      fixture,
      app,
      DatabaseService,
      AssessmentExpiryService,
    });
    await require('./assessment-numeric-parity.cjs')({
      h,
      db,
      baseline,
      teacher,
      student,
      fixture,
    });
    return h.count;
  } finally {
    if (old === undefined) delete process.env.ASSESSMENT_API_ENABLED;
    else process.env.ASSESSMENT_API_ENABLED = old;
  }
};
