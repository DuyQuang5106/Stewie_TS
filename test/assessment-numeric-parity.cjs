const assert = require('node:assert/strict');
module.exports = async function numericGrading({
  h,
  db,
  baseline,
  teacher,
  student,
  fixture,
}) {
  const { compare } = h;
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
    name: 'Numeric ' + Date.now(),
    scope: 'TEACHER',
  });
  const word = await academic('/questions', {
    questionBankId: bank.id,
    questionType: 'FILL_IN',
    difficulty: 'HARD',
    content: { title: 'Fraction', prompt: 'Three quarters' },
    answer: { acceptedAnswers: ['3/4'], gradingMode: 'NUMERIC' },
    explanation: { text: 'Equivalent rational numbers' },
  });
  const version = await academic('/questions/' + word.id + '/publish', {});
  const a = await fixture('', {
    title: 'Numeric grading',
    type: 'DRILL',
    releasePolicy: 'IMMEDIATE',
    accessMode: 'OPEN',
    maxAttempts: 20,
  });
  const s = await fixture('/' + a.id + '/sections', {
    name: 'Math',
    orderIndex: 1,
  });
  const m = await fixture('/sections/' + s.id + '/modules', {
    name: 'Numbers',
    orderIndex: 1,
  });
  const q = await fixture('/modules/' + m.id + '/questions', {
    questionId: word.id,
    questionVersionId: version.currentVersionId,
    position: 1,
    points: 1.25,
  });
  await fixture('/' + a.id + '/publish', undefined, teacher, 200);
  for (const [answer, correct] of [
    ['0.75', true],
    ['.75', true],
    ['6/8', true],
    ['-3/-4', true],
    [{ value: '3 / 4' }, true],
    ['75/100', true],
    ['1e-999999999', false],
    [{ text: 'invalid' }, false],
    [0.75, false],
    ['3/0', false],
    ['1'.repeat(33), false],
  ]) {
    const started = await compare(
      'POST',
      '/' + a.id + '/start',
      undefined,
      student,
      201,
    );
    assert.equal(started.timed, false);
    await compare(
      'PUT',
      '/attempts/' + started.attemptId + '/answers',
      { assessmentQuestionId: q.id, answerData: answer },
      student,
      200,
    );
    await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [
      started.attemptId,
    ]);
    const result = await compare(
      'POST',
      '/attempts/' + started.attemptId + '/submit',
      undefined,
      student,
      200,
    );
    assert.equal(result.result.totalGrade, correct ? 1.25 : 0);
  }
  // A legacy published essay must stay hidden from its student until final grading.
  await db.query(
    "UPDATE question_version SET snapshot=jsonb_set(snapshot,'{questionType}','\"ESSAY\"'::jsonb) WHERE id=$1",
    [version.currentVersionId],
  );
  const pending = await fixture('/' + a.id + '/start', undefined, student);
  await compare(
    'PUT',
    '/attempts/' + pending.attemptId + '/answers',
    { assessmentQuestionId: q.id, answerData: 'Essay text' },
    student,
    200,
  );
  await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [
    pending.attemptId,
  ]);
  const result = await compare(
    'POST',
    '/attempts/' + pending.attemptId + '/submit',
    undefined,
    student,
    200,
  );
  assert.equal(result.resultAvailable, false);
  assert.equal(result.result, null);
  await compare(
    'GET',
    '/attempts/' + pending.attemptId + '/review',
    undefined,
    student,
    403,
  );
  await compare(
    'GET',
    '/attempts/' + pending.attemptId + '/review',
    undefined,
    teacher,
    200,
  );
  await db.query(
    "UPDATE question_version SET snapshot=jsonb_set(snapshot,'{questionType}','\"FILL_IN\"'::jsonb) WHERE id=$1",
    [version.currentVersionId],
  );
  const saved = (
    await db.query('SELECT snapshot FROM question_version WHERE id=$1', [
      version.currentVersionId,
    ])
  ).rows[0].snapshot;
  try {
    const textSnapshot = {
      ...saved,
      answer: {
        ...saved.answer,
        gradingMode: 'TEXT_EXACT',
        acceptedAnswers: ['i'],
      },
    };
    await db.query(
      'UPDATE question_version SET snapshot=$2::jsonb WHERE id=$1',
      [version.currentVersionId, JSON.stringify(textSnapshot)],
    );
    for (const [answer, correct] of [
      ['\u0131', true],
      ['\u0130', true],
      ['i\u0307', false],
    ]) {
      const start = await compare(
        'POST',
        '/' + a.id + '/start',
        undefined,
        student,
        201,
      );
      await compare(
        'PUT',
        '/attempts/' + start.attemptId + '/answers',
        { assessmentQuestionId: q.id, answerData: answer },
        student,
        200,
      );
      await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [
        start.attemptId,
      ]);
      const result = await compare(
        'POST',
        '/attempts/' + start.attemptId + '/submit',
        undefined,
        student,
        200,
      );
      assert.equal(
        result.result.totalGrade,
        correct ? 1.25 : 0,
        'Text grading must match Java simple Unicode case comparison',
      );
    }
  } finally {
    await db.query(
      'UPDATE question_version SET snapshot=$2::jsonb WHERE id=$1',
      [version.currentVersionId, JSON.stringify(saved)],
    );
  }
};
