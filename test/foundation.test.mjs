import { test } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { readConfig } = await import('../dist/config.js');
const { createApp } = await import('../dist/app.js');

test('rejects invalid config without including credentials in errors', () => {
  for (const env of [
    {},
    { DATABASE_URL: 'jdbc:postgresql://localhost/db' },
    { DATABASE_URL: 'postgres://secret:password@localhost/db', PORT: 'NaN' },
    { DATABASE_URL: 'postgres://localhost/db', CORS_ALLOWED_ORIGINS: '*' },
    { DATABASE_URL: 'postgres://localhost/db', READ_API_ENABLED: 'true' },
    { DATABASE_URL: 'postgres://localhost/db', READ_API_ENABLED: 'yes' },
    { DATABASE_URL: 'postgres://localhost/db', READ_API_ENABLED: 'true', APP_JWTSECRET: ' '.repeat(32) },
  ]) {
    assert.throws(() => readConfig(env), error => !error.message.includes('password'));
  }
  assert.equal(readConfig({ DATABASE_URL: 'postgres://localhost/db' }).port, 3001);
});

test('HTTP liveness, DB readiness, CORS and unknown routes', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://test:test@127.0.0.1:1/test';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:8081';
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const live = await fetch(`${base}/health/live`, { headers: { Origin: 'http://localhost:8081' } });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.equal(live.headers.get('access-control-allow-origin'), 'http://localhost:8081');
    const blocked = await fetch(`${base}/health/live`, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
    const preflight = await fetch(`${base}/health/live`, { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:8081',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
    const ready = await fetch(`${base}/health/ready`);
    assert.equal(ready.status, process.env.TEST_DATABASE_URL ? 200 : 503);
    assert.deepEqual(await ready.json(), process.env.TEST_DATABASE_URL
      ? { status: 'ok', database: 'up' }
      : { status: 'unavailable', database: 'down' });
    assert.equal((await fetch(`${base}/api/users/me`)).status, 404);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    delete process.env.CORS_ALLOWED_ORIGINS;
  }
});

test('global validation rejects invalid DTO and unexpected properties', async () => {
  const { ValidationPipe } = require('@nestjs/common');
  const { IsString } = require('class-validator');
  class ExampleRequest {}
  IsString()(ExampleRequest.prototype, 'name');
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'body', metatype: ExampleRequest };
  for (const body of [{ name: 123 }, { name: 'valid', unexpected: true }]) {
    await assert.rejects(pipe.transform(body, metadata), error => error.getStatus() === 400);
  }
  assert.equal((await pipe.transform({ name: 'valid' }, metadata)).name, 'valid');
});

test('invalid startup exits with JSON error and no credentials', async () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['dist/main.js'], {
    env: { ...process.env, DATABASE_URL: 'invalid-secret-value' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  const lines = (result.stdout + result.stderr).trim().split(/\r?\n/);
  assert.ok(lines.some(line => JSON.parse(line).level === 'error'));
  assert.ok(!lines.join('').includes('invalid-secret-value'));
});

test('unresponsive PostgreSQL handshake times out instead of hanging', { timeout: 10000 }, async () => {
  const net = require('node:net');
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.DATABASE_URL = `postgres://test:test@127.0.0.1:${server.address().port}/stiu_ci`;
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const started = Date.now();
    const result = await fetch(`${await app.getUrl()}/health/ready`);
    assert.equal(result.status, 503);
    assert.ok(Date.now() - started < 5000);
  } finally {
    await app.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    delete process.env.DATABASE_URL;
  }
});
