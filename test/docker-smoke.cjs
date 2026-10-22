// Disposable Docker resources only; never connects to the Java database.
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const suffix = `stiu-foundation-${process.pid}`;
const db = `${suffix}-db`;
const api = `${suffix}-api`;
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim(); }
async function waitFor(check) {
  for (let i = 0; i < 40; i++) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Smoke test readiness deadline exceeded');
}
(async () => {
  try {
    docker('network', 'create', suffix);
    docker('run', '-d', '--name', db, '--network', suffix,
      '-e', 'POSTGRES_PASSWORD=foundation-test-only', '-e', 'POSTGRES_DB=stiu_ci', 'postgres:17');
    await waitFor(() => { docker('exec', db, 'pg_isready', '-U', 'postgres'); return true; });
    docker('run', '-d', '--name', api, '--network', suffix, '-p', '127.0.0.1::3001',
      '-e', `DATABASE_URL=postgresql://postgres:foundation-test-only@${db}:5432/stiu_ci`,
      '-e', 'CORS_ALLOWED_ORIGINS=http://localhost:8081', 'stiu-api-ts:ci');
    const port = docker('port', api, '3001/tcp').split(':').at(-1);
    const base = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(`${base}/health/ready`)).status === 200);
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    assert.equal(docker('exec', api, 'id', '-u'), '1000');
    docker('stop', '-t', '5', db);
    await waitFor(async () => (await fetch(`${base}/health/ready`)).status === 503);
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    docker('start', db);
    await waitFor(async () => (await fetch(`${base}/health/ready`)).status === 200);
    docker('stop', '-t', '10', api);
    // Nest propagates SIGTERM after completing shutdown; Docker reports 143.
    assert.ok(['0', '143'].includes(docker('inspect', '-f', '{{.State.ExitCode}}', api)));
    const logs = docker('logs', api);
    assert.ok(!logs.includes('foundation-test-only'));
    for (const line of logs.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
    console.log('Docker smoke passed: non-root, health, DB stop/restart, SIGTERM, JSON logs');
  } finally {
    for (const name of [api, db]) { try { docker('rm', '-f', '-v', name); } catch {} }
    try { docker('network', 'rm', suffix); } catch {}
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
