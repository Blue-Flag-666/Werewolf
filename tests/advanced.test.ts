import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultRules, type Game, type Role } from '../src/core/model';
import { createGame, settleNight, kill } from '../src/core/rules';
import { applyCommand } from '../src/core/engine';
import { project } from '../src/core/views';
import { Table, type GameView } from '../src/Table';
function game(roles: Role[] = ['wolf', 'witch', 'guard', 'seer', 'hunter', 'villager']) {
  return createGame(
    roles,
    roles.map((_, i) => ({ id: String(i), name: String(i) })),
    structuredClone(defaultRules),
    0,
    (max) => max - 1,
  );
}
function run(g: Game, type: string, payload: Record<string, unknown> = {}, now = 1000) {
  return applyCommand(
    g,
    { id: crypto.randomUUID(), version: g.version, type, payload },
    { judge: true },
    now,
  );
}
describe('夜间用药、连锁与恢复', () => {
  it('同守同救配置决定刀伤，毒杀仍独立生效', () => {
    for (const kills of [false, true]) {
      const g = game();
      g.round = 1;
      g.phase = 'nightDone';
      g.rules.saveAndGuardKills = kills;
      g.night.knife = '5';
      g.night.guard = '5';
      g.night.saves = ['5'];
      settleNight(g, 100);
      expect(g.players[5].alive).toBe(!kills);
    }
    const g = game();
    g.night.knife = '5';
    g.night.guard = '5';
    g.night.poisons = [{ source: '1', target: '5' }];
    settleNight(g, 100);
    expect(g.deaths[0].effective).toBe(false);
    expect(g.deaths[1].cause).toBe('poison');
    expect(g.deaths[1].effective).toBe(true);
  });
  it('女巫首夜自救可用，确认前不消耗，非首夜自救及双药受限', () => {
    let g = game();
    g.round = 1;
    g.phase = 'night';
    g.night = {
      order: ['1'],
      index: 0,
      awaitingNext: false,
      knife: '1',
      saves: [],
      poisons: [],
      wolfVotes: {},
    };
    g = run(g, 'submitAction', { actor: '1', save: true });
    expect(g.players[1].medicine.save).toBe(0);
    g.night.index = 0;
    g.night.awaitingNext = false;
    g.players[1].medicine.save = 1;
    g.round = 2;
    expect(() => run(g, 'submitAction', { actor: '1', save: true })).toThrow('自救');
    g.round = 1;
    expect(() => run(g, 'submitAction', { actor: '1', save: true, poison: '5' })).toThrow('双药');
  });
  it('守卫自守和连守配置由规则引擎验证', () => {
    const g = game();
    g.phase = 'night';
    g.night = {
      order: ['2'],
      index: 0,
      awaitingNext: false,
      saves: [],
      poisons: [],
      wolfVotes: {},
    };
    g.rules.guardSelf = false;
    expect(() => run(g, 'submitAction', { actor: '2', target: '2' })).toThrow('自守');
    g.players[2].lastGuard = '5';
    expect(() => run(g, 'submitAction', { actor: '2', target: '5' })).toThrow('连续');
  });
  it('法官代为查验后直接进入本人历史', () => {
    let g = game();
    g.phase = 'night';
    g.night = {
      order: ['3'],
      index: 0,
      awaitingNext: false,
      saves: [],
      poisons: [],
      wolfVotes: {},
    };
    g = run(g, 'submitAction', { actor: '3', target: '0' });
    expect(g.players[3].checks[0].result).toBe('狼人');
    expect(JSON.stringify(project(g, { judge: false, player: '5' }))).not.toContain('查验表现');
  });
  it('猎人首夜暗死不阻止竞选，不提前公开死亡技能', () => {
    let g = game();
    g.round = 1;
    g.phase = 'nightDone';
    g.night.knife = '4';
    settleNight(g, 100);
    expect(g.deathQueue).toHaveLength(1);
    g = run(g, 'signup', { actor: '5' });
    g = run(g, 'signup', { actor: '2' });
    g = run(g, 'confirmSignup');
    g = run(g, 'nextSpeaker');
    g = run(g, 'nextSpeaker');
    g = run(g, 'openBallot', { kind: 'sheriff' });
    expect(g.phase).toBe('sheriffVote');
    expect(project(g, { judge: false })).toHaveProperty('deathActor', undefined);
  });
  it('自爆后先公布暗死猎人，再处理技能，不能误恢复白天', () => {
    let g = game();
    g.round = 1;
    g.phase = 'nightDone';
    g.night.knife = '4';
    settleNight(g, 100);
    g = run(g, 'interrupt', { actor: '0' });
    expect(g.phase).toBe('awaitNight');
    g = run(g, 'startNight');
    expect(g.phase).toBe('deathSkill');
    expect(g.players[4].publicDead).toBe(true);
    g = run(g, 'skipDeath');
    expect(g.phase).toBe('awaitNight');
  });
  it('临时投票锁定原流程，取消后恢复原剩余时间', () => {
    let g = game();
    g.phase = 'speech';
    g.timer = { started: 0, deadline: 10000, remaining: 10000, duration: 10000, paused: false };
    g = run(g, 'openBallot', { kind: 'hands' }, 1000);
    expect(() => run(g, 'nextSpeaker')).toThrow('当前投票');
    g = run(g, 'cancelBallot', {}, 5000);
    expect(g.timer?.deadline).toBe(14000);
  });
  it('遗言为独立阶段，结束后返回原阶段', () => {
    let g = game();
    g.phase = 'awaitNight';
    kill(g, '5', 'exile', 1000);
    g = run(g, 'lastWords', { target: '5' });
    expect(g.phase).toBe('lastWords');
    g = run(g, 'nextSpeaker');
    expect(g.phase).toBe('awaitNight');
  });
  it('法官登记死亡技能不发动后直接结算', () => {
    let g = game();
    g.phase = 'deathSkill';
    kill(g, '4', 'knife', 1000);
    g = run(g, 'skipDeath');
    expect(g.pendingDeath).toBeUndefined();
    expect(g.deathQueue).toHaveLength(0);
  });
});

