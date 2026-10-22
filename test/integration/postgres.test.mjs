import { test } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const net = require('node:net');
const { Pool } = require('pg');
const { createApp } = await import('../../dist/app.js');

test('isolated PostgreSQL: readiness, invalid password, outage, recovery and pool cleanup', {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 30000,
}, async () => {
  const target = new URL(process.env.TEST_DATABASE_URL);
  // Use a disposable database only. Never point this suite at the Java/local DB.
  assert.match(target.pathname, /^\/(stiu_ci|stiu_foundation_test)$/);
  const sockets = new Set();
  let online = true;
  const proxy = net.createServer(client => {
    if (!online) { client.destroy(); return; }
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = new URL(target);
  address.hostname = '127.0.0.1';
  address.port = String(proxy.address().port);
  process.env.DATABASE_URL = address.toString();
  const app = await createApp();
  const observer = new Pool({ connectionString: target.toString(), connectionTimeoutMillis: 3000 });
  let closed = false;
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    assert.equal((await fetch(`${base}/health/ready`)).status, 200);
    online = false;
    for (const socket of sockets) socket.destroy();
    const start = Date.now();
    assert.equal((await fetch(`${base}/health/ready`)).status, 503);
    assert.ok(Date.now() - start < 5000);
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    online = true;
    assert.equal((await fetch(`${base}/health/ready`)).status, 200);
    const wrong = new URL(target);
    wrong.password = 'deliberately-incorrect-password';
    const invalid = new Pool({ connectionString: wrong.toString(), connectionTimeoutMillis: 3000 });
    try { await assert.rejects(invalid.query('SELECT 1'), error => error.code === '28P01'); }
    finally { await invalid.end(); }
    await app.close();
    closed = true;
    const result = await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'stiu-api-ts' AND datname = current_database()");
    assert.equal(result.rows[0].count, 0);
  } finally {
    if (!closed) await app.close();
    await observer.end();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
});
