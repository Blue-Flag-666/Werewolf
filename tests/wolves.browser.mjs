import assert from 'node:assert/strict';

export async function testWolfConsensus(browser, base) {
  const sockets = [];
  const context = await browser.newContext();
  async function post(path, data) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    assert(response.ok);
    return response.json();
  }
  async function connect(session) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/api/rooms/' + session.code + '/socket');
    sockets.push(ws);
    let state;
    const waiting = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'state') {
        state = message.state;
        waiting.get('auth')?.(message);
      }
      waiting.get(message.id)?.(message);
    });
    const send = (type, payload = {}) =>
      new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const key = type === 'auth' ? 'auth' : id;
        const timer = setTimeout(() => reject(Error('Wolf test command timed out')), 10000);
        waiting.set(key, (message) => {
          clearTimeout(timer);
          waiting.delete(key);
          message.type === 'error' ? reject(Error(message.error)) : resolve(message);
        });
        ws.send(
          JSON.stringify({
            id,
            type,
            payload,
            ...(type === 'auth' ? { token: session.token } : {}),
          }),
        );
      });
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    await send('auth');
    return {
      send,
      get state() {
        return state;
      },
      async command(type, payload = {}) {
        const response = await fetch(base + '/api/rooms/' + session.code + '/state', {
          headers: { Authorization: 'Bearer ' + session.token },
        });
        const latest = await response.json();
        await send('command', {
          command: { id: crypto.randomUUID(), version: latest.game.version, type, payload },
        });
      },
    };
  }
  try {
    const session = await post('/api/create', { name: '法官' });
    const judge = await connect(session);
    const players = [];
    for (let i = 0; i < 6; i++) {
      const player = await connect(
        await post('/api/rooms/' + session.code + '/join', { name: '玩家' + i }),
      );
      await player.send('seat', { seat: i + 1 });
      players.push(player);
    }
    await judge.send('configure', {
      roles: ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager'],
      rules: { sheriff: false },
    });
    await judge.send('start');
    for (const player of players) await player.command('identity');
    await judge.command('startNight');
    await judge.command('nextRole');
    const page = await context.newPage();
    await page.addInitScript(
      (value) => localStorage.setItem('room-session', JSON.stringify(value)),
      session,
    );
    await page.goto(base + '/');
    await page.getByRole('button', { name: '恢复联机房间 ' + session.code, exact: true }).click();
    const picker = page.getByRole('group', { name: '法官最终目标', exact: true });
    await picker.waitFor();
    const wolves = players.filter((player) => player.state.game.own.faction === 'wolves');
    assert.equal(wolves.length, 4);
    const target = judge.state.game.players.find((player) => player.faction === 'good');
    const targetButton = picker.getByRole('button', {
      name: new RegExp('^' + target.seat + ' 号'),
    });
    for (let i = 0; i < wolves.length; i++) {
      await wolves[i].command('submitAction', { target: target.id });
      await page
        .locator('.team-choices')
        .getByText(
          new RegExp(
            '^' +
              wolves[i].state.game.players.find((p) => p.id === wolves[i].state.self).seat +
              ' 号.*：' +
              target.seat +
              ' 号$',
          ),
        )
        .waitFor();
      if (i < 3) assert.equal(await targetButton.getAttribute('aria-pressed'), 'false');
    }
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="法官最终目标"] [aria-pressed="true"]'),
    );
    assert.equal(await targetButton.getAttribute('aria-pressed'), 'true');
    await wolves[0].command('submitAction', { pass: true });
    await page.getByText('等待全员提交并统一意见', { exact: true }).waitFor();
    assert.equal(await targetButton.getAttribute('aria-pressed'), 'false');
    for (const wolf of wolves.slice(1)) await wolf.command('submitAction', { pass: true });
    const empty = page
      .getByRole('group', { name: '狼人最终操作' })
      .getByRole('button', { name: /不选/ });
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="狼人最终操作"] [aria-pressed="true"]'),
    );
    assert.equal(await empty.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '清空狼人选择', exact: true }).click();
    await page.getByText('等待全员提交并统一意见', { exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="狼人最终操作"] [aria-pressed="true"]'),
    );
    assert.equal(await empty.getAttribute('aria-pressed'), 'false');
    console.log(
      'PASS: four wolves sync live, unanimity selects target/empty knife, changed or cleared votes remove selection',
    );
  } finally {
    for (const socket of sockets) socket.close();
    await context.close();
  }
}
