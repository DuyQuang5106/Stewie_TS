const boundedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const assert = require('node:assert/strict');

module.exports = async function academicParity({ baseline, migrated, identities, compare, db }) {
  const [admin, teacher, student] = identities;
  const suffix = Date.now().toString();
  const root = '/api/academic';
  const headers = user => ({ Authorization: `Bearer ${user.token}` });
  async function write(path, body, user = admin, status = 201) {
    const response = await boundedFetch(baseline + root + path, { method: 'POST', headers: { ...headers(user), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json();
    assert.equal(response.status, status, `Fixture ${path}: ${JSON.stringify(json)}`);
    return json;
  }
  const group = await write('/tag-groups', { name: 'Academic fixture', code: 'ACADEMIC_' + suffix });
  const emptyGroup = await write('/tag-groups', { name: 'Empty fixture', code: 'EMPTY_' + suffix });
  const tag = await write('/tags', { tagGroupId: group.id, name: 'Academic tag', slug: 'academic-' + suffix });
  const topic = await write('/topics', { name: 'Academic topic', slug: 'academic-' + suffix });
  const skill = await write('/skills', { name: 'Academic skill', slug: 'academic-' + suffix });
  const owned = await write('/question-banks', { name: 'Teacher bank ' + suffix, scope: 'TEACHER' }, teacher);
  const system = await write('/question-banks', { name: 'System bank ' + suffix, scope: 'SYSTEM' });
  const foreign = await write('/question-banks', { name: 'Foreign bank ' + suffix, scope: 'TEACHER', ownerAccountId: teacher.id });
  // The admin-created bank still belongs to teacher; use another teacher for real ownership denial.
  const otherLogin = await boundedFetch(`${baseline}/api/auth/dev-login?email=academic.other@stewiesat.test&role=TEACHER`, { method: 'POST' });
  const otherToken = (await otherLogin.json()).accessToken;
  const other = { token: otherToken };
  const foreignOwned = await write('/question-banks', { name: 'Other teacher bank ' + suffix, scope: 'TEACHER' }, other);
  const ownStimulus = await write('/stimuli', { title: 'Owned passage', content: { text: 'Passage fixture' }, source: 'source' }, teacher);
  const foreignStimulus = await write('/stimuli', { title: 'Other passage', content: { text: 'Hidden passage' } }, other);
  await write(`/stimuli/${ownStimulus.id}/publish`, {}, teacher, 200);
  const createQuestion = async (bank, user, title, published) => {
    const item = await write('/questions', { questionBankId: bank.id, stimulusId: bank.id === owned.id ? ownStimulus.id : null, questionType: 'MULTIPLE_CHOICE', difficulty: 'EASY',
      content: { title, prompt: 'secret needle prompt 100% under_score', options: [{ id: 'a', content: 'Option A' }, { id: 'b', content: 'Option B' }] },
      answer: { correctOptionIds: ['a'] }, explanation: { text: 'private explanation' },
      topicIds: [topic.id], skillIds: [skill.id], tagIds: [tag.id] }, user);
    if (published) await write(`/questions/${item.id}/publish`, { changeSummary: 'Fixture publish' }, user, 200);
    return item;
  };
  const ownQuestion = await createQuestion(owned, teacher, 'Teacher title', true);
  await write(`/questions/${ownQuestion.id}/revise`, {}, teacher, 200);
  await write(`/questions/${ownQuestion.id}/publish`, { changeSummary: 'Second version' }, teacher, 200);
  const publicQuestion = await createQuestion(system, admin, 'Public title 100% under_score', true);
  const draftQuestion = await createQuestion(system, admin, 'Unpublished title', false);
  const otherQuestion = await createQuestion(foreignOwned, other, 'Foreign title', false);
  const typedQuestions = [];
  for (const questionType of ['FILL_IN', 'SHORT_ANSWER', 'ESSAY']) {
    const item = await write('/questions', { questionBankId: owned.id, questionType, difficulty: 'MEDIUM',
      content: { title: questionType, prompt: 'Typed prompt' },
      answer: questionType === 'ESSAY' ? { gradingGuide: 'Essay guide' } : { acceptedAnswers: ['42'], gradingMode: 'TEXT_EXACT' },
      explanation: { text: 'Typed explanation' } }, teacher);
    typedQuestions.push(item.id);
  }
  await write(`/stimuli/${ownStimulus.id}/archive`, {}, teacher, 200);
  await write(`/question-banks/${owned.id}/archive`, {}, teacher, 200);
  const missing = '00000000-0000-0000-0000-000000000000';
  for (const user of [admin, teacher, student, other]) {
    for (const path of ['/tag-groups', `/tag-groups/${group.id}`, `/tag-groups/${emptyGroup.id}`,
      `/tags/${tag.id}`, `/tag-groups/${group.id}/tags`, `/tags/by-group/${group.id}`,
      `/tag-groups/${emptyGroup.id}/tags`, `/tag-groups/${missing}`, `/tags/${missing}`,
      `/tags/by-group/${missing}`, '/tag-groups/not-a-uuid', '/tags/by-group/not-a-uuid']) {
      await compare(root + path, headers(user));
    }
    for (const [resource, ids, sort] of [
      ['stimuli', [ownStimulus.id, foreignStimulus.id], 'title'],
      ['question-banks', [owned.id, system.id, foreign.id, foreignOwned.id], 'name'],
    ]) {
      for (const query of ['', `?sort=${sort},asc`, `?sort=${sort},desc&size=1&page=1`, '?page=99&size=1', '?sort=nonexistent,asc']) {
        await compare(`${root}/${resource}${query}`, headers(user));
      }
      for (const id of [...ids, missing, 'not-a-uuid']) await compare(`${root}/${resource}/${id}`, headers(user));
    }
    for (const id of [ownQuestion.id, publicQuestion.id, draftQuestion.id, otherQuestion.id, ...typedQuestions, missing, 'not-a-uuid']) {
      await compare(`${root}/questions/${id}`, headers(user));
      await compare(`${root}/questions/${id}/versions`, headers(user));
    }
    const filters = ['sort=createdAt,asc', 'sort=updatedAt,desc&size=1&page=1',
      'difficulty=EASY&sort=createdAt,asc', 'status=DRAFT&sort=createdAt,asc',
      `questionBankId=${system.id}&sort=createdAt,asc`, `topicId=${topic.id}&skillId=${skill.id}&tagId=${tag.id}&sort=createdAt,asc`,
      'keyword=secret&sort=createdAt,asc', 'keyword=100%25&sort=createdAt,asc', 'keyword=under_score&sort=createdAt,asc',
      'createdFrom=2020-01-01T00:00:00&createdTo=2030-01-01T00:00:00&sort=createdAt,asc',
      'createdFrom=2030-01-01T00:00:00&createdTo=2020-01-01T00:00:00', 'sort=id,asc',
      'questionBankId=invalid', 'difficulty=invalid', 'status=invalid', 'createdFrom=invalid',
      'difficulty=invalid&status=invalid', 'createdFrom=2026-02-30T00:00:00',
      'createdFrom=2020-01-01T00:00:00&createdTo=2020-01-01T00:00'];
    for (const path of ['/questions', '/public/questions']) {
      for (const query of filters) await compare(root + path + '?' + query, headers(user));
    }
  }
  const versionRows = (await db.query('SELECT id FROM question_version WHERE question_id = $1 ORDER BY version_number DESC', [ownQuestion.id])).rows;
  const reviewVersion = versionRows[0].id;
  await write(`/question-versions/${reviewVersion}/reviews`, { status: 'CHANGES_REQUESTED', comment: 'Please clarify the prompt' }, admin);
  await write(`/question-versions/${reviewVersion}/reviews`, { status: 'APPROVED', comment: 'Ready' }, admin);
  for (const user of [admin, teacher, student, other]) {
    for (const query of ['', '?status=PENDING&sort=publishedAt,asc', '?status=APPROVED&sort=versionNumber,desc',
      '?status=CHANGES_REQUESTED&sort=reviewStatus,asc', '?status=invalid', '?status=', '?sort=id,asc',
      '?sort=publishedAt,asc&size=1&page=1', '?page=99&size=1', '?page=-1&size=0']) {
      await compare(`${root}/question-reviews${query}`, headers(user));
    }
    for (const id of [reviewVersion, versionRows[1].id, missing, 'invalid', '1-1-1-1-1']) {
      await compare(`${root}/question-versions/${id}/reviews`, headers(user));
    }
  }
  for (const user of [admin, teacher, student, other]) {
    for (const query of ['?status=%20APPROVED%20', '?status=%20', '?status=approved', '?sort=reviewStatus,desc,ignorecase&sort=versionNumber,asc']) {
      await compare(`${root}/question-reviews${query}`, headers(user));
    }
  }
  await db.query('UPDATE question SET owner_id = NULL WHERE id = $1', [ownQuestion.id]);
  for (const user of [teacher, admin]) await compare(`${root}/question-versions/${reviewVersion}/reviews`, headers(user));
  await db.query('UPDATE question SET owner_id = $1, deleted_at = NOW() WHERE id = $2', [teacher.id, ownQuestion.id]);
  try {
    for (const user of [teacher, admin]) {
      await compare(`${root}/question-versions/${reviewVersion}/reviews`, headers(user));
      await compare(`${root}/question-reviews?status=APPROVED&sort=publishedAt,asc`, headers(user));
    }
  } finally {
    await db.query('UPDATE question SET deleted_at = NULL WHERE id = $1', [ownQuestion.id]);
  }
  await compare(`${root}/question-reviews`);
  await compare(`${root}/question-versions/${reviewVersion}/reviews`);
  for (const resource of ['tag-groups', 'stimuli', 'question-banks', 'questions', 'public/questions']) await compare(root + '/' + resource);
  const response = await boundedFetch(`${migrated}${root}/public/questions?keyword=Public`, { headers: headers(student) });
  const json = await response.json();
  assert.ok(json.content.length > 0);
  for (const row of json.content) for (const field of ['content', 'prompt', 'answer', 'explanation', 'ownerAccountId']) assert.ok(!(field in row));
  await db.query('UPDATE question SET deleted_at = NOW() WHERE id = $1', [publicQuestion.id]);
  await compare(`${root}/questions/${publicQuestion.id}`, headers(admin));
  await compare(`${root}/public/questions?sort=createdAt,asc`, headers(student));
  await db.query('UPDATE question_bank SET deleted_at = NOW() WHERE id = $1', [foreign.id]);
  await compare(`${root}/question-banks/${foreign.id}`, headers(admin));
  await compare(`${root}/question-banks?sort=name,asc`, headers(admin));
};
