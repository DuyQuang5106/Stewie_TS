/* Local HTTP smoke only: creates tagged fixtures, never resets or directly changes DB. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.LOCAL_API_BASE_URL || 'http://127.0.0.1:3001';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw Error('Loopback only');
const prefix = 'local-smoke-' + Date.now(),
  cases = [],
  fixtures = {},
  routes = [];
function scan(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) scan(p);
    else if (f.name.endsWith('.controller.ts')) {
      let root = '';
      for (const m of fs
        .readFileSync(p, 'utf8')
        .matchAll(/@(Controller|Get|Post|Put|Delete|Patch)\(([^)]*)\)/g)) {
        const args = [...m[2].matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1]);
        if (m[1] === 'Controller') root = args[0] || '';
        else
          for (const part of args.length ? args : [''])
            routes.push({
              method: m[1].toUpperCase(),
              route:
                ('/' + root + '/' + part)
                  .replace(/\/+/g, '/')
                  .replace(/\/$/, '') || '/',
            });
      }
    }
  }
}
scan('src');
async function send(
  method,
  url,
  user,
  body,
  expected = method === 'POST' ? 201 : 200,
) {
  const start = Date.now();
  try {
    const r = await fetch(base + url, {
      method,
      headers: {
        ...(user ? { Authorization: 'Bearer ' + user.accessToken } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined && !['GET', 'HEAD'].includes(method)
        ? { body: JSON.stringify(body) }
        : {}),
      signal: AbortSignal.timeout(20000),
      redirect: 'manual',
    });
    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    const allowed = Array.isArray(expected) ? expected : [expected];
    const ok = allowed.includes(r.status);
    cases.push({
      method,
      path: url,
      status: r.status,
      expected: allowed,
      ok,
      ms: Date.now() - start,
      ...(!ok
        ? {
            error:
              typeof data === 'object'
                ? data.message
                : String(data).slice(0, 200),
          }
        : {}),
    });
    if (!ok)
      throw Error(
        method +
          ' ' +
          url +
          ' expected ' +
          allowed +
          ' got ' +
          r.status +
          ' ' +
          JSON.stringify(data).slice(0, 250),
      );
    return data;
  } catch (e) {
    if (!cases.length || cases.at(-1).path !== url)
      cases.push({ method, path: url, ok: false, error: e.message });
    throw e;
  }
}
async function group(name, work) {
  try {
    await work();
    console.log('PASS ' + name);
  } catch (e) {
    cases.push({ group: name, ok: false, error: e.message });
    console.log('FAIL ' + name + ': ' + e.message);
  }
}
(async () => {
  await send('GET', '/');
  await send('GET', '/health/live');
  await send('GET', '/health/ready');
  const users = {};
  for (const role of ['ADMIN', 'TEACHER', 'STUDENT']) {
    const email = prefix + '.' + role.toLowerCase() + '@stewiesat.test';
    users[role] = await send(
      'POST',
      '/api/auth/dev-login?email=' + email + '&role=' + role,
      undefined,
      undefined,
      200,
    );
    users[role].email = email;
    users[role].id = JSON.parse(
      Buffer.from(users[role].accessToken.split('.')[1], 'base64url'),
    ).sub;
  }
  const a = users.ADMIN,
    t = users.TEACHER,
    s = users.STUDENT;
  for (const route of routes) {
    if (
      !route.route.startsWith('/api/') ||
      route.route.startsWith('/api/auth/')
    )
      continue;
    await send(
      route.method,
      route.route.replace(/:[\w]+/g, '00000000-0000-0000-0000-000000000000'),
      undefined,
      ['POST', 'PUT', 'PATCH'].includes(route.method) ? {} : undefined,
      401,
    );
  }
  await group('Identity', async () => {
    for (const p of [
      '/api/users/me',
      '/api/users/all?sort=id,asc',
      '/api/users/' + s.id,
      '/api/users/by-email?email=' + encodeURIComponent(s.email),
    ])
      await send('GET', p, a);
    await send('GET', '/api/users/all', s, undefined, 403);
  });
  await group('Academic catalog', async () => {
    for (const kind of ['topics', 'skills']) {
      let item = await send('POST', '/api/academic/' + kind, a, {
        name: prefix + ' ' + kind,
        slug: prefix + '-' + kind,
      });
      fixtures[kind] = item;
      await send('GET', '/api/academic/' + kind, a);
      await send('PUT', '/api/academic/' + kind + '/' + item.id, a, {
        name: prefix + ' updated ' + kind,
        slug: prefix + '-' + kind,
      });
      for (const op of ['archive', 'restore'])
        await send(
          'POST',
          '/api/academic/' + kind + '/' + item.id + '/' + op,
          a,
          undefined,
          200,
        );
    }
    const g = await send('POST', '/api/academic/tag-groups', a, {
      name: prefix,
      code: prefix,
    });
    fixtures.group = g;
    await send('PUT', '/api/academic/tag-groups/' + g.id, a, {
      name: prefix + ' updated',
      code: prefix,
    });
    const tag = await send('POST', '/api/academic/tags', a, {
      name: prefix,
      slug: prefix,
      tagGroupId: g.id,
    });
    fixtures.tag = tag;
    await send('PUT', '/api/academic/tags/' + tag.id, a, {
      name: prefix + ' updated',
      slug: prefix,
      tagGroupId: g.id,
    });
    for (const p of [
      '/tag-groups',
      '/tag-groups/' + g.id,
      '/tags/' + tag.id,
      '/tag-groups/' + g.id + '/tags',
      '/tags/by-group/' + g.id,
    ])
      await send('GET', '/api/academic' + p, t);
  });
  await group('Stimulus and bank', async () => {
    const stimulus = await send('POST', '/api/academic/stimuli', t, {
      title: prefix,
      content: { text: 'Local passage' },
    });
    fixtures.stimulus = stimulus;
    await send('PUT', '/api/academic/stimuli/' + stimulus.id, t, {
      title: prefix + ' updated',
      content: { text: 'Updated passage' },
    });
    for (const action of ['publish', 'archive', 'restore'])
      await send(
        'POST',
        '/api/academic/stimuli/' + stimulus.id + '/' + action,
        t,
        undefined,
        200,
      );
    for (const p of ['/stimuli', '/stimuli/' + stimulus.id])
      await send('GET', '/api/academic' + p, t);
    const bank = await send('POST', '/api/academic/question-banks', t, {
      name: prefix,
      scope: 'TEACHER',
    });
    fixtures.bank = bank;
    await send('PUT', '/api/academic/question-banks/' + bank.id, t, {
      name: prefix + ' updated',
      description: 'Local smoke',
    });
    for (const action of ['archive', 'restore'])
      await send(
        'POST',
        '/api/academic/question-banks/' + bank.id + '/' + action,
        t,
        undefined,
        200,
      );
    for (const p of ['/question-banks', '/question-banks/' + bank.id])
      await send('GET', '/api/academic' + p, t);
  });
  const questionBody = {
    questionType: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    content: {
      title: 'Local question',
      prompt: 'What is 1 + 1?',
      options: [
        { id: 'A', content: '2' },
        { id: 'B', content: '3' },
      ],
    },
    answer: { correctOptionIds: ['A'] },
    explanation: { text: 'Two' },
  };
  await group('Question lifecycle and review', async () => {
    assert.ok(fixtures.bank);
    const body = { ...questionBody, questionBankId: fixtures.bank.id };
    const q = await send('POST', '/api/academic/questions', t, body);
    fixtures.question = q;
    await send('PUT', '/api/academic/questions/' + q.id, t, body);
    const pub = await send(
      'POST',
      '/api/academic/questions/' + q.id + '/publish',
      t,
      {},
      200,
    );
    fixtures.version = pub.currentVersionId;
    for (const p of [
      '/questions',
      '/public/questions',
      '/questions/' + q.id,
      '/questions/' + q.id + '/versions',
    ])
      await send('GET', '/api/academic' + p, t);
    await send(
      'POST',
      '/api/academic/question-versions/' + pub.currentVersionId + '/reviews',
      a,
      { status: 'APPROVED', comment: 'Local smoke review' },
    );
    for (const p of [
      '/question-reviews',
      '/question-versions/' + pub.currentVersionId + '/reviews',
    ])
      await send('GET', '/api/academic' + p, a);
    const copy = await send(
      'POST',
      '/api/academic/questions/' + q.id + '/duplicate',
      t,
      { targetQuestionBankId: fixtures.bank.id },
    );
    for (const action of ['archive', 'restore'])
      await send(
        'POST',
        '/api/academic/questions/' + copy.id + '/' + action,
        t,
        undefined,
        200,
      );
    await send(
      'POST',
      '/api/academic/questions/' + q.id + '/revise',
      t,
      undefined,
      200,
    );
    await send(
      'POST',
      '/api/academic/questions/' + q.id + '/publish',
      t,
      {},
      200,
    );
    const targetBank = await send('POST', '/api/academic/question-banks', t, {
      name: prefix + ' target',
      scope: 'TEACHER',
    });
    await send(
      'POST',
      '/api/academic/questions/' + copy.id + '/transfer-ownership',
      a,
      { targetQuestionBankId: targetBank.id, reason: 'Local smoke' },
      200,
    );
  });
  await group('Import/export', async () => {
    const batch = await send(
      'POST',
      '/api/academic/question-imports/validate',
      t,
      {
        schemaVersion: 1,
        importKey: prefix,
        targetQuestionBankId: fixtures.bank.id,
        questions: [{ ...questionBody, externalId: 'one' }],
      },
    );
    fixtures.batch = batch;
    await send('GET', '/api/academic/question-imports/' + batch.id, t);
    await send(
      'POST',
      '/api/academic/question-imports/' + batch.id + '/commit',
      t,
      undefined,
      200,
    );
    await send(
      'GET',
      '/api/academic/question-exports?questionBankId=' + fixtures.bank.id,
      t,
    );
  });
  await group('Vocabulary', async () => {
    const playlist = await send('POST', '/api/vocab/playlists', s, {
      name: prefix,
    });
    fixtures.playlist = playlist;
    const word = await send(
      'POST',
      '/api/vocab/playlists/' + playlist.id + '/words',
      s,
      { term: 'example', meaning: 'A sample', example: 'An example sentence' },
    );
    for (const p of [
      '/playlists',
      '/playlists/' + playlist.id,
      '/playlists/' + playlist.id + '/words',
      '/due',
      '/streak',
    ])
      await send('GET', '/api/vocab' + p, s);
    await send('GET', '/api/vocab/playlists/' + playlist.id, t, undefined, 404);
    const review = await send(
      'POST',
      '/api/vocab/words/' + word.id + '/reviews',
      s,
      { knewIt: true },
    );
    await send(
      'DELETE',
      '/api/vocab/reviews/' + review.reviewId,
      s,
      undefined,
      200,
    );
    await send(
      'GET',
      '/api/vocab/lookup?term=example',
      s,
      undefined,
      [200, 503],
    );
  });
  await group('Assessment authoring/taking/results', async () => {
    const test = await send('POST', '/api/assessments', t, {
      title: prefix,
      type: 'TEST',
      releasePolicy: 'MANUAL',
      accessMode: 'OPEN',
      timingMode: 'SOFT',
      maxAttempts: 3,
    });
    fixtures.assessment = test;
    await send('PUT', '/api/assessments/' + test.id, t, {
      title: prefix + ' updated',
      type: 'TEST',
      releasePolicy: 'MANUAL',
      accessMode: 'OPEN',
      timingMode: 'SOFT',
      maxAttempts: 3,
    });
    const section = await send(
      'POST',
      '/api/assessments/' + test.id + '/sections',
      t,
      { name: 'Section', orderIndex: 1, durationSeconds: 600 },
    );
    const module = await send(
      'POST',
      '/api/assessments/sections/' + section.id + '/modules',
      t,
      { name: 'Module', orderIndex: 1 },
    );
    const q = await send(
      'POST',
      '/api/assessments/modules/' + module.id + '/questions',
      t,
      {
        questionId: fixtures.question.id,
        questionVersionId: fixtures.version,
        position: 1,
        points: 1,
      },
    );
    await send(
      'POST',
      '/api/assessments/' + test.id + '/publish',
      t,
      undefined,
      200,
    );
    await send('POST', '/api/assessments/' + test.id + '/clone', t);
    await send('PUT', '/api/assessments/' + test.id + '/access-mode', t, {
      accessMode: 'OPEN',
    });
    await send('POST', '/api/assessments/' + test.id + '/assign', t, {
      studentId: s.id,
    });
    for (const p of ['/api/assessments', '/api/assessments/' + test.id])
      await send('GET', p, t);
    for (const p of [
      '/my-assignments',
      '/catalog',
      '/catalog/facets',
      '/catalog/' + test.id,
      '/my-attempts',
      '/my-stats',
    ])
      await send('GET', '/api/assessments' + p, s);
    await send(
      'POST',
      '/api/assessments',
      s,
      {
        title: 'Forbidden',
        type: 'TEST',
        releasePolicy: 'IMMEDIATE',
        accessMode: 'OPEN',
        timingMode: 'SOFT',
      },
      403,
    );
    const attempt = await send(
      'POST',
      '/api/assessments/' + test.id + '/start',
      s,
      { timed: false },
    );
    fixtures.attempt = attempt.attemptId;
    for (const action of ['resume', 'clock'])
      await send(
        'GET',
        '/api/assessments/attempts/' + attempt.attemptId + '/' + action,
        s,
      );
    await send(
      'PUT',
      '/api/assessments/attempts/' + attempt.attemptId + '/answers',
      s,
      { assessmentQuestionId: q.id, answerData: 'A' },
    );
    await send(
      'PUT',
      '/api/assessments/attempts/' + attempt.attemptId + '/flag',
      s,
      { assessmentQuestionId: q.id, isFlagged: true },
    );
    await send(
      'POST',
      '/api/assessments/attempts/' + attempt.attemptId + '/question-time',
      s,
      { entries: [{ assessmentQuestionId: q.id, seconds: 1 }] },
      409,
    );
    await send(
      'POST',
      '/api/assessments/attempts/' + attempt.attemptId + '/submit',
      s,
      undefined,
      200,
    );
    await send(
      'POST',
      '/api/assessments/' + test.id + '/release-results',
      t,
      undefined,
      200,
    );
    const result = await send(
      'GET',
      '/api/assessments/attempts/' + attempt.attemptId + '/result',
      s,
    );
    assert.equal(result.resultAvailable, true);
    assert.equal(result.result.totalGrade, 1, 'Correct answer must score 1');
    assert.equal(result.result.maxGrade, 1);
    await send(
      'GET',
      '/api/assessments/attempts/' + attempt.attemptId + '/review',
      s,
    );
    await send('GET', '/api/assessments/' + test.id + '/submissions', t);
    await send(
      'POST',
      '/api/assessments/' + test.id + '/close',
      t,
      undefined,
      200,
    );
  });
  await group('STRICT section/module lifecycle', async () => {
    const test = await send('POST', '/api/assessments', t, {
      title: prefix + ' strict',
      type: 'TEST',
      releasePolicy: 'IMMEDIATE',
      accessMode: 'OPEN',
      timingMode: 'STRICT',
      maxAttempts: 3,
    });
    const parts = [];
    for (let i = 1; i <= 2; i++) {
      const section = await send(
        'POST',
        '/api/assessments/' + test.id + '/sections',
        t,
        { name: 'Section ' + i, orderIndex: i, durationSeconds: 600 },
      );
      const module = await send(
        'POST',
        '/api/assessments/sections/' + section.id + '/modules',
        t,
        { name: 'Module', orderIndex: 1, durationSeconds: 300 },
      );
      const aq = await send(
        'POST',
        '/api/assessments/modules/' + module.id + '/questions',
        t,
        {
          questionId: fixtures.question.id,
          questionVersionId: fixtures.version,
          position: 1,
          points: 1,
        },
      );
      parts.push({ section, module, question: aq });
    }
    await send(
      'POST',
      '/api/assessments/' + test.id + '/publish',
      t,
      undefined,
      200,
    );
    const attempt = await send(
      'POST',
      '/api/assessments/' + test.id + '/start',
      s,
    );
    const url = '/api/assessments/attempts/' + attempt.attemptId;
    await send('GET', url + '/current-section', s);
    await send(
      'POST',
      url + '/question-time',
      s,
      { entries: [{ assessmentQuestionId: parts[0].question.id, seconds: 1 }] },
      200,
    );
    await send(
      'POST',
      url + '/modules/' + parts[0].module.id + '/complete',
      s,
      undefined,
      200,
    );
    await send(
      'POST',
      url + '/sections/' + parts[0].section.id + '/complete',
      s,
      undefined,
      200,
    );
    await send(
      'POST',
      url + '/sections/' + parts[1].section.id + '/start',
      s,
      undefined,
      200,
    );
    await send(
      'POST',
      url + '/sections/' + parts[1].section.id + '/complete',
      s,
      undefined,
      200,
    );
    await send('GET', url + '/result', s);
  });
  await group('Analytics', async () => {
    for (const p of [
      'assessment-history',
      'summary?type=TEST&allTime=true',
      'performance?groupBy=SKILL&allTime=true',
      'score-trend?type=TEST&allTime=true',
      'time-summary?allTime=true',
      'recap',
      'next-practice',
    ])
      await send('GET', '/api/analytics/me/' + p, s);
    await send('GET', '/api/analytics/me/summary?type=TEST', t, undefined, 403);
  });
  await group('Auth refresh/replay/logout', async () => {
    const auth = await send(
      'POST',
      '/api/auth/dev-login?email=' +
        prefix +
        '.session@stewiesat.test&role=STUDENT',
      undefined,
      undefined,
      200,
    );
    const rotated = await send(
      'POST',
      '/api/auth/refresh',
      undefined,
      { refreshToken: auth.refreshToken },
      200,
    );
    await send(
      'POST',
      '/api/auth/refresh',
      undefined,
      { refreshToken: auth.refreshToken },
      401,
    );
    await send(
      'POST',
      '/api/auth/refresh',
      undefined,
      { refreshToken: rotated.refreshToken },
      401,
    );
    await send('POST', '/api/auth/logout', undefined, {}, 204);
    await send('POST', '/api/auth/refresh', undefined, {}, 400);
  });
  await group('Remove temporary tags only', async () => {
    if (fixtures.tag)
      await send(
        'DELETE',
        '/api/academic/tags/' + fixtures.tag.id,
        a,
        undefined,
        204,
      );
    if (fixtures.group)
      await send(
        'DELETE',
        '/api/academic/tag-groups/' + fixtures.group.id,
        a,
        undefined,
        204,
      );
  });
  for (const p of ['/oauth2/authorization/google', '/login/oauth2/code/google'])
    await send('GET', p, undefined, undefined, 404);
})()
  .catch((e) => cases.push({ fatal: true, ok: false, error: e.message }))
  .finally(() => {
    fs.mkdirSync('.temp', { recursive: true });
    const covered = new Set();
    for (const c of cases.filter(
      (c) => c.ok && c.status >= 200 && c.status < 300,
    )) {
      const matches = routes
        .filter(
          (r) =>
            c.method === r.method &&
            new RegExp('^' + r.route.replace(/:[\w]+/g, '[^/]+') + '$').test(
              c.path?.split('?')[0],
            ),
        )
        .sort(
          (a, b) =>
            a.route.split('/').filter((s) => s && !s.startsWith(':')).length -
            b.route.split('/').filter((s) => s && !s.startsWith(':')).length,
        );
      const match = matches.at(-1);
      if (match) covered.add(match.method + ' ' + match.route);
    }
    const successRoutes = routes.filter((r) =>
      covered.has(r.method + ' ' + r.route),
    );
    const report = {
      base,
      prefix,
      createdAt: new Date().toISOString(),
      total: cases.length,
      passed: cases.filter((c) => c.ok).length,
      failed: cases.filter((c) => !c.ok).length,
      inventoriedRoutes: routes.length,
      successRouteCount: successRoutes.length,
      routesWithoutSuccess: routes.filter((r) => !successRoutes.includes(r)),
      disabled: [
        'Google OAuth on local .env',
        'Assessment expiry scheduler',
        'Auth cleanup scheduler',
      ],
      fixtures,
      cases,
    };
    fs.writeFileSync(
      '.temp/local-api-report.json',
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        total: report.total,
        passed: report.passed,
        failed: report.failed,
        routes: routes.length,
        happyRouteCount: successRoutes.length,
        report: '.temp/local-api-report.json',
      }),
    );
    if (report.failed) process.exitCode = 1;
  });
