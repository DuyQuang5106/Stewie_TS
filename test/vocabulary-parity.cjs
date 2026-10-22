const assert = require('node:assert/strict');
const http = require('node:http');
module.exports = async function vocabularyParity({
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
    prefix: '/api/vocab',
    tables: ['vocab_playlists', 'vocab_words', 'vocab_reviews'],
  });
  const { compare, request } = h;
  const old = process.env.VOCABULARY_API_ENABLED;
  const oldDictionary = process.env.DICTIONARY_BASE_URL;
  const stub = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const term = decodeURIComponent(req.url.slice(1));
    if (term === 'missing') {
      res.statusCode = 404;
      return res.end('{}');
    }
    if (term === 'broken') {
      res.statusCode = 500;
      return res.end('{}');
    }
    return res.end(
      JSON.stringify([
        {
          word: term,
          meanings: [
            {
              definitions: [
                { definition: ' Definition ' },
                { definition: 'Other', example: ' Example ' },
              ],
            },
          ],
        },
      ]),
    );
  });
  await new Promise((resolve) => stub.listen(18082, '127.0.0.1', resolve));
  process.env.DICTIONARY_BASE_URL = 'http://127.0.0.1:18082';
  try {
    process.env.VOCABULARY_API_ENABLED = 'false';
    assert.equal(
      (await request(migrated, 'GET', '/playlists', undefined, student)).status,
      404,
    );
    process.env.VOCABULARY_API_ENABLED = 'true';
    for (const user of [admin, teacher, student, null])
      for (const path of ['/playlists', '/due', '/streak'])
        await compare('GET', path, undefined, user, user ? 200 : 401);
    for (const body of [
      {},
      null,
      [],
      { name: '' },
      { name: 'x'.repeat(121) },
      { name: 123 },
      { name: '  Personal  ' },
    ])
      await compare('POST', '/playlists', body, student);
    const playlist = await compare(
      'POST',
      '/playlists',
      { name: 'Vocabulary ' + Date.now() },
      student,
      201,
    );
    await compare(
      'POST',
      '/playlists',
      { name: playlist.name.toUpperCase() },
      student,
      409,
    );
    const missing = '00000000-0000-0000-0000-000000000000';
    for (const id of [playlist.id, missing, 'invalid'])
      for (const user of [student, teacher])
        await compare('GET', '/playlists/' + id, undefined, user);
    for (const body of [
      {},
      { term: '', meaning: '' },
      { term: 'one', meaning: 'Meaning', example: 'x'.repeat(2001) },
      { term: 'x'.repeat(201), meaning: 'Meaning' },
      { term: ' Test ', meaning: ' Meaning ', example: '  ' },
    ])
      await compare(
        'POST',
        '/playlists/' + playlist.id + '/words',
        body,
        student,
      );
    const word = await compare(
      'POST',
      '/playlists/' + playlist.id + '/words',
      { term: 'Example', meaning: 'Meaning', example: 'Sample' },
      student,
      201,
      'America/New_York',
    );
    await compare(
      'POST',
      '/playlists/' + playlist.id + '/words',
      { term: 'EXAMPLE', meaning: 'Another' },
      student,
      409,
    );
    await compare(
      'POST',
      '/playlists/' + playlist.id + '/words',
      { term: 'Private', meaning: 'Meaning' },
      teacher,
      404,
    );
    for (const query of [
      '',
      '?size=1',
      '?page=99&size=1',
      '?sort=box,nextReviewAt',
      '?sort=term,desc,ignorecase',
      '?sort=invalid',
      '?due=true',
      '?learned=true',
      '?maxBox=2',
      '?q=meaning',
      '?q=%25',
      '?maxBox=bad',
      '?due=bad',
    ])
      await compare(
        'GET',
        '/playlists/' + playlist.id + '/words' + query,
        undefined,
        student,
      );
    for (const zone of [
      'UTC',
      'Asia/Ho_Chi_Minh',
      'America/New_York',
      'Pacific/Kiritimati',
      'invalid',
    ])
      for (const path of [
        '/due',
        '/streak',
        '/playlists',
        '/playlists/' + playlist.id + '/words',
      ])
        await compare('GET', path, undefined, student, 200, zone);
    for (const body of [
      {},
      null,
      { knewIt: 'invalid' },
      { knewIt: 1 },
      { knewIt: false },
    ])
      await compare('POST', '/words/' + word.id + '/reviews', body, student);
    const first = await compare(
      'POST',
      '/words/' + word.id + '/reviews',
      { knewIt: true },
      student,
      201,
    );
    const second = await compare(
      'POST',
      '/words/' + word.id + '/reviews',
      { knewIt: true },
      student,
      201,
    );
    await compare(
      'DELETE',
      '/reviews/' + first.reviewId,
      undefined,
      student,
      409,
    );
    await compare(
      'DELETE',
      '/reviews/' + second.reviewId,
      undefined,
      teacher,
      404,
    );
    await compare(
      'DELETE',
      '/reviews/' + second.reviewId,
      undefined,
      student,
      200,
    );
    await compare(
      'DELETE',
      '/reviews/' + first.reviewId,
      undefined,
      student,
      200,
    );
    for (let i = 0; i < 5; i++)
      await compare(
        'POST',
        '/words/' + word.id + '/reviews',
        { knewIt: true },
        student,
        201,
      );
    await compare('GET', '/streak', undefined, student, 200);
    await compare('GET', '/playlists/' + playlist.id, undefined, student, 200);
    await compare(
      'POST',
      '/words/' + word.id + '/reviews',
      { knewIt: false },
      student,
      201,
    );
    for (const path of [
      '/lookup',
      '/lookup?term=',
      '/lookup?term=hello',
      '/lookup?term=missing',
      '/lookup?term=broken',
    ])
      await compare('GET', path, undefined, student);
    await require('./vocabulary-boundaries.cjs')({
      h,
      db,
      student,
      teacher,
      word,
      playlist,
      baseline,
      migrated,
    });
    return h.count;
  } finally {
    if (old === undefined) delete process.env.VOCABULARY_API_ENABLED;
    else process.env.VOCABULARY_API_ENABLED = old;
    if (oldDictionary === undefined) delete process.env.DICTIONARY_BASE_URL;
    else process.env.DICTIONARY_BASE_URL = oldDictionary;
    await new Promise((resolve) => stub.close(resolve));
  }
};
