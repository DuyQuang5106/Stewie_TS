const assert = require('node:assert/strict');
module.exports = async function vocabularyBoundaries({
  h,
  db,
  student,
  teacher,
  word,
  playlist,
  baseline,
  migrated,
}) {
  const { compare, request } = h;
  for (const patch of [
    { name: '\u00a0' },
    { name: '\u2003' },
    { name: 'x'.repeat(120) },
    { name: '\u0001' },
  ])
    await compare('POST', '/playlists', patch, student);
  for (const value of ['on', 'yes', '0', 'TRUE', '', null, {}, []])
    await compare(
      'POST',
      '/words/' + word.id + '/reviews',
      { knewIt: value },
      student,
    );
  for (const query of [
    '?q=%5C',
    '?q=_',
    '?q=%25',
    '?learned=false&due=on',
    '?maxBox=-1',
    '?size=0&page=-1',
    '?sort=term,desc&sort=id,asc',
    '?sort=nextReviewAt,desc',
    '?maxBox=2147483648',
  ])
    await compare(
      'GET',
      '/playlists/' + playlist.id + '/words' + query,
      undefined,
      student,
    );
  await db.query(
    "UPDATE vocab_words SET next_review_at='2026-01-01T03:04:05.123456Z',box=1 WHERE id=$1",
    [word.id],
  );
  const micro = await compare(
    'POST',
    '/words/' + word.id + '/reviews',
    { knewIt: true },
    student,
    201,
  );
  await compare(
    'DELETE',
    '/reviews/' + micro.reviewId,
    undefined,
    student,
    200,
  );
  assert.equal(
    (
      await db.query(
        'SELECT next_review_at::text AS time FROM vocab_words WHERE id=$1',
        [word.id],
      )
    ).rows[0].time,
    '2026-01-01 03:04:05.123456+00',
  );
  for (const box of [1, 2, 3, 4, null]) {
    await db.query(
      "UPDATE vocab_words SET box=$2,next_review_at=CASE WHEN $2::int IS NULL THEN NULL ELSE '2026-01-01T00:00:00Z'::timestamptz END WHERE id=$1",
      [word.id, box],
    );
    for (const knewIt of [true, false])
      await compare(
        'POST',
        '/words/' + word.id + '/reviews',
        { knewIt },
        student,
        201,
        'America/New_York',
      );
  }
  await compare('GET', '/due', undefined, student, 200);
  await compare('GET', '/playlists', undefined, student, 200);
  for (const zone of [
    'Z',
    '+05:30',
    'UTC-04:00',
    'GMT+14:00',
    '-12:00',
    'america/new_york',
    'PST',
  ])
    await compare(
      'POST',
      '/playlists/' + playlist.id + '/words',
      { term: 'zone-' + zone + '-' + Date.now(), meaning: 'Timezone' },
      student,
      201,
      zone,
    );
  for (const server of [baseline, migrated]) {
    const before = await h.snapshot(),
      version = Number(
        (
          await db.query('SELECT version FROM vocab_words WHERE id=$1', [
            word.id,
          ])
        ).rows[0].version,
      ),
      reviews = before.vocab_reviews.length;
    const blocker = await db.connect(),
      pending = [];
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM vocab_words WHERE id=$1 FOR NO KEY UPDATE',
        [word.id],
      );
      for (let i = 0; i < 2; i++)
        pending.push(
          request(
            server,
            'POST',
            '/words/' + word.id + '/reviews',
            { knewIt: true },
            student,
          ),
        );
      let waiting = false;
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const n = Number(
          (
            await db.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE 'update vocab_words%'",
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
      assert.ok(waiting, 'Force both reviews to load the same word version');
      assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
      const after = await h.snapshot();
      assert.equal(
        after.vocab_reviews.length,
        reviews + 1,
        'Losing optimistic review must roll back its review row',
      );
      assert.equal(
        Number(after.vocab_words.find((x) => x.id === word.id).version),
        version + 1,
      );
    } finally {
      await blocker.query('ROLLBACK');
      await Promise.allSettled(pending);
      blocker.release();
      await h.restore(before);
    }
  }
  // Ownership is concealed as 404 for every authenticated foreign user.
  await compare(
    'DELETE',
    '/reviews/00000000-0000-0000-0000-000000000000',
    undefined,
    teacher,
    404,
  );
};
