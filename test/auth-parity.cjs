const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
module.exports = async function authParity({
  baseline,
  migrated,
  db,
  app,
  AuthService,
  DatabaseService,
}) {
  assert.equal(
    new URL(db.options.connectionString).pathname,
    '/stiu_read_api_test',
  );
  const old = { ...process.env };
  Object.assign(process.env, {
    AUTH_API_ENABLED: 'true',
    AUTH_DEV_LOGIN_ENABLED: 'true',
  });
  let count = 0;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const secret = 'read-api-parity-secret-at-least-32-bytes';
  async function req(base, path, body, headers = {}) {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return {
      status: r.status,
      body: r.status === 204 ? null : await r.json(),
      cookies: r.headers.getSetCookie(),
      cache: r.headers.get('cache-control'),
    };
  }
  function clean(v) {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== 'timestamp')
          .map(([k, x]) => [k, clean(x)]),
      );
    return v;
  }
  function tokens(r, userId) {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.cache, /no-store/);
    assert.equal(r.body.tokenType, 'Bearer');
    assert.equal(r.body.expiresIn, 900);
    const c = jwt.verify(r.body.accessToken, secret, { algorithms: ['HS256'] });
    if (userId) assert.equal(c.sub, userId);
    assert.equal(c.exp - c.iat, 900);
    assert.match(r.body.refreshToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.cookies.length, 2);
    for (const c of r.cookies) {
      assert.match(c, /HttpOnly/);
      assert.match(c, /Path=\//);
      assert.match(c, /SameSite=Lax/);
    }
    return c;
  }
  async function compare(path, body, headers = {}) {
    const a = await req(baseline, path, body, headers),
      b = await req(migrated, path, body, headers);
    assert.equal(b.status, a.status, path);
    if (a.status !== 200) assert.deepEqual(clean(b.body), clean(a.body), path);
    count++;
    return [a, b];
  }
  async function login(
    base,
    email = 'auth.' + randomUUID() + '@stewiesat.test',
    role = 'STUDENT',
  ) {
    const r = await req(
      base,
      '/api/auth/dev-login?email=' +
        encodeURIComponent(email) +
        '&role=' +
        role,
    );
    tokens(r);
    return r;
  }
  async function stored(raw) {
    return (
      await db.query('SELECT * FROM refresh_tokens WHERE token_hash=$1', [
        hash(raw),
      ])
    ).rows[0];
  }
  try {
    for (const path of ['/api/auth/refresh', '/api/auth/logout'])
      for (const body of [
        undefined,
        {},
        null,
        { refreshToken: '' },
        { refreshToken: ' ' },
        { refreshToken: 'unknown' },
        { refreshToken: 42 },
        { refreshToken: [] },
        [],
        true,
      ])
        await compare(path, body);
    for (const headers of [
      { Cookie: 'refreshToken=unknown' },
      { Cookie: 'refreshToken=' },
      { Referer: 'https://evil.test/page' },
      { Origin: 'http://localhost:3000' },
    ])
      for (const path of ['/api/auth/refresh', '/api/auth/logout'])
        await compare(path, undefined, headers);
    await compare('/api/auth/dev-login?role=bad');
    for (const base of [baseline, migrated]) {
      const email = 'auth.sessions.' + randomUUID() + '@stewiesat.test',
        first = await login(base, email),
        id = tokens(first).sub;
      const second = await login(base, email, 'ADMIN');
      assert.deepEqual(tokens(second).roles, ['STUDENT']);
      assert.equal((await stored(first.body.refreshToken)).is_revoked, false);
      assert.notEqual(
        (await stored(first.body.refreshToken)).token_hash,
        first.body.refreshToken,
      );
      count += 2;
      const refreshed = await req(base, '/api/auth/refresh', {
        refreshToken: first.body.refreshToken,
      });
      tokens(refreshed, id);
      assert.equal((await stored(first.body.refreshToken)).is_revoked, true);
      assert.ok(await stored(refreshed.body.refreshToken));
      count++;
      const replay = await req(base, '/api/auth/refresh', {
        refreshToken: first.body.refreshToken,
      });
      assert.equal(replay.status, 401);
      assert.equal(
        replay.body.message,
        'Refresh token was revoked. All sessions invalidated.',
      );
      assert.equal(
        Number(
          (
            await db.query(
              'SELECT count(*) FROM refresh_tokens WHERE user_id=$1',
              [id],
            )
          ).rows[0].count,
        ),
        0,
      );
      count++;
      for (const token of [
        second.body.refreshToken,
        refreshed.body.refreshToken,
      ])
        assert.equal(
          (await req(base, '/api/auth/refresh', { refreshToken: token }))
            .status,
          401,
        );
      count++;
      const expired = await login(base);
      await db.query(
        "UPDATE refresh_tokens SET expires_at='2000-01-01' WHERE token_hash=$1",
        [hash(expired.body.refreshToken)],
      );
      const exp = await req(base, '/api/auth/refresh', {
        refreshToken: expired.body.refreshToken,
      });
      assert.equal(exp.status, 401);
      assert.equal(exp.body.message, 'Refresh token has expired');
      assert.equal((await stored(expired.body.refreshToken)).is_revoked, false);
      count++;
      const cookie = await login(base);
      const fromCookie = await req(
        base,
        '/api/auth/refresh',
        {},
        { Cookie: 'refreshToken=' + cookie.body.refreshToken },
      );
      tokens(fromCookie);
      count++;
      const precedence = await login(base);
      assert.equal(
        (
          await req(
            base,
            '/api/auth/refresh',
            { refreshToken: 'bad' },
            { Cookie: 'refreshToken=' + precedence.body.refreshToken },
          )
        ).status,
        401,
      );
      assert.equal(
        (await stored(precedence.body.refreshToken)).is_revoked,
        false,
      );
      count++;
      const logged = await req(base, '/api/auth/logout', {
        refreshToken: precedence.body.refreshToken,
      });
      assert.equal(logged.status, 204);
      for (const c of logged.cookies) assert.match(c, /Max-Age=0/);
      assert.equal(
        (await stored(precedence.body.refreshToken)).is_revoked,
        true,
      );
      count++;
      const race = await login(base),
        raced = await Promise.all([
          req(base, '/api/auth/refresh', {
            refreshToken: race.body.refreshToken,
          }),
          req(base, '/api/auth/refresh', {
            refreshToken: race.body.refreshToken,
          }),
        ]);
      assert.deepEqual(raced.map((r) => r.status).sort(), [200, 401]);
      const winner = raced.find((r) => r.status === 200);
      assert.equal(
        (
          await req(base, '/api/auth/refresh', {
            refreshToken: winner.body.refreshToken,
          })
        ).status,
        401,
      );
      count++;
      const crossover = await login(base),
        opposite = base === baseline ? migrated : baseline;
      tokens(
        await req(opposite, '/api/auth/refresh', {
          refreshToken: crossover.body.refreshToken,
        }),
        tokens(crossover).sub,
      );
      count++;
      const denied = await login(base);
      await db.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [
        tokens(denied).sub,
      ]);
      const deleted = await req(base, '/api/auth/refresh', {
        refreshToken: denied.body.refreshToken,
      });
      assert.equal(deleted.status, 401);
      count++;
    }
    DatabaseService ??= (await import('../dist/database.service.js'))
      .DatabaseService;
    const rollbackToken = await login(migrated),
      database = app.get(DatabaseService),
      write = database.writeTransaction.bind(database);
    database.writeTransaction = (work, domain) =>
      write(
        (c) =>
          work(
            new Proxy(c, {
              get(target, key) {
                if (key === 'query')
                  return (...args) => {
                    if (
                      String(args[0]).startsWith('INSERT INTO refresh_tokens')
                    )
                      throw new Error('Injected token persistence failure');
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
          await req(migrated, '/api/auth/refresh', {
            refreshToken: rollbackToken.body.refreshToken,
          })
        ).status,
        500,
      );
    } finally {
      database.writeTransaction = write;
    }
    assert.equal(
      (await stored(rollbackToken.body.refreshToken)).is_revoked,
      false,
    );
    tokens(
      await req(migrated, '/api/auth/refresh', {
        refreshToken: rollbackToken.body.refreshToken,
      }),
    );
    count++;
    AuthService ??= (await import('../dist/auth/auth.service.js')).AuthService;
    const cleanupToken = await login(migrated);
    await db.query(
      "UPDATE refresh_tokens SET expires_at='2000-01-01' WHERE token_hash=$1",
      [hash(cleanupToken.body.refreshToken)],
    );
    await app.get(AuthService).cleanup();
    assert.equal(await stored(cleanupToken.body.refreshToken), undefined);
    count++;
    return count;
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in old)) delete process.env[k];
    Object.assign(process.env, old);
  }
};
