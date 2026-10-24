const boundedFetch = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
import { test } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { createApp } = await import('../../dist/app.js');
const { DatabaseService } = await import('../../dist/database.service.js');
const { AssessmentExpiryService } =
  await import('../../dist/assessment/expiry.service.js');

test(
  'Java/TypeScript read API contract parity',
  {
    skip: !process.env.READ_API_TEST_DATABASE_URL,
    timeout: 180000,
  },
  async () => {
    const target = new URL(process.env.READ_API_TEST_DATABASE_URL);
    assert.equal(
      target.pathname,
      '/stiu_read_api_test',
      'Use only the isolated read API test DB',
    );
    const baseline = process.env.JAVA_BASE_URL ?? 'http://127.0.0.1:18081';
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseline).hostname));
    const secret = 'read-api-parity-secret-at-least-32-bytes';
    const envBefore = { ...process.env };
    process.env.DATABASE_URL = target.toString();
    process.env.READ_API_ENABLED = 'true';
    process.env.APP_JWTSECRET = secret;
    const db = new Pool({
      connectionString: target.toString(),
      connectionTimeoutMillis: 3000,
    });
    let app;
    let compared = 0;
    const identities = [];
    try {
      let started = false;
      for (let i = 0; i < 120; i++) {
        try {
          if ((await boundedFetch(`${baseline}/actuator/health`)).ok) {
            started = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.ok(
        started,
        'Java baseline must be running against the same isolated DB',
      );
      await db.query(
        "UPDATE users SET deleted_at = NULL WHERE email LIKE 'parity.%@stewiesat.test'",
      );
      for (const table of ['topic', 'skill'])
        await db.query(`DELETE FROM ${table} WHERE slug LIKE 'parity-%'`);
      for (const role of ['ADMIN', 'TEACHER', 'STUDENT']) {
        const response = await boundedFetch(
          `${baseline}/api/auth/dev-login?email=parity.${role.toLowerCase()}@stewiesat.test&role=${role}`,
          { method: 'POST' },
        );
        assert.equal(response.status, 200);
        const { accessToken } = await response.json();
        assert.equal(
          jwt.verify(accessToken, secret, { algorithms: ['HS256'] }).roles[0],
          role,
        );
        identities.push({
          role,
          token: accessToken,
          id: jwt.decode(accessToken).sub,
        });
      }
      const admin = identities[0];
      await db.query(
        "UPDATE users SET last_access_at = '2026-01-02 03:04:05.123456', phone_number = '+84900009999' WHERE id = $1",
        [admin.id],
      );
      for (const resource of ['topics', 'skills']) {
        for (const suffix of ['alpha', 'beta']) {
          const response = await boundedFetch(
            `${baseline}/api/academic/${resource}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${admin.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: `Parity ${suffix}`,
                slug: `parity-${resource}-${suffix}`,
              }),
            },
          );
          assert.equal(response.status, 201);
          const item = await response.json();
          if (suffix === 'beta')
            assert.equal(
              (
                await boundedFetch(
                  `${baseline}/api/academic/${resource}/${item.id}/archive`,
                  {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${admin.token}` },
                  },
                )
              ).status,
              200,
            );
        }
      }
      app = await createApp();
      await app.listen(0, '127.0.0.1');
      const migrated = await app.getUrl();
      const normalize = (value) => {
        if (Array.isArray(value)) return value.map(normalize);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== 'timestamp')
              .map(([key, item]) => [
                key,
                [
                  'roles',
                  'topicIds',
                  'skillIds',
                  'tagIds',
                  'correctOptionIds',
                ].includes(key) && Array.isArray(item)
                  ? [...item].sort()
                  : key === 'tags' && Array.isArray(item)
                    ? item
                        .map(normalize)
                        .sort((a, b) => a.id.localeCompare(b.id))
                    : normalize(item),
              ]),
          );
        return value;
      };
      async function compare(path, headers = {}) {
        const a = await boundedFetch(baseline + path, { headers });
        const b = await boundedFetch(migrated + path, { headers });
        assert.equal(b.status, a.status, `${path} HTTP status`);
        let actual = normalize(await b.json());
        let expected = normalize(await a.json());
        // Java TagGroupRepo has no ordering contract; its fetch join may reorder groups/tags.
        if (
          path === '/api/academic/tag-groups' &&
          Array.isArray(actual) &&
          Array.isArray(expected)
        ) {
          actual.sort((a, b) => a.id.localeCompare(b.id));
          expected.sort((a, b) => a.id.localeCompare(b.id));
        }
        assert.deepEqual(actual, expected, `${path} response contract`);
        compared++;
      }
      await compare('/api/users/me');
      for (const path of [
        '/api/users/all',
        '/api/users/by-email',
        `/api/users/${admin.id}`,
      ])
        await compare(path);
      for (const identity of identities) {
        const headers = { Authorization: `Bearer ${identity.token}` };
        await compare('/api/users/me', headers);
        await compare('/api/users/me', { Cookie: `token=${identity.token}` });
        for (const resource of ['topics', 'skills']) {
          for (const query of [
            '',
            '?sort=name,asc',
            '?includeArchived=true&sort=name,desc',
            '?page=1&size=1&sort=name,asc',
            '?page=99&size=1',
            '?size=0&page=-1',
            '?includeArchived=invalid',
            '?sort=nonexistent,asc',
            '?sort=slug,desc&sort=name,asc',
            '?includeArchived=YES&size=5000',
            '?size=invalid&page=invalid',
            '?sort=name,desc,ignorecase',
          ]) {
            await compare(`/api/academic/${resource}${query}`, headers);
          }
        }
      }
      const student = identities[2];
      for (const identity of identities) {
        const headers = { Authorization: `Bearer ${identity.token}` };
        for (const query of [
          '',
          '?sort=email,asc',
          '?page=1&size=1&sort=id,asc',
          '?page=99&size=1',
          '?page=-1&size=0',
          '?sort=name,desc,ignorecase',
          '?sort=phoneNumber,asc',
          '?sort=nonexistent,asc',
        ]) {
          await compare(`/api/users/all${query}`, headers);
        }
        for (const path of [
          `/api/users/${admin.id}`,
          `/api/users/${student.id}`,
          '/api/users/not-a-uuid',
          '/api/users/1-1-1-1-1',
          '/api/users/00000000-0000-0000-0000-000000000000',
          '/api/users/by-email?email=parity.admin%40stewiesat.test',
          '/api/users/by-email?email=missing%40stewiesat.test',
          '/api/users/by-email',
          '/api/users/by-email?email=',
        ]) {
          await compare(path, headers);
        }
      }
      const invalid = [
        'malformed',
        jwt.sign({ sub: admin.id }, secret, { expiresIn: -10 }),
        jwt.sign({ sub: admin.id }, 'a-different-secret-at-least-32-bytes'),
        jwt.sign({ sub: admin.id }, secret, { algorithm: 'HS512' }),
        jwt.sign({ sub: 'invalid-uuid' }, secret),
        jwt.sign({ sub: '00000000-0000-0000-0000-000000000000' }, secret),
        jwt.sign(
          { sub: admin.id, nbf: Math.floor(Date.now() / 1000) + 60 },
          secret,
        ),
      ];
      for (const token of invalid)
        await compare('/api/users/me', { Authorization: `Bearer ${token}` });
      const algorithmResponse = await boundedFetch(migrated + '/api/users/me', {
        headers: { Authorization: `Bearer ${invalid[3]}` },
      });
      assert.equal(algorithmResponse.status, 401);
      await compare('/api/users/me', {
        Authorization: 'Bearer malformed',
        Cookie: `token=${admin.token}`,
      });
      await compare('/api/academic/topics', {
        Authorization: `Bearer ${jwt.sign({ sub: student.id, roles: ['ADMIN'] }, secret)}`,
      });
      for (const path of [
        '/api/users/all',
        '/api/users/by-email?email=parity.admin%40stewiesat.test',
        `/api/users/${admin.id}`,
      ]) {
        await compare(path, {
          Authorization: `Bearer ${jwt.sign({ sub: student.id, roles: ['ADMIN'] }, secret)}`,
        });
      }
      await require('../academic-parity.cjs')({
        baseline,
        migrated,
        identities,
        compare,
        db,
      });
      const writeCompared = await require('../catalog-write-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
        app,
        DatabaseService,
      });
      assert.equal(
        writeCompared,
        121,
        'Catalog write comparisons must all execute',
      );
      console.log(
        `Compared ${writeCompared} catalog write contracts and database effects`,
      );
      const resourceCompared = await require('../resource-write-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
      });
      assert.equal(
        resourceCompared,
        137,
        'Resource write comparisons must all execute',
      );
      process.stdout.write(
        `Compared ${resourceCompared} resource write contracts and database effects\n`,
      );
      const questionCompared = await require('../question-write-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
        app,
        DatabaseService,
      });
      assert.equal(
        questionCompared,
        130,
        'Question comparisons must all execute',
      );
      process.stdout.write(
        `Compared ${questionCompared} question aggregate contracts\n`,
      );
      const workflows = await require('../workflow-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
      });
      assert.equal(workflows, 75, 'Workflow comparisons must all execute');
      console.log('Compared ' + workflows + ' review/import/export contracts');
      const vocabulary = await require('../vocabulary-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
        app,
        DatabaseService,
      });
      assert.equal(vocabulary, 135, 'All vocabulary contract cases must run');
      process.stdout.write(
        'Compared ' + vocabulary + ' vocabulary contracts\n',
      );
      const authoring = await require('../assessment-authoring-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
        app,
        DatabaseService,
      });
      assert.equal(authoring, 69, 'All assessment authoring cases must run');
      process.stdout.write(
        'Compared ' + authoring + ' assessment authoring contracts\n',
      );
      const taking = await require('../assessment-taking-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
        app,
        DatabaseService,
        AssessmentExpiryService,
      });
      assert.equal(taking, 139, 'All assessment taking cases must run');
      process.stdout.write(
        'Compared ' + taking + ' assessment taking contracts\n',
      );
      const catalog = await require('../assessment-catalog-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
        app,
        DatabaseService,
      });
      assert.equal(catalog, 62, 'All assessment catalog cases must run');
      process.stdout.write(
        'Compared ' + catalog + ' assessment catalog contracts\n',
      );
      const analytics = await require('../analytics-parity.cjs')({
        baseline,
        migrated,
        identities,
        db,
      });
      assert.equal(analytics, 135, 'All student analytics cases must run');
      console.log('Compared ' + analytics + ' student analytics contracts');
      await db.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [
        student.id,
      ]);
      await compare('/api/users/me', {
        Authorization: `Bearer ${student.token}`,
      });
      for (const path of [
        `/api/users/${student.id}`,
        '/api/users/by-email?email=parity.student%40stewiesat.test',
        '/api/users/all?sort=id,asc',
      ]) {
        await compare(path, { Authorization: `Bearer ${admin.token}` });
      }
      await assert.rejects(
        app
          .get(DatabaseService)
          .readSnapshot((client) => client.query('DELETE FROM topic')),
        (error) => error.code === '25006',
      );
      assert.equal(
        compared,
        594,
        'All imported HTTP contract cases must execute',
      );
      console.log(
        `Compared ${compared} Java/TypeScript HTTP contracts; verified HS256-only policy and read-only transactions`,
      );
    } finally {
      if (app) await app.close();
      await db.end();
      for (const key of Object.keys(process.env))
        if (!(key in envBefore)) delete process.env[key];
      Object.assign(process.env, envBefore);
    }
  },
);
