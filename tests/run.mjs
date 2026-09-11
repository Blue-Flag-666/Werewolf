import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, unlink } from 'node:fs/promises';
const kind = process.argv[2] || 'integration';
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = 'http://127.0.0.1:' + port;
const sessionFile = '.wrangler/test-reconnect.json';
let server;
async function start() {
  let logs = '';
  server = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      '.wrangler/test-state',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  );
  server.stdout.on('data', (d) => (logs += d));
  server.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error('Local Worker failed to start\n' + logs);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  server = undefined;
}
try {
  await start();
  const child = spawn(
    process.execPath,
    [kind === 'browser' ? 'tests/browser.mjs' : 'tests/worker.integration.mjs'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_URL: base,
        ...(kind === 'integration' ? { TEST_SESSION_FILE: sessionFile } : {}),
      },
    },
  );
  const code = await new Promise((resolve) => child.on('exit', resolve));
  if (code) throw Error('Test failed: ' + code);
  if (kind === 'integration') {
    await stop();
    await start();
    const session = JSON.parse(await readFile(sessionFile, 'utf8'));
    const response = await fetch(base + '/api/rooms/' + session.code + '/state', {
      headers: { Authorization: 'Bearer ' + session.token },
    });
    const state = await response.json();
    if (!response.ok || state.game?.phase !== 'ended' || state.game.id !== session.game)
      throw Error('Persisted game did not recover after restart');
    console.log('PASS: confirmed game snapshot survives Worker process restart');
    await unlink(sessionFile);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await stop();
}
