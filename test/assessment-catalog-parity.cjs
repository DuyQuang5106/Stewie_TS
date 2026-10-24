module.exports = async function catalogParity({
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
  try {
    for (const user of [null, teacher, admin, student])
      for (const path of [
        '/catalog',
        '/catalog/facets',
        '/my-attempts',
        '/my-stats',
      ])
        await compare(
          'GET',
          path,
          undefined,
          user,
          user ? (user === student ? 200 : 403) : 401,
        );
    for (const query of [
      '',
      '?sort=id,asc',
      '?size=1&sort=id,asc',
      '?page=99&size=1',
      '?sort=durationSeconds,asc&sort=id,asc',
      '?q=Taking',
      '?q=%25',
      '?category=PRACTICE',
      '?category=PERFORMANCE,DRILL',
      '?exam=SAT',
      '?exam=IELTS&skill=READING',
      '?skill=MATH',
      '?skill=VERBAL,READING',
      '?length=UNDER_30',
      '?length=FROM_30_TO_60',
      '?length=OVER_60',
      '?status=NOT_STARTED',
      '?status=IN_PROGRESS',
      '?status=COMPLETED',
      '?minDurationSeconds=600&maxDurationSeconds=1200',
      '?minDurationSeconds=bad',
      '?type=DRILL',
      '?type=bad',
      '?category=bad',
      '?skill=bad',
      '?sort=bad',
    ])
      await compare('GET', '/catalog' + query, undefined, student);
    for (const query of [
      '',
      '?exam=SAT&skill=MATH',
      '?exam=IELTS&skill=READING&category=PERFORMANCE',
      '?length=UNDER_30&status=COMPLETED',
      '?q=Taking',
      '?exam=%25',
      '?category=bad',
    ])
      await compare('GET', '/catalog/facets' + query, undefined, student);
    const listed = (
      await request(baseline, 'GET', '/catalog?sort=id,asc', undefined, student)
    ).body;
    for (const item of listed.content.slice(0, 3))
      await compare('GET', '/catalog/' + item.id, undefined, student, 200);
    await compare(
      'GET',
      '/catalog/00000000-0000-0000-0000-000000000000',
      undefined,
      student,
      404,
    );
    await compare('GET', '/catalog/invalid', undefined, student, 400);
    for (const query of ['', '?size=1', '?page=99&size=1', '?sort=bad'])
      await compare('GET', '/my-attempts' + query, undefined, student, 200);
    for (const zone of [
      'UTC',
      'America/New_York',
      'Pacific/Kiritimati',
      'invalid',
    ])
      await compare('GET', '/my-stats', undefined, student, 200, zone);
    return h.count;
  } finally {
    if (old === undefined) delete process.env.ASSESSMENT_API_ENABLED;
    else process.env.ASSESSMENT_API_ENABLED = old;
  }
};
