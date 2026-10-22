const assert = require('node:assert/strict');
module.exports = async function takingBoundaries({
  h,
  db,
  baseline,
  migrated,
  student,
  teacher,
  assessment,
  fixture,
  app,
  DatabaseService,
  AssessmentExpiryService: ExpiryService,
}) {
  const { compare, request } = h;
  const login = await fetch(
    baseline +
      '/api/auth/dev-login?email=assessment.other@stewiesat.test&role=STUDENT',
    { method: 'POST' },
  );
  assert.equal(login.status, 200);
  const other = { token: (await login.json()).accessToken };
  const soft = await assessment();
  const started = await fixture('/' + soft.a.id + '/start', undefined, student),
    id = started.attemptId;
  for (const endpoint of [
    'resume',
    'clock',
    'current-section',
    'result',
    'review',
  ])
    await compare(
      'GET',
      '/attempts/' + id + '/' + endpoint,
      undefined,
      other,
      403,
    );
  await compare(
    'PUT',
    '/attempts/' + id + '/answers',
    { assessmentQuestionId: soft.questions[0].id, answerData: 'A' },
    other,
    403,
  );
  for (const body of [
    { entries: [] },
    { entries: [null] },
    { entries: [{}] },
    { entries: [{ assessmentQuestionId: soft.questions[0].id, seconds: -1 }] },
    {
      entries: [{ assessmentQuestionId: soft.questions[0].id, seconds: 86401 }],
    },
  ])
    await compare(
      'POST',
      '/attempts/' + id + '/question-time',
      body,
      student,
      400,
    );
  await db.query(
    "UPDATE attempt SET expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await compare(
    'PUT',
    '/attempts/' + id + '/answers',
    { assessmentQuestionId: soft.questions[0].id, answerData: 'A' },
    student,
    200,
  );
  await db.query(
    "UPDATE attempt SET expires_at=now()+interval '1 hour' WHERE id=$1",
    [id],
  );
  // Two submit requests serialize on the attempt lock and return the same result.
  for (const server of [baseline, migrated]) {
    const before = await h.snapshot();
    const blocker = await db.connect(),
      pending = [];
    try {
      await db.query('UPDATE attempt SET started_at=now() WHERE id=$1', [id]);
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM attempt WHERE id=$1 FOR UPDATE', [
        id,
      ]);
      for (let i = 0; i < 2; i++)
        pending.push(
          request(
            server,
            'POST',
            '/attempts/' + id + '/submit',
            undefined,
            student,
          ),
        );
      let waiting = false;
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const n = Number(
          (
            await db.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE '%from attempt %' AND lower(query) LIKE '%for %update%'",
            )
          ).rows[0].count,
        );
        if (n >= 2) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      await blocker.query('COMMIT');
      const results = await Promise.all(pending);
      assert.ok(waiting);
      assert.deepEqual(
        results.map((r) => r.status),
        [200, 200],
      );
      assert.equal(
        results[0].body.result.resultId,
        results[1].body.result.resultId,
      );
      assert.equal(
        Number(
          (
            await db.query('SELECT count(*) FROM results WHERE attempt_id=$1', [
              id,
            ])
          ).rows[0].count,
        ),
        1,
      );
    } finally {
      await blocker.query('ROLLBACK');
      await Promise.allSettled(pending);
      blocker.release();
      await h.restore(before);
    }
  }
  const strict = await assessment('STRICT', 'IMMEDIATE', true),
    run = await fixture('/' + strict.a.id + '/start', undefined, student),
    aid = run.attemptId;
  // A fixed reporting budget avoids spending sleep time to test clamping.
  await db.query(
    "UPDATE attempt SET started_at=now()-interval '30 seconds',time_reported_at=now()-interval '10 seconds' WHERE id=$1",
    [aid],
  );
  await db.query(
    "UPDATE attempt_section SET started_at=now()-interval '30 seconds' WHERE attempt_id=$1 AND status='IN_PROGRESS'",
    [aid],
  );
  await db.query(
    "UPDATE attempt_module SET started_at=now()-interval '30 seconds' WHERE attempt_id=$1 AND status='IN_PROGRESS'",
    [aid],
  );
  const report = await compare(
    'POST',
    '/attempts/' + aid + '/question-time',
    {
      entries: [{ assessmentQuestionId: strict.questions[0].id, seconds: 100 }],
    },
    student,
    200,
  );
  assert.ok(report.acceptedSeconds >= 10 && report.acceptedSeconds <= 11);
  await compare(
    'POST',
    '/attempts/' + aid + '/question-time',
    { entries: [{ assessmentQuestionId: strict.questions[1].id, seconds: 1 }] },
    student,
    409,
  );
  // Inject a failure after answer persistence; the entire aggregate must roll back.
  const before = await h.snapshot(),
    service = app.get(DatabaseService),
    original = service.writeTransaction.bind(service);
  service.writeTransaction = (work, domain) =>
    original(
      (client) =>
        work(
          new Proxy(client, {
            get(target, key) {
              if (key === 'query')
                return (...args) => {
                  if (/^UPDATE attempt SET last_activity_at/i.test(args[0]))
                    throw new Error('Injected late answer failure');
                  return target.query(...args);
                };
              return Reflect.get(target, key);
            },
          }),
        ),
      domain,
    );
  try {
    assert.equal(
      (
        await request(
          migrated,
          'PUT',
          '/attempts/' + aid + '/answers',
          { assessmentQuestionId: strict.questions[0].id, answerData: 'B' },
          student,
        )
      ).status,
      500,
    );
    assert.deepEqual(await h.snapshot(), before);
  } finally {
    service.writeTransaction = original;
  }
  await compare(
    'POST',
    '/' + strict.a.id + '/start',
    { __rawJson: '{' },
    student,
    500,
  );
  const oldDeadline = new Date(Date.now() + 30000),
    newDeadline = new Date(Date.now() + 3600000);
  await db.query('UPDATE assessments SET available_until=$2 WHERE id=$1', [
    strict.a.id,
    oldDeadline,
  ]);
  await db.query('UPDATE attempt SET expires_at=$2 WHERE id=$1', [
    aid,
    oldDeadline,
  ]);
  await db.query(
    "UPDATE attempt_section SET expires_at=$2 WHERE attempt_id=$1 AND status='IN_PROGRESS'",
    [aid, oldDeadline],
  );
  await db.query(
    "UPDATE attempt_module SET expires_at=$2 WHERE attempt_id=$1 AND status='IN_PROGRESS'",
    [aid, oldDeadline],
  );
  const extension = {
    title: strict.a.title,
    type: 'TEST',
    releasePolicy: 'IMMEDIATE',
    accessMode: 'OPEN',
    availableUntil: newDeadline.toISOString(),
  };
  await compare('PUT', '/' + strict.a.id, extension, teacher, 200);
  const restored = (
    await db.query(
      "SELECT started_at,expires_at FROM attempt_module WHERE attempt_id=$1 AND status='IN_PROGRESS'",
      [aid],
    )
  ).rows[0];
  assert.equal(
    restored.expires_at.getTime() - restored.started_at.getTime(),
    300000,
    'Extending a hard deadline restores the module timer only up to its original duration',
  );
  await compare('GET', '/attempts/' + aid + '/clock', undefined, student, 200);
  await compare('PUT', '/' + strict.a.id, extension, teacher, 200);
  const { AssessmentExpiryService } = ExpiryService
    ? { AssessmentExpiryService: ExpiryService }
    : await import('../dist/assessment/expiry.service.js');
  const worker = app.get(AssessmentExpiryService),
    oldScheduler = process.env.ASSESSMENT_SCHEDULER_ENABLED;
  process.env.ASSESSMENT_SCHEDULER_ENABLED = 'true';
  const workerBefore = await h.snapshot();
  try {
    const deadline = new Date(Date.now() - 6000);
    await db.query(
      "UPDATE attempt_module SET expires_at=$2 WHERE attempt_id=$1 AND status='IN_PROGRESS'",
      [aid, deadline],
    );
    await worker.runExpiry(new Date());
    const modules = (
        await db.query(
          'SELECT * FROM attempt_module WHERE attempt_id=$1 ORDER BY module_id',
          [aid],
        )
      ).rows,
      closed = modules.find((m) => m.module_id === strict.modules[0].id),
      active = modules.find((m) => m.module_id === strict.modules[1].id);
    assert.equal(closed.status, 'EXPIRED');
    assert.equal(closed.completed_at.toISOString(), deadline.toISOString());
    assert.equal(active.status, 'IN_PROGRESS');
    assert.equal(
      active.started_at.toISOString(),
      deadline.toISOString(),
      'No free extra module time when the runner is absent',
    );
    await db.query(
      "UPDATE attempt SET expires_at=now()-interval '6 seconds' WHERE id=$1",
      [aid],
    );
    await worker.runExpiry(new Date());
    assert.equal(
      (
        await db.query('SELECT submission_reason FROM attempt WHERE id=$1', [
          aid,
        ])
      ).rows[0].submission_reason,
      'DEADLINE_EXPIRED',
    );
    assert.equal(
      Number(
        (
          await db.query('SELECT count(*) FROM results WHERE attempt_id=$1', [
            aid,
          ])
        ).rows[0].count,
      ),
      1,
    );
    await worker.runExpiry(new Date());
    assert.equal(
      Number(
        (
          await db.query('SELECT count(*) FROM results WHERE attempt_id=$1', [
            aid,
          ])
        ).rows[0].count,
      ),
      1,
    );
    await h.restore(workerBefore);
    await db.query(
      "UPDATE attempt SET expires_at=now()-interval '6 seconds' WHERE id=$1",
      [aid],
    );
    const blocker = await db.connect();
    let sweep;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM attempt WHERE id=$1 FOR UPDATE', [
        aid,
      ]);
      const future = new Date(Date.now() + 3600000);
      await blocker.query('UPDATE attempt SET expires_at=$2 WHERE id=$1', [
        aid,
        future,
      ]);
      sweep = worker.runExpiry(new Date());
      let waiting = false;
      const until = Date.now() + 1800;
      while (Date.now() < until) {
        const count = Number(
          (
            await db.query(
              "SELECT count(*) FROM pg_stat_activity WHERE application_name='stiu-api-ts' AND datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE 'select * from attempt where id=%for update' ",
            )
          ).rows[0].count,
        );
        if (count > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.ok(
        waiting,
        'Worker must read the old deadline before blocking on the attempt lock',
      );
      await blocker.query('COMMIT');
      await sweep;
      const row = (
        await db.query('SELECT status,expires_at FROM attempt WHERE id=$1', [
          aid,
        ])
      ).rows[0];
      assert.equal(row.status, 'STARTED');
      assert.equal(row.expires_at.toISOString(), future.toISOString());
      assert.equal(
        Number(
          (
            await db.query('SELECT count(*) FROM results WHERE attempt_id=$1', [
              aid,
            ])
          ).rows[0].count,
        ),
        0,
        'Stale scheduler candidate cannot submit an extended attempt',
      );
    } finally {
      await blocker.query('ROLLBACK');
      if (sweep) await sweep;
      blocker.release();
    }
  } finally {
    await h.restore(workerBefore);
    if (oldScheduler === undefined)
      delete process.env.ASSESSMENT_SCHEDULER_ENABLED;
    else process.env.ASSESSMENT_SCHEDULER_ENABLED = oldScheduler;
  }
};
