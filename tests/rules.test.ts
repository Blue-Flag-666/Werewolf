import { describe, it, expect } from 'vitest';
import { type Actor, type Game, type Role, defaultRules } from '../src/core/model';
import { createGame, kill, checkVictory, settleNight, speechOrder } from '../src/core/rules';
import { applyCommand } from '../src/core/engine';
import { project, exportReplay } from '../src/core/views';
const fixed = (max: number) => max - 1;
function game(
  roles: Role[] = ['wolf', 'seer', 'witch', 'villager', 'hunter', 'guard', 'knight', 'whiteWolf'],
) {
  return createGame(
    roles,
    roles.map((_, i) => ({ id: 'p' + i, name: '玩家' + i })),
    structuredClone(defaultRules),
    1000,
    fixed,
  );
}
function cmd(
  g: Game,
  type: string,
  payload: Record<string, unknown> = {},
  who: Actor = { judge: true },
  now = 2000,
) {
  return applyCommand(
    g,
    { id: crypto.randomUUID(), version: g.version, type, payload },
    who,
    now,
    fixed,
  );
}
function hiddenPoison(role: 'whiteWolf' | 'knight') {
  const g = game([role, 'witch', 'wolf', 'villager', 'seer']);
  g.round = 1;
  g.phase = 'nightDone';
  g.night.poisons = [{ source: 'p1', target: 'p0' }];
  settleNight(g, 1500);
  return g;
}
describe('发牌、权限与确认', () => {
  it('安全打乱后角色数量与座位一致', () => {
    const g = game();
    expect(g.players.map((p) => p.role).sort()).toEqual(
      ['wolf', 'seer', 'witch', 'villager', 'hunter', 'guard', 'knight', 'whiteWolf'].sort(),
    );
    expect(g.players.map((p) => p.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('普通行动确认和下一角色开始是两个步骤', () => {
    let g = game();
    for (const p of g.players) g = cmd(g, 'identity', { actor: p.id });
    g = cmd(g, 'startNight');
    expect(g.night.awaitingNext).toBe(true);
    expect(() => cmd(g, 'submitAction', { actor: 'p5', target: 'p3' })).toThrow();
    g = cmd(g, 'nextRole');
    g = cmd(g, 'submitAction', { actor: 'p5', target: 'p3' });
    expect(g.night.guard).toBeUndefined();
    g = cmd(g, 'confirmAction');
    expect(g.night.guard).toBe('p3');
    expect(g.night.awaitingNext).toBe(true);
    expect(() => cmd(g, 'submitAction', { actor: 'p0', target: 'p3' })).toThrow();
  });
  it('狼人分别确认目标，一致后可采用，法官也可直接裁定整体刀口', () => {
    const begin = () => {
      let state = game(['wolf', 'whiteWolf', 'villager', 'seer']);
      for (const p of state.players) state = cmd(state, 'identity', { actor: p.id });
      state = cmd(state, 'startNight');
      return cmd(state, 'nextRole');
    };
    let g = begin();
    const wolves = g.players.filter((p) => p.faction === 'wolves');
    const targets = g.players.filter((p) => p.faction === 'good');
    g = cmd(g, 'submitAction', { target: targets[0].id }, { judge: false, player: wolves[0].id });
    g = cmd(g, 'submitAction', { target: targets[1].id }, { judge: false, player: wolves[1].id });
    expect(project(g, { judge: false, player: wolves[0].id }).wolfVotes).toEqual(g.night.wolfVotes);
    expect(project(g, { judge: false, player: targets[0].id }).wolfVotes).toBeUndefined();
    expect(() => cmd(g, 'confirmAction')).toThrow('意见尚未一致');
    g = cmd(g, 'submitAction', { target: targets[0].id }, { judge: false, player: wolves[1].id });
    g = cmd(g, 'confirmAction');
    expect(g.night.knife).toBe(targets[0].id);

    let decided = begin();
    const finalTarget = decided.players.find((p) => p.faction === 'good')!;
    decided = cmd(decided, 'confirmAction', { target: finalTarget.id });
    expect(decided.night.knife).toBe(finalTarget.id);

    let empty = begin();
    empty = cmd(empty, 'confirmAction', { pass: true });
    expect(empty.night.knife).toBeUndefined();
    expect(empty.night.awaitingNext).toBe(true);
  });
  it('重复命令幂等，过期版本拒绝', () => {
    const g = game();
    const c = { id: 'one', version: 0, type: 'identity', payload: { actor: 'p0' } };
    const next = applyCommand(g, c, { judge: true });
    expect(applyCommand(next, c, { judge: true })).toBe(next);
    expect(() => applyCommand(next, { ...c, id: 'two' }, { judge: true })).toThrow('状态已更新');
  });
  it('玩家不能伪造法官或替他人操作', () => {
    const g = game();
    expect(() => cmd(g, 'startNight', {}, { judge: false })).toThrow();
    expect(() => cmd(g, 'identity', { actor: 'p0' }, { judge: false })).toThrow();
  });
  it('普通超时不自动推进', () => {
    let g = game();
    g.phase = 'night';
    g.night = {
      order: ['p1'],
      index: 0,
      awaitingNext: false,
      saves: [],
      poisons: [],
      wolfVotes: {},
    };
    g.timer = { started: 0, deadline: 1, remaining: 1, paused: false, duration: 1 };
    g = cmd(g, 'timeout');
    expect(g.phase).toBe('night');
    expect(g.night.index).toBe(0);
  });
});
describe('两段式中断与隐藏死亡', () => {
  it('首夜毒死白狼王，警长竞选可自爆但不能带人，仍结束白天', () => {
    let g = hiddenPoison('whiteWolf');
    const first = g.players[0].deathId;
    expect(g.phase).toBe('signup');
    expect(g.players[0].publicDead).toBe(false);
    g = cmd(g, 'interrupt', { actor: 'p0' });
    expect(g.interrupt?.kind).toBe('whiteWolf');
    expect(g.players[3].alive).toBe(true);
    g = cmd(g, 'interruptTarget', { target: 'p3' });
    expect(g.players[3].alive).toBe(true);
    expect(g.phase).toBe('awaitNight');
    expect(g.players[0].deathId).toBe(first);
    expect(g.deaths.find((d) => d.id === first)?.cause).toBe('poison');
    expect(g.deaths.filter((d) => d.effective && d.target === 'p0')).toHaveLength(1);
  });
  it('首夜毒死骑士，决斗失效并恢复警长流程，不创建发言计时', () => {
    let g = hiddenPoison('knight');
    const original = g.players[0].deathId;
    g = cmd(g, 'interrupt', { actor: 'p0' });
    g = cmd(g, 'interruptTarget', { target: 'p2' });
    expect(g.phase).toBe('signup');
    expect(g.timer).toBeUndefined();
    expect(g.players[2].alive).toBe(true);
    expect(g.players[0].deathId).toBe(original);
  });
  it('死亡骑士打断发言后恢复完整倒计时', () => {
    let g = hiddenPoison('knight');
    g.phase = 'speech';
    g.speech = ['p3', 'p2'];
    g.timer = { started: 0, deadline: 2200, remaining: 90000, duration: 90000, paused: false };
    g = cmd(g, 'interrupt', { actor: 'p0' });
    g = cmd(g, 'interruptTarget', { target: 'p2' }, { judge: true }, 3000);
    expect(g.timer?.deadline).toBe(93000);
    expect(g.speech).toEqual(['p3', 'p2']);
  });
  it('白狼王有效带人与超时未选均结束白天', () => {
    let g = game();
    g.phase = 'speech';
    g = cmd(g, 'interrupt', { actor: 'p7' });
    let result = cmd(g, 'interruptTarget', { target: 'p3' });
    expect(result.players[3].alive).toBe(false);
    expect(result.phase).toBe('awaitNight');
    result = cmd(g, 'timeout', {}, { judge: true }, 40000);
    expect(result.players[3].alive).toBe(true);
    expect(result.players[7].alive).toBe(false);
    expect(result.phase).toBe('awaitNight');
  });
  it('骑士成功杀狼入夜，失败自己死亡，未选消耗并恢复', () => {
    let g = game();
    g.phase = 'speech';
    g = cmd(g, 'interrupt', { actor: 'p6' });
    const success = cmd(g, 'interruptTarget', { target: 'p0' });
    expect(success.players[0].alive).toBe(false);
    expect(success.phase).toBe('awaitNight');
    const failed = cmd(g, 'interruptTarget', { target: 'p3' });
    expect(failed.players[6].alive).toBe(false);
    expect(failed.phase).toBe('speech');
    const timeout = cmd(g, 'timeout', {}, { judge: true }, 50000);
    expect(timeout.players[6].usedKnight).toBe(true);
    expect(timeout.players[6].alive).toBe(true);
    expect(timeout.phase).toBe('speech');
  });
  it('中断不能重叠，刷新快照保留目标窗口', () => {
    let g = game();
    g.phase = 'speech';
    g = cmd(g, 'interrupt', { actor: 'p7' });
    expect(() => cmd(g, 'interrupt', { actor: 'p6' })).toThrow();
    const restored = JSON.parse(JSON.stringify(g));
    expect(cmd(restored, 'interruptTarget', { target: 'p3' }).phase).toBe('awaitNight');
  });
  it('公开信息不会包含毒杀原因为何导致失效', () => {
    let g = hiddenPoison('whiteWolf');
    g = cmd(g, 'interrupt', { actor: 'p0' });
    g = cmd(g, 'interruptTarget', { target: 'p3' });
    const serialized = JSON.stringify(project(g, { judge: false }).events);
    expect(serialized).not.toContain('poison');
    expect(serialized).not.toContain('女巫');
    expect(serialized).not.toContain('实际死亡');
  });
});
describe('死亡、投票、阵营和复盘', () => {
  it('多来源死亡保留原死因，复活不返药，重新死亡创建记录', () => {
    let g = game();
    g.phase = 'speech';
    g.players[2].medicine.poison = 0;
    const first = kill(g, 'p2', 'knife', 1000, 'p0');
    kill(g, 'p2', 'poison', 1001, 'p2');
    expect(g.deaths[1].effective).toBe(false);
    g = cmd(g, 'revive', { target: 'p2' });
    expect(g.players[2].medicine.poison).toBe(0);
    kill(g, 'p2', 'judge', 3000);
    expect(g.players[2].deathId).not.toBe(first.id);
    expect(g.deaths.filter((d) => d.effective)).toHaveLength(2);
  });
  it('猎人和狼王按死因判断技能，连锁结束才判胜', () => {
    const g = game(['wolfKing', 'hunter', 'villager', 'seer']);
    kill(g, 'p0', 'poison', 1000);
    expect(g.deathQueue).toHaveLength(0);
    g.players[0].alive = true;
    kill(g, 'p0', 'exile', 1100);
    expect(g.deathQueue).toHaveLength(1);
    checkVictory(g);
    expect(g.winner).toBeUndefined();
    kill(g, 'p1', 'shot', 1200);
    expect(g.deathQueue).toHaveLength(2);
  });
  it('无神职和无平民版型不会因空分组立即屠边胜利', () => {
    for (const deck of [
      ['wolf', 'villager', 'villager', 'villager'],
      ['wolf', 'seer', 'witch', 'guard'],
    ] as Role[][]) {
      const g = game(deck);
      checkVictory(g);
      expect(g.winner).toBeUndefined();
    }
  });
  it('屠城和多个第三方阵营独立判断', () => {
    const g = game(['wolf', 'seer', 'witch', 'guard']);
    g.rules.win = 'city';
    g.rules.thirdParties = [
      { id: 'a', label: 'A', condition: 'soleSurvivors', priority: 10, shared: false },
      { id: 'b', label: 'B', condition: 'parity', priority: 5, shared: true },
    ];
    g.players[1].faction = 'a';
    g.players[2].faction = 'b';
    kill(g, 'p3', 'judge', 1000);
    checkVictory(g);
    expect(g.winner?.factions).toContain('wolves');
    g.players[0].faction = 'a';
    g.players[2].faction = 'a';
    checkVictory(g);
    expect(g.winner?.factions).toEqual(['a']);
  });
  it('放逐投票确认后才死亡，白痴翻牌免死失去票权', () => {
    let g = game(['wolf', 'idiot', 'seer', 'villager']);
    g.phase = 'speech';
    g = cmd(g, 'openBallot', { kind: 'exile' });
    for (const p of g.players) g = cmd(g, 'vote', { actor: p.id, target: 'p1' });
    expect(g.players[1].idiotRevealed).toBe(false);
    g = cmd(g, 'confirmBallot');
    expect(g.players[1].alive).toBe(true);
    expect(g.players[1].idiotRevealed).toBe(true);
    g.phase = 'speech';
    g = cmd(g, 'openBallot', { kind: 'exile' });
    expect(g.ballot?.voters).not.toContain('p1');
  });
  it('警长平票、重投、弃票与移交撕徽', () => {
    let g = game();
    g.phase = 'signup';
    g = cmd(g, 'signup', { actor: 'p0' });
    g = cmd(g, 'signup', { actor: 'p1' });
    g = cmd(g, 'confirmSignup');
    g = cmd(g, 'openBallot', { kind: 'sheriff' });
    g = cmd(g, 'vote', { actor: 'p2', target: 'p0' });
    g = cmd(g, 'vote', { actor: 'p3', target: 'p1' });
    g = cmd(g, 'confirmBallot', { close: true });
    expect(g.ballot?.tied).toHaveLength(2);
    expect(g.sheriff).toBeUndefined();
    g = cmd(g, 'revote');
    g = cmd(g, 'vote', { actor: 'p2', target: 'p0' });
    g = cmd(g, 'confirmBallot', { close: true });
    expect(g.sheriff).toBe('p0');
    kill(g, 'p0', 'judge', 3000);
    g = cmd(g, 'badge', { target: 'p3' });
    expect(g.sheriff).toBe('p3');
    kill(g, 'p3', 'judge', 3000);
    g = cmd(g, 'badge');
    expect(g.sheriff).toBeUndefined();
  });
  it('法官可一次确认多个报名玩家', () => {
    let g = game();
    g.phase = 'signup';
    g = cmd(g, 'confirmSignup', { candidates: ['p2', 'p4'] });
    expect(g.candidates).toEqual(['p2', 'p4']);
    expect(g.speech).toEqual(['p2', 'p4']);
    expect(g.phase).toBe('campaign');
  });
  it('确认退水后跳过无竞争投票或让警徽流失', () => {
    let sole = game();
    sole.phase = 'signup';
    sole = cmd(sole, 'confirmSignup', { candidates: ['p0', 'p1'] });
    sole = cmd(sole, 'withdraw', { actor: 'p1' });
    sole = cmd(sole, 'confirmWithdraw');
    expect(sole.sheriff).toBe('p0');
    expect(sole.phase).toBe('announce');

    let none = game();
    none.phase = 'signup';
    none = cmd(none, 'confirmSignup', { candidates: ['p0', 'p1'] });
    none = cmd(none, 'withdraw', { actor: 'p0' });
    none = cmd(none, 'withdraw', { actor: 'p1' });
    none = cmd(none, 'confirmWithdraw');
    expect(none.sheriff).toBeUndefined();
    expect(none.electionDone).toBe(true);
    expect(none.phase).toBe('announce');
    expect(none.events.at(-1)?.publicText).toContain('警徽流失');
  });
  it('临时举手不判死', () => {
    let g = game();
    g.phase = 'speech';
    g = cmd(g, 'openBallot', { kind: 'hands' });
    g = cmd(g, 'vote', { actor: 'p1', target: '举手' });
    g = cmd(g, 'confirmBallot', { close: true });
    expect(g.players.every((p) => p.alive)).toBe(true);
    expect(g.phase).toBe('speech');
  });
  it('无警长随机死者起点与方向，平安夜不固定', () => {
    const g = game();
    g.phase = 'speech';
    g.nightDeaths = ['p0', 'p2'];
    g.players[0].publicDead = true;
    g.players[2].publicDead = true;
    speechOrder(g, 2000, () => 0);
    const a = [...g.speech];
    speechOrder(g, 3000, (max) => max - 1);
    expect(g.speech).not.toEqual(a);
    expect(g.speech).not.toContain('p0');
    g.nightDeaths = [];
    speechOrder(g, 3000, () => 0);
    expect(g.speech.length).toBe(6);
  });
  it('公共/玩家视角不泄漏身份；复盘过去阶段无最终身份倒灌', () => {
    const g = game();
    const p = project(g, { judge: false, player: 'p1' });
    expect('own' in p && p.own?.role).toBe('seer');
    expect(p.players.find((p) => p.id === 'p2')?.role).toBeUndefined();
    expect(() => exportReplay(g, { judge: false }, 'judge')).toThrow();
    g.phase = 'ended';
    expect(exportReplay(g, { judge: false }, 'p1', 1)).not.toHaveProperty('reveal');
    expect(JSON.stringify(exportReplay(g, { judge: false }, 'public', 1))).not.toContain('witch');
  });
  it('单机完整一局：确认、夜间、公布、发言、放逐、确认胜利', () => {
    let g = game(['wolf', 'villager', 'villager', 'villager']);
    g.rules.sheriff = false;
    g.electionDone = true;
    for (const p of g.players) g = cmd(g, 'identity', { actor: p.id });
    g = cmd(g, 'startNight');
    g = cmd(g, 'nextRole');
    g = cmd(g, 'submitAction', { actor: 'p0', pass: true });
    g = cmd(g, 'confirmAction');
    g = cmd(g, 'nextRole');
    g = cmd(g, 'settleNight');
    g = cmd(g, 'announce');
    g = cmd(g, 'startSpeech');
    g = cmd(g, 'openBallot', { kind: 'exile' });
    for (const p of g.players) g = cmd(g, 'vote', { actor: p.id, target: 'p0' });
    g = cmd(g, 'confirmBallot');
    expect(g.winner?.factions).toEqual(['good']);
    g = cmd(g, 'end', { confirm: true });
    expect(g.phase).toBe('ended');
    expect(exportReplay(g, { judge: true }, 'judge')).toHaveProperty('deaths');
  });
  it('法官可结束卡在投票、技能或死亡连锁中的本局', () => {
    let g = game();
    g.phase = 'speech';
    g = cmd(g, 'openBallot', { kind: 'single', title: '测试表决' });
    g.interrupt = {
      actor: 'p7',
      kind: 'whiteWolf',
      phase: 'speech',
      targetTimer: {
        started: 1000,
        deadline: 31000,
        remaining: 30000,
        paused: false,
        duration: 30000,
      },
      speechIndex: 0,
    };
    g.deathQueue = ['pending-death'];
    g.pendingDeath = { actor: 'p0', target: 'p1' };
    g = cmd(g, 'end', { confirm: true });
    expect(g.phase).toBe('ended');
    expect(g.ballot).toBeUndefined();
    expect(g.interrupt).toBeUndefined();
    expect(g.deathQueue).toEqual([]);
    expect(g.pendingDeath).toBeUndefined();
  });
});
