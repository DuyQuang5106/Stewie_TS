const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async function analyticsParity({
  baseline,
  migrated,
  identities,
  db,
}) {
  assert.equal(
    new URL(process.env.DATABASE_URL).pathname,
    '/stiu_read_api_test',
  );
  const previous = process.env.ANALYTICS_API_ENABLED;
  process.env.ANALYTICS_API_ENABLED = 'true';
  let count = 0;
  const [admin, teacher] = identities;
  const request = async (base, path, user) => {
    const response = await fetch(base + '/api/analytics/me/' + path, {
      headers: user ? { Authorization: 'Bearer ' + user.token } : {},
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  };
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => k !== 'timestamp')
          .map(([k, v]) => [k, normalize(v)]),
      );
    if (
      typeof value === 'string' &&
      /^\d{4}-\d\d-\d\dT/.test(value) &&
      !isNaN(Date.parse(value))
    )
      return (
        new Date(value).toISOString().slice(0, 19) +
        '.' +
        (/\.(\d+)/.exec(value)?.[1] ?? '').padEnd(9, '0') +
        'Z'
      );
    return value;
  };
  const compare = async (path, user, expected) => {
    const start = Date.now();
    const a = await request(baseline, path, user),
      b = await request(migrated, path, user);
    assert.equal(b.status, a.status, path + ' status');
    if (expected)
      assert.equal(
        a.status,
        expected,
        path + ' baseline ' + JSON.stringify(a.body),
      );
    const x = normalize(a.body),
      y = normalize(b.body);
    const params = new URLSearchParams(path.split('?')[1]);
    if (
      a.status === 200 &&
      x.allTime === false &&
      !params.has('from') &&
      !params.has('to')
    ) {
      for (const v of [x, y]) {
        assert.ok(
          Date.parse(v.to) >= start - 5000 &&
            Date.parse(v.to) <= Date.now() + 5000,
        );
        assert.equal(Date.parse(v.to) - Date.parse(v.from), 30 * 86400000);
        v.from = '<rolling>';
        v.to = '<rolling>';
      }
    }
    assert.deepEqual(y, x, path);
    count++;
    return a.body;
  };
  const login = async (suffix) => {
    const response = await fetch(
      baseline +
        '/api/auth/dev-login?email=analytics.' +
        suffix +
        '.' +
        randomUUID() +
        '@stewiesat.test&role=STUDENT',
      { method: 'POST' },
    );
    assert.equal(response.status, 200);
    const { accessToken } = await response.json();
    return {
      token: accessToken,
      id: JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url')).sub,
    };
  };
  const student = await login('primary'),
    other = await login('other');
  const paths = [
    'assessment-history',
    'summary?type=TEST',
    'performance?groupBy=SKILL',
    'score-trend?type=TEST',
    'time-summary',
    'recap',
    'next-practice',
  ];
  try {
    for (const user of [null, admin, teacher, student])
      for (const path of paths)
        await compare(path, user, user === student ? 200 : user ? 403 : 401);
    for (const path of [
      'summary',
      'summary?type=bad',
      'summary?type=test',
      'summary?type=',
      'performance',
      'performance?groupBy=bad',
      'performance?groupBy=%20',
      'performance?groupBy=skill',
      'performance?groupBy=%20topic%20',
      'assessment-history?page=-1',
      'assessment-history?size=0',
      'assessment-history?size=101',
      'assessment-history?page=no',
      'assessment-history?page=2147483648',
      'assessment-history?status=bad',
      'score-trend',
      'score-trend?assessmentId=no',
      'score-trend?assessmentId=00000000-0000-0000-0000-000000000000&type=TEST',
      'summary?type=TEST&allTime=bad',
      'summary?type=TEST&from=bad',
      'summary?type=TEST&from=2026-01-01T00:00:00Z',
      'recap?timeZone=bad',
      'recap?timeZone=%20UTC%20',
    ])
      await compare(path, student);
    const window = 'from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z';
    for (const path of paths) {
      const sep = path.includes('?') ? '&' : '?';
      await compare(path + sep + window, student, 200);
    }
    for (const zone of [
      'UTC',
      'Z',
      'UT',
      'GMT',
      'Asia/Ho_Chi_Minh',
      'America/New_York',
      '+07:00',
      'UTC-05:30',
      'Europe/London',
    ])
      await compare('recap?timeZone=' + encodeURIComponent(zone), student, 200);
    for (const path of [
      'summary?type=TEST&allTime=true&from=2026-01-01T00:00:00Z',
      'assessment-history?page=99',
      'summary?type=DRILL&allTime=true',
      'performance?groupBy=DIFFICULTY&allTime=true',
      'next-practice?allTime=false',
    ])
      await compare(path, student, 200);
    async function post(path, body) {
      const response = await fetch(baseline + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + teacher.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      assert.ok(response.status < 300, path + ' ' + JSON.stringify(result));
      return result;
    }
    const bank = await post('/api/academic/question-banks', {
      name: 'Analytics ' + randomUUID(),
      scope: 'TEACHER',
    });
    const skills = [];
    for (const name of ['Zeta', 'alpha']) {
      const response = await fetch(baseline + '/api/academic/skills', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + admin.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, slug: 'analytics-' + randomUUID() }),
      });
      assert.equal(response.status, 201);
      skills.push(await response.json());
    }
    const q = await post('/api/academic/questions', {
      questionBankId: bank.id,
      questionType: 'MULTIPLE_CHOICE',
      difficulty: 'MEDIUM',
      skillIds: skills.map((s) => s.id),
      content: {
        title: 'Analytics',
        prompt: 'Pick',
        options: [
          { id: 'A', content: 'First' },
          { id: 'B', content: 'Second' },
        ],
      },
      answer: { correctOptionIds: ['A'] },
      explanation: { text: 'First' },
    });
    const pub = await post('/api/academic/questions/' + q.id + '/publish', {});
    const assessments = [];
    for (const type of ['TEST', 'DRILL', 'HOMEWORK']) {
      const a = await post('/api/assessments', {
        title: 'Analytics ' + type,
        type,
        releasePolicy: 'IMMEDIATE',
        accessMode: 'OPEN',
        timingMode: 'SOFT',
        maxAttempts: 50,
      });
      const s = await post('/api/assessments/' + a.id + '/sections', {
        name: 'Section',
        orderIndex: 1,
        durationSeconds: 600,
      });
      const m = await post('/api/assessments/sections/' + s.id + '/modules', {
        name: 'Module',
        orderIndex: 1,
      });
      const questions = [];
      for (let n = 1; n <= 6; n++)
        questions.push(
          await post('/api/assessments/modules/' + m.id + '/questions', {
            questionId: q.id,
            questionVersionId: pub.currentVersionId,
            position: n,
            points: n === 6 ? 2 : 1,
          }),
        );
      assessments.push({ ...a, questions });
    }
    let serial = 0;
    async function attempt(
      a,
      {
        user = student,
        status = 'SUBMITTED',
        grade = 1,
        max = 3,
        time = 100,
        grading = 'INCORRECT',
        at = '2026-02-01T12:00:00Z',
        result = true,
      } = {},
    ) {
      const id = randomUUID();
      await db.query(
        'INSERT INTO attempt(id,assessment_id,student_id,status,started_at,submitted_at,attempt_number) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          a.id,
          user.id,
          status,
          at,
          status === 'SUBMITTED' ? at : null,
          ++serial,
        ],
      );
      for (const aq of a.questions)
        await db.query(
          'INSERT INTO attempt_question(id,attempt_id,assessment_question_id,grading_status,points_earned) VALUES($1,$2,$3,$4,$5)',
          [
            randomUUID(),
            id,
            aq.id,
            grading,
            grading === 'CORRECT'
              ? aq.points
              : grading === 'PARTIALLY_CORRECT'
                ? 0.25
                : 0,
          ],
        );
      if (result)
        await db.query(
          "INSERT INTO results(id,attempt_id,total_grade,max_grade,total_time,grade_breakdown) VALUES($1,$2,$3,$4,$5,'{}')",
          [randomUUID(), id, grade, max, time],
        );
      return id;
    }
    const insufficient = await attempt({
      ...assessments[0],
      questions: assessments[0].questions.slice(0, 1),
    });
    assert.equal(
      (await compare('next-practice', student, 200)).noRecommendationReason,
      'INSUFFICIENT_DATA',
    );
    await attempt(assessments[0], {
      grade: 9,
      max: 10,
      grading: 'CORRECT',
      at: '2026-02-02T12:00:00Z',
    });
    assert.equal(
      (await compare('next-practice', student, 200)).hasRecommendation,
      true,
    );
    await attempt(assessments[0], { status: 'STARTED', result: false });
    await attempt(assessments[0], { grading: 'PENDING_REVIEW' });
    await attempt(assessments[0], { grading: 'UNGRADED' });
    await attempt(assessments[0], { result: false });
    await attempt(assessments[0], { max: 0, time: 0 });
    await attempt(assessments[0], { user: other, grade: 0, max: 1 });
    await attempt(assessments[1], { grading: 'PARTIALLY_CORRECT', time: 301 });
    await attempt(assessments[2], { time: -1, at: '2025-12-15T12:00:00Z' });
    for (const path of paths) {
      const sep = path.includes('?') ? '&' : '?';
      await compare(path + sep + window, student, 200);
      await compare(path + sep + 'allTime=true', student, 200);
    }
    for (const group of ['SKILL', 'TOPIC', 'DIFFICULTY'])
      await compare(
        'performance?groupBy=' + group + '&allTime=true',
        student,
        200,
      );
    for (const type of ['TEST', 'DRILL', 'HOMEWORK']) {
      await compare('summary?type=' + type + '&allTime=true', student, 200);
      await compare(
        'time-summary?type=' + type + '&allTime=true',
        student,
        200,
      );
      await compare('score-trend?type=' + type + '&allTime=true', student, 200);
    }
    for (const a of assessments)
      await compare(
        'score-trend?assessmentId=' + a.id + '&allTime=true',
        student,
        200,
      );
    for (const policy of ['MANUAL', 'AFTER_DEADLINE']) {
      await db.query(
        'UPDATE assessments SET release_policy=$2,results_release_at=$3 WHERE id=$1',
        [assessments[0].id, policy, '2099-01-01'],
      );
      for (const path of [
        'summary?type=TEST&allTime=true',
        'assessment-history',
        'performance?groupBy=SKILL&allTime=true',
        'time-summary?allTime=true',
        'next-practice',
      ])
        await compare(path, student, 200);
      await db.query(
        'UPDATE assessments SET results_released_at=$2,results_release_at=$2 WHERE id=$1',
        [assessments[0].id, '2020-01-01'],
      );
      await compare('summary?type=TEST&allTime=true', student, 200);
    }
    await db.query("UPDATE question SET status='ARCHIVED' WHERE id=$1", [q.id]);
    assert.equal(
      (await compare('next-practice', student, 200)).noRecommendationReason,
      'NO_AVAILABLE_QUESTIONS',
    );
    await compare('assessment-history?page=99&size=1', student, 200);
    await compare('assessment-history?size=2', student, 200);
    await compare('assessment-history?status=STARTED', student, 200);
    const tables = [
      'attempt',
      'attempt_question',
      'results',
      'assessments',
      'question_version',
    ];
    async function snapshot() {
      const values = [];
      for (const table of tables)
        values.push(
          (
            await db.query(
              `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
            )
          ).rows,
        );
      return values;
    }
    await db.query(
      "UPDATE attempt SET started_at='2026-02-01T12:00:00.123456Z', submitted_at='2026-02-01T12:00:00.123456Z' WHERE id=$1",
      [insufficient],
    );
    await compare('assessment-history', student, 200);
    await compare('score-trend?type=TEST&allTime=true', student, 200);
    await compare(
      'summary?type=TEST&from=2026-02-01T12:00:00.123455Z&to=2026-02-01T12:00:00.123457Z',
      student,
      200,
    );
    await compare(
      'recap?from=2026-02-01T12:00:00.123455Z&to=2026-02-01T12:00:00.123457Z',
      student,
      200,
    );
    await db.query(
      "UPDATE question_version SET snapshot=jsonb_set(jsonb_set(snapshot,'{skillIds}',$2::jsonb),'{difficulty}','null'::jsonb) WHERE id=$1",
      [
        pub.currentVersionId,
        JSON.stringify([skills[0].id, skills[0].id, randomUUID()]),
      ],
    );
    await compare('performance?groupBy=SKILL&allTime=true', student, 200);
    await compare('performance?groupBy=DIFFICULTY&allTime=true', student, 200);
    await db.query('UPDATE assessments SET deleted_at=NOW() WHERE id=$1', [
      assessments[0].id,
    ]);
    for (const path of [
      'assessment-history',
      'summary?type=TEST&allTime=true',
      'next-practice',
    ])
      await compare(path, student);
    await db.query('UPDATE assessments SET deleted_at=NULL WHERE id=$1', [
      assessments[0].id,
    ]);
    const before = await snapshot();
    for (const path of paths) await compare(path, student, 200);
    assert.deepEqual(
      await snapshot(),
      before,
      'Analytics must not mutate assessment data',
    );
    return count;
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_API_ENABLED;
    else process.env.ANALYTICS_API_ENABLED = previous;
  }
};
