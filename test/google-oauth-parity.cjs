const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync, randomUUID, createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
module.exports = async function googleParity({ baseline, migrated, db }) {
  const before = { ...process.env };
  Object.assign(process.env, {
    AUTH_API_ENABLED: 'true',
    AUTH_DEV_LOGIN_ENABLED: 'true',
    GOOGLE_OAUTH_ENABLED: 'true',
    GOOGLE_OIDC_ISSUER: 'http://127.0.0.1:18083',
    SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_ID:
      'ts-google-client',
    SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_SECRET:
      'test-client-secret',
    GOOGLE_CALLBACK_URI: migrated + '/login/oauth2/code/google',
    APP_OAUTH2_REDIRECTURI: 'http://localhost:3000/oauth2/redirect',
  });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid: randomUUID(), alg: 'RS256', use: 'sig' });
  const codes = new Map(),
    access = new Map();
  let profile = {},
    mode = '',
    count = 0;
  const issuer = 'http://127.0.0.1:18083';
  const server = http.createServer(async (r, s) => {
    const url = new URL(r.url, issuer);
    s.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/.well-known/openid-configuration')
      return s.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          userinfo_endpoint: issuer + '/userinfo',
          jwks_uri: issuer + '/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: [
            'client_secret_post',
            'client_secret_basic',
          ],
          code_challenge_methods_supported: ['S256'],
        }),
      );
    if (url.pathname === '/jwks') return s.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === '/authorize') {
      const code = randomUUID();
      codes.set(code, {
        params: url.searchParams,
        profile: { ...profile },
        mode,
      });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', code);
      s.writeHead(302, { Location: callback.href });
      return s.end();
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const part of r) body += part;
      const q = new URLSearchParams(body),
        data = codes.get(q.get('code'));
      codes.delete(q.get('code'));
      if (!data) {
        s.statusCode = 400;
        return s.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      const client =
        q.get('client_id') ??
        Buffer.from((r.headers.authorization ?? '').slice(6), 'base64')
          .toString()
          .split(':')[0];
      if (
        data.params.has('code_challenge') &&
        createHash('sha256')
          .update(q.get('code_verifier') ?? '')
          .digest('base64url') !== data.params.get('code_challenge')
      ) {
        s.statusCode = 400;
        return s.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      const now = Math.floor(Date.now() / 1000),
        claims = {
          ...data.profile,
          iss:
            client === 'ts-google-client'
              ? issuer
              : 'https://accounts.google.com',
          sub: data.profile.sub,
          aud: client,
          iat: now,
          exp: now + 3600,
          nonce: data.params.get('nonce'),
        };
      if (data.mode === 'nonce') claims.nonce = 'wrong';
      if (data.mode === 'audience') claims.aud = 'other-client';
      if (data.mode === 'issuer') claims.iss = 'https://evil.test';
      if (data.mode === 'expired') claims.exp = now - 10000;
      const key =
        data.mode === 'signature'
          ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
          : privateKey;
      const token = jwt.sign(claims, key, {
          algorithm: 'RS256',
          keyid: jwk.kid,
        }),
        a = randomUUID();
      access.set(a, data.profile);
      return s.end(
        JSON.stringify({
          access_token: a,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: token,
          scope: 'openid profile email',
        }),
      );
    }
    if (url.pathname === '/userinfo')
      return s.end(
        JSON.stringify(
          access.get((r.headers.authorization ?? '').slice(7)) ?? {},
        ),
      );
    s.statusCode = 404;
    s.end('{}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(18083, '127.0.0.1', resolve);
  });
  const get = (url, cookie) =>
    fetch(url, {
      redirect: 'manual',
      headers: cookie ? { Cookie: cookie } : {},
      signal: AbortSignal.timeout(15000),
    });
  async function start(base) {
    const first = await get(base + '/oauth2/authorization/google');
    assert.equal(first.status, 302);
    const target = new URL(first.headers.get('location'));
    assert.equal(target.origin, issuer);
    assert.ok(target.searchParams.get('state'));
    assert.ok(target.searchParams.get('nonce'));
    const cookies = first.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    return { target, cookies };
  }
  async function finish(base, { target, cookies }, alter) {
    const auth = await get(target);
    assert.equal(auth.status, 302);
    const callback = new URL(auth.headers.get('location'));
    if (alter === 'state') callback.searchParams.set('state', 'wrong');
    const r = await get(
      base + callback.pathname + callback.search,
      alter === 'cookie' ? undefined : cookies,
    );
    assert.equal(r.status, 302);
    return r;
  }
  async function failure(base, kind) {
    profile = {
      sub: randomUUID(),
      email: 'oauth.' + randomUUID() + '@stewiesat.test',
      email_verified: true,
      name: 'OAuth Test',
    };
    mode = ['state', 'cookie'].includes(kind) ? '' : kind;
    const r = await finish(base, await start(base), kind);
    assert.equal(
      new URL(r.headers.get('location')).searchParams.get('error'),
      'oauth_failed',
      base + ' ' + kind,
    );
    assert.equal(
      r.headers.getSetCookie().filter((c) => /^(token|refreshToken)=/.test(c))
        .length,
      0,
    );
    count++;
  }
  try {
    for (const base of [baseline, migrated]) {
      for (const kind of [
        'state',
        'cookie',
        'nonce',
        'audience',
        'issuer',
        'expired',
        'signature',
      ])
        await failure(base, kind);
      mode = '';
      profile = {
        sub: randomUUID(),
        email: 'oauth.new.' + randomUUID() + '@stewiesat.test',
        email_verified: true,
        name: 'Google User',
      };
      const r = await finish(base, await start(base));
      assert.equal(
        r.headers.get('location'),
        'http://localhost:3000/oauth2/redirect',
        base + ' success',
      );
      const cookies = r.headers
        .getSetCookie()
        .filter((c) => /^(token|refreshToken)=/.test(c));
      assert.equal(cookies.length, 2);
      const token = cookies
        .find((c) => c.startsWith('token='))
        .split(';')[0]
        .slice(6);
      const claims = jwt.verify(
        token,
        'read-api-parity-secret-at-least-32-bytes',
        { algorithms: ['HS256'] },
      );
      assert.deepEqual(claims.roles, ['STUDENT']);
      const u = (
        await db.query('SELECT * FROM users WHERE id=$1', [claims.sub])
      ).rows[0];
      assert.equal(u.email, profile.email);
      assert.equal(u.name, 'Google User');
      assert.ok(u.last_access_at);
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT count(*) FROM oauth_accounts WHERE user_id=$1 AND provider='google' AND provider_user_id=$2",
              [u.id, profile.sub],
            )
          ).rows[0].count,
        ),
        1,
      );
      count++;
      profile.email_verified = false;
      profile.email = 'changed.' + randomUUID() + '@stewiesat.test';
      const linked = await finish(base, await start(base));
      assert.equal(
        linked.headers.get('location'),
        'http://localhost:3000/oauth2/redirect',
      );
      count++;
      profile.email = u.email;
      profile.email_verified = true;
      await db.query('UPDATE users SET deleted_at=NOW() WHERE id=$1', [u.id]);
      const disabled = await finish(base, await start(base));
      assert.equal(
        new URL(disabled.headers.get('location')).searchParams.get('error'),
        'account_disabled',
      );
      count++;
      for (const [p, error] of [
        [
          {
            sub: randomUUID(),
            email: 'unverified.' + randomUUID() + '@stewiesat.test',
            email_verified: false,
          },
          'email_not_verified',
        ],
        [
          {
            sub: randomUUID(),
            email: 'override.' + randomUUID() + '@stewiesat.test',
            email_verified: false,
            verified_email: true,
          },
          'email_not_verified',
        ],
        [{ sub: randomUUID(), email_verified: true }, 'invalid_user_info'],
      ]) {
        profile = p;
        const result = await finish(base, await start(base));
        assert.equal(
          new URL(result.headers.get('location')).searchParams.get('error'),
          error,
        );
        assert.equal(
          Number(
            (
              await db.query(
                'SELECT count(*) FROM oauth_accounts WHERE provider_user_id=$1',
                [profile.sub],
              )
            ).rows[0].count,
          ),
          0,
        );
        count++;
      }
      profile = {
        sub: randomUUID(),
        email: 'legacy.' + randomUUID() + '@stewiesat.test',
        verified_email: 'true',
      };
      const legacy = await finish(base, await start(base));
      assert.equal(
        legacy.headers.get('location'),
        'http://localhost:3000/oauth2/redirect',
      );
      count++;
      const email = 'oauth.link.' + randomUUID() + '@stewiesat.test';
      const login = await fetch(
        base + '/api/auth/dev-login?email=' + email + '&role=TEACHER',
        { method: 'POST' },
      );
      assert.equal(login.status, 200);
      const old = jwt.decode((await login.json()).accessToken).sub;
      profile = { sub: randomUUID(), email, email_verified: true };
      const same = await finish(base, await start(base));
      assert.equal(
        same.headers.get('location'),
        'http://localhost:3000/oauth2/redirect',
      );
      const row = (
        await db.query(
          'SELECT user_id FROM oauth_accounts WHERE provider_user_id=$1',
          [profile.sub],
        )
      ).rows[0];
      assert.equal(row.user_id, old);
      assert.deepEqual(
        (await db.query('SELECT role FROM user_roles WHERE user_id=$1', [old]))
          .rows,
        [{ role: 'TEACHER' }],
      );
      count++;
    }
    return count;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const k of Object.keys(process.env))
      if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
};
