import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
async function post(path, data) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return body;
}
const clients = [];
async function client(session) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/api/rooms/' + session.code + '/socket');
  const waiting = new Map();
  let state;
  const initial = new Promise((resolve, reject) => {
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'auth', token: session.token })),
    );
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') {
        state = m.state;
        resolve();
      }
      if (m.type === 'ack' || m.type === 'error') {
        const cb = waiting.get(m.id);
        if (cb) {
          waiting.delete(m.id);
          m.type === 'error' ? cb.reject(Error(m.error)) : cb.resolve(m.result);
        }
      }
    });
    ws.addEventListener('error', reject);
  });
  await initial;
  const c = {
    ws,
    session,
    get state() {
      return state;
    },
    async refresh() {
      const r = await fetch(base + '/api/rooms/' + session.code + '/state', {
        headers: { Authorization: 'Bearer ' + session.token },
      });
      state = await r.json();
      return state;
    },
  };
  // Register before sending and clear timeout on either ack or error.
  c.send = async (type, payload = {}) => {
    const id = crypto.randomUUID();
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiting.delete(id);
        reject(Error('ack timeout ' + type));
      }, 10000);
      waiting.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
    });
    ws.send(JSON.stringify({ id, type, payload }));
    const result = await response;
    await c.refresh();
    return result;
  };
  clients.push(c);
  return c;
}
async function command(c, type, payload = {}) {
  await c.refresh();
  return c.send('command', {
    command: { id: crypto.randomUUID(), version: c.state.game.version, type, payload },
  });
}
try {
  const session = await post('/api/create', { name: 'judge', password: 'secret' });
  const judge = await client(session);
  const players = [];
  for (let i = 0; i < 4; i++) {
    const p = await client(
      await post('/api/rooms/' + session.code + '/join', { name: 'p' + i, password: 'secret' }),
    );
    await p.send('seat', { seat: i + 1 });
    players.push(p);
  }
  await judge.send('configure', {
    roles: ['wolf', 'villager', 'villager', 'villager'],
    rules: { sheriff: false },
  });
  await judge.send('start');
  await judge.refresh();
  assert.equal(judge.state.game.players.length, 4);
  const spectator = await client(
    await post('/api/rooms/' + session.code + '/join', { name: 'spectator', password: 'secret' }),
  );
  assert.equal(spectator.state.game.own, undefined);
  assert(spectator.state.game.players.every((p) => !p.role));
  for (const p of players) {
    await p.refresh();
    assert(p.state.game.own);
    assert(p.state.game.players.every((x) => !x.role));
    await command(p, 'identity');
  }
  await assert.rejects(command(players[0], 'startNight'), /法官/);
  const generated = await players[0].send('generateCode');
  assert.match(generated.code, /^\d{6}$/);
  await spectator.send('takeover', { code: generated.code });
  assert.equal(spectator.state.controls, players[0].state.self);
  await assert.rejects(command(players[0], 'identity'), /控制权/);
  await players[0].send('reclaim');
  await spectator.refresh();
  assert.equal(spectator.state.game.own, undefined);
  await assert.rejects(command(spectator, 'identity'), /控制权/);
  await command(judge, 'startNight');
  await command(judge, 'nextRole');
  await judge.refresh();
  const wolfId = judge.state.game.players.find((p) => p.role === 'wolf').id;
  const wolf = players.find((p) => p.state.self === wolfId);
  await command(wolf, 'submitAction', { pass: true });
  await judge.refresh();
  assert.equal(judge.state.game.night.knife, undefined);
  await command(judge, 'submitAction', { actor: wolfId, pass: true });
  await command(judge, 'confirmAction');
  await command(judge, 'nextRole');
  await command(judge, 'settleNight');
  await command(judge, 'announce');
  await command(judge, 'startSpeech');
  await command(judge, 'openBallot', { kind: 'exile' });
  for (const p of players) await command(p, 'vote', { target: wolfId });
  await judge.refresh();
  assert(judge.state.game.players.find((p) => p.id === wolfId).alive);
  await command(judge, 'confirmBallot');
  assert.equal(judge.state.game.winner.factions[0], 'good');
  await command(judge, 'end', { confirm: true });
  assert.equal(judge.state.game.phase, 'ended');
  const resumed = await client(session);
  assert.equal(resumed.state.game.phase, 'ended');
  assert.equal(resumed.state.judge, true);
  const replay = await fetch(
    base + '/api/rooms/' + session.code + '/replay?game=' + resumed.state.game.id + '&view=public',
    { headers: { Authorization: 'Bearer ' + session.token } },
  ).then((r) => r.json());
  assert.equal(replay.perspective, 'public');
  assert(!replay.deaths);
  if (process.env.TEST_SESSION_FILE)
    await writeFile(
      process.env.TEST_SESSION_FILE,
      JSON.stringify({ ...session, game: resumed.state.game.id }),
    );
  console.log(
    'PASS: complete multiplayer game, permissions, takeover/reclaim, reconnect, and public replay',
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  for (const c of clients) c.ws.close();
}
