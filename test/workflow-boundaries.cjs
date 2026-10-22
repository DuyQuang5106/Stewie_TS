const assert = require('node:assert/strict');
module.exports = async function workflowBoundaries({
  baseline,
  migrated,
  db,
  teacher,
  fixture,
  h,
  item,
  seed,
}) {
  assert.equal(
    new URL(db.options.connectionString).pathname,
    '/stiu_read_api_test',
  );
  const bank = await fixture('/question-banks', {
    name: 'Export boundary ' + Date.now(),
    scope: 'TEACHER',
  });
  async function seedQuestions(count) {
    const added = await db.query(
      `WITH source AS (SELECT to_jsonb(q) AS data FROM question q WHERE id=$1),
      generated AS (SELECT gen_random_uuid() AS id,n FROM generate_series(1,$3::int) n)
      INSERT INTO question SELECT (jsonb_populate_record(NULL::question,source.data||jsonb_build_object(
        'id',g.id,'question_bank_id',$2::text,'current_version_id',NULL,'status','DRAFT','previous_status',NULL,
        'version',0,'created_at',timestamp '2020-01-01'+g.n*interval '1 millisecond'))).* FROM source CROSS JOIN generated g RETURNING id`,
      [seed.id, bank.id, count],
    );
    await db.query(
      `INSERT INTO question_answer SELECT (jsonb_populate_record(NULL::question_answer,to_jsonb(a)||jsonb_build_object('question_id',t.id))).*
      FROM question_answer a CROSS JOIN unnest($2::uuid[]) t(id) WHERE a.question_id=$1`,
      [seed.id, added.rows.map((r) => r.id)],
    );
  }
  try {
    await seedQuestions(1000);
    const exported = await h.compare(
      'GET',
      '/question-exports?questionBankId=' + bank.id,
      undefined,
      teacher,
      200,
    );
    assert.equal(exported.questions.length, 1000);
    await seedQuestions(1);
    await h.compare(
      'GET',
      '/question-exports?questionBankId=' + bank.id,
      undefined,
      teacher,
      413,
    );
  } finally {
    await db.query(
      'DELETE FROM question_answer WHERE question_id IN (SELECT id FROM question WHERE question_bank_id=$1)',
      [bank.id],
    );
    await db.query('DELETE FROM question WHERE question_bank_id=$1', [bank.id]);
  }
  for (const server of [baseline, migrated]) {
    const batch = await fixture('/question-imports/validate', {
      schemaVersion: 1,
      importKey:
        'race-' + Date.now() + '-' + (server === baseline ? 'java' : 'ts'),
      targetQuestionBankId: bank.id,
      questions: [item, { ...item, externalId: 'second' }],
    });
    const before = Number(
      (
        await db.query(
          'SELECT count(*) FROM question WHERE question_bank_id=$1',
          [bank.id],
        )
      ).rows[0].count,
    );
    const blocker = await db.connect();
    const pending = [];
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM question_import_batch WHERE id=$1 FOR UPDATE',
        [batch.id],
      );
      for (let i = 0; i < 2; i++)
        pending.push(
          h.request(
            server,
            'POST',
            '/question-imports/' + batch.id + '/commit',
            undefined,
            teacher,
          ),
        );
      let bothWaiting = false;
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const n = Number(
          (
            await db.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE 'update question_import_batch%'",
            )
          ).rows[0].count,
        );
        if (n >= 2) {
          bothWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      await blocker.query('COMMIT');
      const responses = await Promise.all(pending);
      assert.ok(
        bothWaiting,
        'Force both commits past their initial read before releasing the batch row',
      );
      assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
      );
      const after = Number(
        (
          await db.query(
            'SELECT count(*) FROM question WHERE question_bank_id=$1',
            [bank.id],
          )
        ).rows[0].count,
      );
      assert.equal(
        after - before,
        4,
        'Current Java contract permits duplicate creation under simultaneous batch commits',
      );
      const lists = responses.map((r) => r.body.createdQuestionIds);
      assert.equal(new Set(lists.flat()).size, 4);
      const row = (
        await db.query(
          'SELECT status,created_question_ids FROM question_import_batch WHERE id=$1',
          [batch.id],
        )
      ).rows[0];
      assert.equal(row.status, 'COMMITTED');
      assert.equal(row.created_question_ids.length, 2);
      assert.ok(
        lists.some(
          (ids) =>
            JSON.stringify(ids) === JSON.stringify(row.created_question_ids),
        ),
      );
    } finally {
      await blocker.query('ROLLBACK');
      await Promise.allSettled(pending);
      blocker.release();
    }
  }
};