describe('预言家查验结果', () => {
  it('确认后法官与预言家可见好坏，其他玩家和观战者不可见', () => {
    let g = game(['wolf', 'seer', 'villager', 'villager']);
    const seer = g.players.find((p) => p.role === 'seer')!;
    const wolf = g.players.find((p) => p.role === 'wolf')!;
    const other = g.players.find((p) => p.role === 'villager')!;
    g.phase = 'night';
    g.night.order = [seer.id];
    g.night.index = 0;
    g.night.awaitingNext = false;
    g = applyCommand(
      g,
      {
        id: crypto.randomUUID(),
        version: g.version,
        type: 'submitAction',
        payload: { target: wolf.id },
      },
      { judge: false, player: seer.id },
      1000,
    );
    expect(g.players.find((p) => p.id === seer.id)?.checks).toHaveLength(0);
    g = run(g, 'confirmAction');
    const render = (judge: boolean, player?: string) =>
      renderToStaticMarkup(
        createElement(Table, {
          g: project(g, { judge, player }) as GameView,
          judge,
          me: player,
          send: () => {},
          busy: false,
        }),
      );
    const result = `${wolf.seat} 号：<strong>狼人</strong>`;
    expect(render(true)).toContain(result);
    expect(render(false, seer.id)).toContain(result);
    expect(render(false, other.id)).not.toContain('查验结果');
    expect(render(false)).not.toContain('查验结果');
  });
});

describe('倒计时到期操作', () => {
  const renderJudge = (g: Game) =>
    renderToStaticMarkup(createElement(Table, { g, judge: true, send: () => {}, busy: false }));
  const pastTimer = () => ({
    started: Date.now() - 2000,
    deadline: Date.now() - 1000,
    remaining: 1000,
    paused: false,
    duration: 1000,
  });

  it('夜间到期可直接强制结束角色操作', () => {
    let g = game();
    g.phase = 'night';
    g.night.order = ['3'];
    g.night.index = 0;
    g.night.awaitingNext = false;
    g.timer = pastTimer();
    expect(renderJudge(g)).toContain('强制结束当前角色操作');
    g = run(g, 'skipRole');
    expect(g.night.awaitingNext).toBe(true);
    expect(g.night.index).toBe(1);
  });

  it('投票到期可直接结束并确认结果', () => {
    let g = game();
    g.phase = 'speech';
    g = run(g, 'openBallot', { kind: 'single' });
    g.ballot!.timer = pastTimer();
    const html = renderJudge(g);
    expect(html).toContain('结束投票并确认结果');
    expect(html).not.toContain('处理本阶段超时');
    g = run(g, 'confirmBallot', { close: true }, Date.now());
    expect(g.ballot).toBeUndefined();
  });

  it('发言和死亡技能到期显示对应的结束操作', () => {
    let campaign = game();
    campaign.phase = 'campaign';
    campaign.candidates = ['0', '1'];
    campaign.speech = ['0', '1'];
    campaign.speechIndex = 0;
    campaign.timer = pastTimer();
    expect(renderJudge(campaign)).toContain('结束当前发言');
    campaign = run(campaign, 'nextSpeaker');
    expect(campaign.speechIndex).toBe(1);

    let death = game();
    death.phase = 'deathSkill';
    kill(death, '4', 'knife', 1000);
    death.timer = pastTimer();
    expect(renderJudge(death)).toContain('结束死亡技能（不发动）');
    death = run(death, 'skipDeath');
    expect(death.deathQueue).toHaveLength(0);
  });
});

describe('配置数量和公开事件回归', () => {
  it('多个守卫行动不会互相覆盖', () => {
    let g = game(['wolf', 'guard', 'guard', 'villager']);
    g.phase = 'night';
    g.night = {
      order: ['1', '2'],
      index: 0,
      awaitingNext: false,
      saves: [],
      poisons: [],
      wolfVotes: {},
    };
    g = run(g, 'submitAction', { actor: '1', target: '3' });
    g = run(g, 'nextRole');
    g = run(g, 'submitAction', { actor: '2', target: '0' });
    g.night.knife = '3';
    settleNight(g, 2000);
    expect(g.players[3].alive).toBe(true);
    expect(g.night.guards).toHaveLength(2);
  });
  it('普通自爆不额外公开狼王特殊身份', () => {
    let g = game(['wolfKing', 'witch', 'guard', 'villager']);
    g.phase = 'speech';
    g = run(g, 'interrupt', { actor: '0' });
    const events = project(g, { judge: false }).events;
    const start = events.find((e) => e.kind === 'interruptStart');
    expect(start?.data).toEqual({ actor: '0' });
    expect(JSON.stringify(events)).not.toContain('wolfKing');
  });
});
