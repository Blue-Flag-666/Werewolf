import {
  type Game,
  type Actor,
  type Action,
  type Command,
  type Phase,
  type Random,
  makeTimer,
  expired,
  remaining,
  secureRandom,
} from './model';
import {
  assert,
  player,
  event,
  kill,
  checkVictory,
  startNight,
  settleNight,
  announce,
  speechOrder,
} from './rules';
const daytime: Phase[] = ['signup', 'campaign', 'sheriffVote', 'announce', 'speech', 'exileVote'];
const text = (v: unknown) => (typeof v === 'string' ? v : '');
function target(g: Game, id: string | undefined) {
  assert(id, '请选择目标');
  const p = player(g, id);
  assert(p.alive, '目标无行动资格');
  return p;
}
function finishInterrupt(g: Game, now: number, chosen?: string) {
  const i = g.interrupt;
  assert(i, '当前没有中断技能');
  const p = player(g, i.actor);
  const t = chosen ? player(g, chosen) : undefined;
  if (t) assert(!t.publicDead && t.id !== p.id, '目标不合法');
  event(
    g,
    now,
    'interruptTarget',
    `${p.seat} 号选择 ${t?.seat ?? '不选择'}`,
    { actor: p.id, target: chosen },
    `${p.seat} 号${t ? `选择 ${t.seat} 号` : '未选择目标'}`,
  );
  let endsDay = i.kind === 'whiteWolf';
  if (i.kind === 'whiteWolf') {
    const effective = p.alive;
    kill(g, p.id, 'explosion', now, p.id);
    p.publicDead = true;
    const original = g.deaths.find((d) => d.id === p.deathId);
    if (original) original.publicAt = now;
    if (t)
      kill(
        g,
        t.id,
        'whiteWolf',
        now,
        p.id,
        false,
        effective ? undefined : '发动者已实际死亡，带人失效',
      );
  } else if (t && p.alive && t.alive) {
    if (t.faction === 'wolves') {
      kill(g, t.id, 'duel', now, p.id);
      endsDay = true;
    } else kill(g, p.id, 'duel', now, p.id);
  } else
    event(
      g,
      now,
      'duelFailed',
      '决斗无效果：未选目标或实际死亡',
      {
        actor: p.id,
        target: chosen,
        reason: !p.alive ? '发动者已实际死亡' : !t ? '未选择目标' : '目标实际死亡',
      },
      '决斗未产生效果，恢复白天流程',
    );
  g.interrupt = undefined;
  if (endsDay) {
    g.phase = 'awaitNight';
    g.ballot = undefined;
    g.timer = undefined;
    if (g.rules.explosionEndsElection) g.electionDone = true;
  } else {
    g.phase = i.phase;
    g.ballot = i.ballot;
    g.speechIndex = i.speechIndex;
    g.timer =
      i.phase === 'speech' || i.phase === 'campaign'
        ? makeTimer(g.rules.speechSeconds, now)
        : i.timer;
    if (g.ballot) {
      g.ballot.timer.started = now;
      g.ballot.timer.deadline =
        g.ballot.timer.paused || !g.ballot.timer.duration ? null : now + g.ballot.timer.remaining;
    }
  }
  if (
    g.deathQueue.length &&
    g.deathQueue.every((id) => g.deaths.find((d) => d.id === id)?.publicAt !== undefined) &&
    endsDay
  ) {
    g.deathReturn = 'awaitNight';
    g.phase = 'deathSkill';
  }
  event(
    g,
    now,
    'interruptEnd',
    endsDay ? '白天结束，等待法官入夜' : '恢复被中断流程',
    { endsDay },
    endsDay ? '白天已结束，等待法官确认入夜' : '继续白天流程',
  );
  checkVictory(g);
}
function validateAction(g: Game, a: Action) {
  const current = g.night.order[g.night.index];
  assert(current, '没有当前夜间角色');
  const p = player(g, a.actor);
  assert(p.alive, '角色已无夜间行动资格');
  assert(current === 'wolves' ? p.faction === 'wolves' : current === p.id, '尚未轮到该角色');
  if (a.pass) {
    assert(current !== 'wolves' || g.rules.emptyKnife, '本局不允许空刀');
    return;
  }
  if (current === 'wolves') {
    target(g, a.target);
    return;
  }
  if (p.role === 'seer') {
    assert(target(g, a.target).id !== p.id, '不能查验自己');
  }
  if (p.role === 'guard') {
    const t = target(g, a.target);
    assert(g.rules.guardSelf || t.id !== p.id, '禁止自守');
    assert(g.rules.guardRepeat || p.lastGuard !== t.id, '不能连续守同一人');
  }
  if (p.role === 'witch') {
    assert(a.save || a.poison, '请选择用药或不发动');
    assert(!(a.save && a.poison) || g.rules.doubleMedicine, '本局禁止同夜双药');
    if (a.save) {
      assert(p.medicine.save > 0 && g.night.knife, '没有可用解药或刀口');
      assert(
        g.night.knife !== p.id || (g.round === 1 ? g.rules.witchFirstSelf : g.rules.witchOtherSelf),
        '本夜不允许自救',
      );
    }
    if (a.poison) {
      assert(p.medicine.poison > 0, '毒药已耗尽');
      target(g, a.poison);
    }
  }
}
function confirmAction(g: Game, now: number) {
  const a = g.night.pending;
  assert(a, '没有待确认行动');
  validateAction(g, a);
  const p = player(g, a.actor),
    current = g.night.order[g.night.index];
  if (!a.pass) {
    if (current === 'wolves') g.night.knife = a.target;
    else if (p.role === 'guard') {
      g.night.guard = a.target;
      (g.night.guards ??= []).push({ source: p.id, target: a.target! });
      p.lastGuard = a.target;
    } else if (p.role === 'witch') {
      if (a.save) {
        p.medicine.save--;
        g.night.saves.push(g.night.knife!);
      }
      if (a.poison) {
        p.medicine.poison--;
        g.night.poisons.push({ source: p.id, target: a.poison });
      }
    } else if (p.role === 'seer') {
      const t = target(g, a.target);
      const e = event(
        g,
        now,
        'check',
        `${p.seat} 号查验 ${t.seat} 号：${t.appearance}`,
        { actor: p.id, target: t.id, result: t.appearance },
        undefined,
        { [p.id]: `${t.seat} 号查验表现：${t.appearance}` },
      );
      p.checks.push({ target: t.id, result: t.appearance, round: g.round, event: e.seq });
    }
  } else if (p.role === 'guard') p.lastGuard = undefined;
  event(g, now, 'actionConfirmed', '法官确认角色操作', { ...a });
  g.night.pending = undefined;
  g.night.awaitingNext = true;
  g.night.index++;
  g.timer = undefined;
}
export function applyCommand(
  input: Game,
  c: Command,
  who: Actor,
  now = Date.now(),
  random: Random = secureRandom,
): Game {
  if (input.processed.includes(c.id)) return input;
  assert(c.id.length > 0 && c.id.length < 100, '命令标识无效');
  assert(c.version === input.version, '状态已更新，请重试');
  const g = structuredClone(input),
    d = c.payload ?? {};
  const judge = () => assert(who.judge, '仅法官可执行');
  const acting = () => {
    const id = who.judge ? text(d.actor) || who.player : who.player;
    assert(id, '没有座位控制权');
    return player(g, id);
  };
  assert(
    g.phase !== 'ended' || ['revive', 'faction', 'correct', 'noteEvent'].includes(c.type),
    '本局已结束',
  );
  if (g.interrupt)
    assert(
      ['interruptTarget', 'timer', 'timeout', 'correct'].includes(c.type),
      '不可中断技能正在选择目标',
    );
  if (g.ballot && !g.interrupt)
    assert(
      [
        'vote',
        'confirmBallot',
        'cancelBallot',
        'revote',
        'noWinner',
        'timer',
        'timeout',
        'interrupt',
      ].includes(c.type),
      '请先完成或取消当前投票',
    );
  switch (c.type) {
    case 'identity': {
      const p = acting();
      assert(g.phase === 'identity', '发牌已结束');
      p.confirmed = true;
      break;
    }
    case 'startNight':
      judge();
      assert(['identity', 'awaitNight'].includes(g.phase), '当前不能入夜');
      assert(g.phase !== 'identity' || g.players.every((p) => p.confirmed), '尚有人未确认身份');
      if (g.phase === 'awaitNight' && g.players.some((p) => !p.alive && !p.publicDead)) {
        announce(g, now);
        g.deathReturn = 'awaitNight';
        g.phase = g.deathQueue.length ? 'deathSkill' : 'awaitNight';
        break;
      }
      startNight(g, now);
      break;
    case 'nextRole':
      judge();
      assert(g.phase === 'night' && g.night.awaitingNext, '先确认当前角色');
      if (g.night.index >= g.night.order.length) {
        g.phase = 'nightDone';
        break;
      }
      g.night.awaitingNext = false;
      g.timer = makeTimer(g.rules.actionSeconds, now);
      event(g, now, 'roleStart', '唤醒夜间角色', { actor: g.night.order[g.night.index] });
      break;
    case 'submitAction': {
      assert(g.phase === 'night' && !g.night.awaitingNext, '当前不能提交');
      assert(!expired(g.timer, now), '操作时间已截止');
      const p = acting();
      const a: Action = {
        actor: p.id,
        target: text(d.target) || undefined,
        save: d.save === true,
        poison: text(d.poison) || undefined,
        pass: d.pass === true,
      };
      validateAction(g, a);
      if (g.night.order[g.night.index] === 'wolves' && !who.judge) {
        g.night.wolfVotes[p.id] = a.target ?? null;
        event(g, now, 'wolfVote', '狼人团队提交目标', { ...a });
      } else {
        assert(!g.night.pending || who.judge, '已提交，等待法官');
        g.night.pending = a;
      }
      break;
    }
    case 'confirmAction':
      judge();
      assert(g.phase === 'night' && !g.night.awaitingNext, '当前不能确认');
      confirmAction(g, now);
      break;
    case 'rejectAction':
      judge();
      assert(g.phase === 'night', '非夜间阶段');
      assert(g.night.pending, '没有待驳回行动');
      event(g, now, 'rejected', '行动被驳回', { action: g.night.pending }, undefined, {
        [g.night.pending.actor]: '操作被法官驳回，请重新提交',
      });
      g.night.pending = undefined;
      g.timer = makeTimer(g.rules.actionSeconds, now);
      break;
    case 'skipRole':
      judge();
      assert(g.phase === 'night' && !g.night.awaitingNext, '没有进行中的角色');
      event(g, now, 'skipped', '法官跳过当前角色', { actor: g.night.order[g.night.index] });
      g.night.pending = undefined;
      g.night.index++;
      g.night.awaitingNext = true;
      g.timer = undefined;
      break;
    case 'settleNight':
      judge();
      assert(g.phase === 'nightDone', '夜间行动尚未结束');
      settleNight(g, now);
      break;
    case 'announce':
      judge();
      assert(g.phase === 'announce', '尚不能公布死亡');
      announce(g, now);
      break;
    case 'interrupt': {
      const p = acting();
      assert(daytime.includes(g.phase) && !p.publicDead, '不在公开技能窗口');
      assert(['whiteWolf', 'knight', 'wolf', 'wolfKing'].includes(p.role), '该角色没有此技能');
      assert(p.alive || ['whiteWolf', 'knight'].includes(p.role), '角色已无自爆资格');
      if (p.role === 'knight') {
        assert(!p.usedKnight || g.rules.knightRepeat, '决斗已使用');
        p.usedKnight = true;
      }
      event(
        g,
        now,
        'interruptStart',
        `${p.seat} 号发动 ${p.role === 'knight' ? '决斗' : '自爆'}`,
        { actor: p.id, role: p.role },
        `${p.seat} 号发动${p.role === 'knight' ? '决斗' : '自爆'}，当前流程中断`,
      );
      if (p.role === 'whiteWolf' || p.role === 'knight') {
        const ballot = g.ballot ? structuredClone(g.ballot) : undefined;
        if (ballot) ballot.timer.remaining = remaining(ballot.timer, now);
        g.interrupt = {
          actor: p.id,
          kind: p.role,
          phase: g.phase,
          timer: g.timer,
          speechIndex: g.speechIndex,
          ballot,
          targetTimer: makeTimer(g.rules.targetSeconds, now),
        };
      } else {
        kill(g, p.id, 'explosion', now, p.id);
        g.phase =
          g.deathQueue.length &&
          g.deathQueue.every((id) => g.deaths.find((d) => d.id === id)?.publicAt !== undefined)
            ? 'deathSkill'
            : 'awaitNight';
        g.deathReturn = 'awaitNight';
        g.ballot = undefined;
        g.timer = undefined;
        if (g.rules.explosionEndsElection) g.electionDone = true;
        checkVictory(g);
      }
      break;
    }
    case 'interruptTarget': {
      assert(g.interrupt, '没有待选择技能');
      assert(who.judge || who.player === g.interrupt.actor, '不是当前技能控制者');
      assert(!expired(g.interrupt.targetTimer, now), '目标选择已截止');
      finishInterrupt(g, now, text(d.target) || undefined);
      break;
    }
    case 'timeout': {
      if (g.interrupt && expired(g.interrupt.targetTimer, now)) finishInterrupt(g, now);
      else if (
        g.phase === 'night' &&
        expired(g.timer, now) &&
        !g.night.pending &&
        !g.night.awaitingNext
      ) {
        event(g, now, 'actionTimeout', '普通行动超时，等待法官处理', {
          actor: g.night.order[g.night.index],
        });
        g.timer = undefined;
      } else if (g.phase === 'deathSkill' && expired(g.timer, now) && !g.pendingDeath) {
        const death = g.deaths.find((x) => x.id === g.deathQueue[0]);
        if (death) g.pendingDeath = { actor: death.target, pass: true };
      } else
        assert(
          (g.ballot && expired(g.ballot.timer, now)) || expired(g.timer, now),
          '没有已到期计时器',
        );
      break;
    }
    case 'timer': {
      judge();
      const t = g.interrupt?.targetTimer ?? g.ballot?.timer ?? g.timer;
      assert(t, '当前没有计时器');
      const mode = text(d.mode),
        amount = Number(d.seconds);
      assert(
        !['extend', 'set'].includes(mode) || (Number.isFinite(amount) && Math.abs(amount) <= 3600),
        '时间无效',
      );
      if (mode === 'pause') {
        t.remaining = remaining(t, now);
        t.paused = true;
        t.deadline = null;
      }
      if (mode === 'resume') {
        t.paused = false;
        t.deadline = t.duration ? now + t.remaining : null;
      }
      if (mode === 'reset') {
        t.remaining = t.duration;
        t.deadline = t.paused || !t.duration ? null : now + t.duration;
      }
      if (mode === 'extend' || mode === 'set') {
        t.remaining = Math.max(0, (mode === 'set' ? 0 : remaining(t, now)) + amount * 1000);
        t.duration = Math.max(t.duration, t.remaining);
        t.deadline = t.paused ? null : now + t.remaining;
      }
      if (mode === 'end') {
        t.paused = false;
        t.deadline = now;
        t.remaining = 0;
      }
      event(g, now, 'timer', '法官调整计时', { mode, seconds: amount }, '法官已调整当前计时');
      break;
    }
    case 'startSpeech': {
      assert(who.judge || who.player === g.sheriff, '仅法官或警长可安排发言');
      assert(g.phase === 'speech' && !g.deathQueue.length, '先完成死亡技能');
      speechOrder(g, now, random, text(d.start) || undefined, Number(d.direction));
      break;
    }
    case 'nextSpeaker':
      judge();
      assert(['speech', 'campaign', 'lastWords'].includes(g.phase), '不在发言阶段');
      g.speechIndex++;
      g.timer = g.speechIndex < g.speech.length ? makeTimer(g.rules.speechSeconds, now) : undefined;
      event(
        g,
        now,
        'nextSpeaker',
        '下一位发言',
        { speaker: g.speech[g.speechIndex] },
        g.speechIndex < g.speech.length
          ? `${player(g, g.speech[g.speechIndex]).seat} 号发言`
          : '本轮发言结束',
      );
      if (g.phase === 'lastWords' && g.speechIndex >= g.speech.length) {
        g.phase = g.lastWordsReturn ?? 'speech';
        g.speech = [];
        g.speechIndex = 0;
      }
      break;
    default:
      applyOther(g, c, who, now);
  }
  g.version++;
  g.processed.push(c.id);
  g.processed = g.processed.slice(-512);
  return g;
}
function applyOther(g: Game, c: Command, who: Actor, now: number) {
  const d = c.payload ?? {};
  const judge = () => assert(who.judge, '仅法官可执行');
  const actor = () => {
    const id = who.judge ? text(d.actor) || who.player : who.player;
    assert(id, '没有座位控制权');
    return player(g, id);
  };
  switch (c.type) {
    case 'lastWords': {
      judge();
      assert(['speech', 'awaitNight'].includes(g.phase), '当前不能安排遗言');
      const p = player(g, text(d.target));
      assert(p.publicDead, '遗言仅用于已公布死亡玩家');
      g.lastWordsReturn = g.phase;
      g.phase = 'lastWords';
      g.speech = [p.id];
      g.speechIndex = 0;
      g.timer = makeTimer(g.rules.speechSeconds, now);
      event(g, now, 'lastWords', '法官安排死者遗言', { actor: p.id }, p.seat + ' 号发表遗言');
      break;
    }
    case 'rejectDeath':
      judge();
      assert(g.phase === 'deathSkill' && g.pendingDeath, '没有待确认死亡技能');
      event(g, now, 'rejected', '死亡技能提交被驳回', { actor: g.pendingDeath.actor }, undefined, {
        [g.pendingDeath.actor]: '死亡技能被驳回，请重新选择',
      });
      g.pendingDeath = undefined;
      g.timer = makeTimer(g.rules.actionSeconds, now);
      break;
    case 'skipDeath':
      judge();
      assert(g.phase === 'deathSkill' && g.deathQueue.length, '没有死亡技能');
      {
        const death = g.deaths.find((d) => d.id === g.deathQueue[0])!;
        g.pendingDeath = { actor: death.target, pass: true };
        event(g, now, 'deathTimeout', '法官登记不发动死亡技能', { actor: death.target });
      }
      break;
    case 'signup': {
      const p = actor();
      assert(g.phase === 'signup' && !p.publicDead, '当前不能上警');
      if (!g.candidates.includes(p.id)) g.candidates.push(p.id);
      event(
        g,
        now,
        'signup',
        `${p.seat} 号上警`,
        { actor: p.id },
        `${p.seat} 号申请上警，等待确认`,
      );
      break;
    }
    case 'confirmSignup':
      judge();
      assert(g.phase === 'signup', '不在报名阶段');
      g.phase = 'campaign';
      g.speech = [...g.candidates];
      g.speechIndex = 0;
      g.timer = makeTimer(g.rules.speechSeconds, now);
      event(
        g,
        now,
        'signupConfirmed',
        '确认上警名单',
        { candidates: g.candidates },
        `上警名单：${g.candidates.map((id) => player(g, id).seat).join('、') || '无人'}`,
      );
      break;
    case 'withdraw': {
      const p = actor();
      assert(g.phase === 'campaign' && g.candidates.includes(p.id), '当前不能退水');
      if (!g.withdrawals.includes(p.id)) g.withdrawals.push(p.id);
      event(
        g,
        now,
        'withdrawRequested',
        '申请退水',
        { actor: p.id },
        `${p.seat} 号申请退水，等待法官确认`,
      );
      break;
    }
    case 'confirmWithdraw':
      judge();
      assert(g.phase === 'campaign', '不在竞选阶段');
      g.candidates = g.candidates.filter((id) => !g.withdrawals.includes(id));
      event(
        g,
        now,
        'withdrawConfirmed',
        '确认退水',
        { players: g.withdrawals },
        `确认退水：${g.withdrawals.map((id) => player(g, id).seat).join('、') || '无人'}`,
      );
      g.withdrawals = [];
      break;
    case 'openBallot': {
      judge();
      assert(
        !g.deathQueue.some((id) => g.deaths.find((d) => d.id === id)?.publicAt !== undefined) &&
          !g.badgePending &&
          !g.ballot,
        '先处理当前技能、警徽或投票',
      );
      const kind = text(d.kind);
      assert(['exile', 'sheriff', 'single', 'yesno', 'hands'].includes(kind), '投票类型无效');
      assert(kind !== 'exile' || g.phase === 'speech', '放逐须在白天发言后');
      assert(kind !== 'sheriff' || g.phase === 'campaign', '警长投票须先确认报名');
      const eligible = g.players
        .filter(
          (p) =>
            !p.publicDead &&
            (kind !== 'exile' || !p.idiotRevealed) &&
            (kind !== 'sheriff' || !g.candidates.includes(p.id)),
        )
        .map((p) => p.id);
      const requested = Array.isArray(d.voters) ? d.voters.map(text) : eligible;
      assert(
        requested.every((id) => eligible.includes(id)),
        '选民无资格',
      );
      const candidates =
        kind === 'yesno'
          ? ['赞成', '反对']
          : kind === 'hands'
            ? ['举手']
            : kind === 'sheriff'
              ? [...g.candidates]
              : Array.isArray(d.candidates)
                ? d.candidates.map(text)
                : g.players.filter((p) => !p.publicDead).map((p) => p.id);
      if (!['yesno', 'hands'].includes(kind))
        assert(
          candidates.every((id) => !player(g, id).publicDead),
          '候选人无资格',
        );
      const seconds = Number(d.seconds ?? 60);
      assert(Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600, '时长无效');
      g.ballot = {
        id: crypto.randomUUID(),
        kind: kind as 'exile',
        title: text(d.title).slice(0, 80) || '投票',
        candidates: [...new Set(candidates)],
        voters: [...new Set(requested)],
        anonymous: d.anonymous === true,
        abstain: d.abstain !== false,
        votes: {},
        confirmed: false,
        returnPhase: g.phase,
        suspendedTimer: g.timer ? { ...g.timer, remaining: remaining(g.timer, now) } : undefined,
        timer: makeTimer(seconds, now),
        pk: 0,
      };
      if (kind === 'exile') g.phase = 'exileVote';
      if (kind === 'sheriff') g.phase = 'sheriffVote';
      event(
        g,
        now,
        'ballotOpened',
        '发起投票',
        { kind, candidates, voters: requested },
        `开始${g.ballot.title}，结果须法官确认`,
      );
      break;
    }
    case 'vote': {
      const p = actor(),
        b = g.ballot;
      assert(b && !b.confirmed && b.voters.includes(p.id), '没有投票资格');
      assert(!expired(b.timer, now), '投票截止');
      assert(!(p.id in b.votes) || who.judge, '提交后不能自行改票');
      const choice = text(d.target) || null;
      assert(choice === null ? b.abstain : b.candidates.includes(choice), '选项无效');
      b.votes[p.id] = choice;
      break;
    }
    case 'cancelBallot':
      judge();
      assert(g.ballot && !g.ballot.confirmed, '没有可取消投票');
      event(
        g,
        now,
        'ballotCancelled',
        '法官取消尚未确认投票',
        { id: g.ballot.id },
        '本次投票已取消',
      );
      g.phase = g.ballot.returnPhase;
      g.timer = g.ballot.suspendedTimer;
      if (g.timer && !g.timer.paused && g.timer.duration)
        g.timer.deadline = now + g.timer.remaining;
      g.ballot = undefined;
      break;
    case 'confirmBallot': {
      judge();
      const b = g.ballot;
      assert(b && !b.confirmed, '没有待确认投票');
      assert(
        expired(b.timer, now) || b.voters.every((id) => id in b.votes) || d.close === true,
        '尚有选民未投票，可明确提前截止',
      );
      for (const id of b.voters) if (!(id in b.votes)) b.votes[id] = null;
      const tally: Record<string, number> = Object.fromEntries(b.candidates.map((id) => [id, 0]));
      for (const [id, choice] of Object.entries(b.votes))
        if (choice)
          tally[choice] =
            (tally[choice] ?? 0) +
            (b.kind === 'exile' && g.sheriff === id ? g.rules.sheriffWeight : 1);
      const max = Math.max(0, ...Object.values(tally));
      const tied = max ? Object.keys(tally).filter((id) => tally[id] === max) : [];
      b.tally = tally;
      b.tied = tied;
      b.confirmed = true;
      g.ballots.push(structuredClone(b));
      event(
        g,
        now,
        'ballotConfirmed',
        '法官确认票型',
        { ...b },
        `${b.title}已确认：${tied.length === 1 ? '产生唯一结果' : tied.length ? '平票，等待法官发起 PK 重投' : '全部弃票或无人获得选票'}`,
      );
      if (tied.length > 1) break;
      g.phase = b.returnPhase;
      g.timer = b.suspendedTimer;
      if (g.timer && !g.timer.paused && g.timer.duration)
        g.timer.deadline = now + g.timer.remaining;
      g.ballot = undefined;
      if (b.kind === 'sheriff') {
        g.sheriff = tied[0];
        g.electionDone = true;
        g.phase = 'announce';
        event(
          g,
          now,
          'sheriffElected',
          '警长选举结束',
          { sheriff: g.sheriff },
          g.sheriff ? `${player(g, g.sheriff).seat} 号当选警长` : '无人当选警长',
        );
      }
      if (b.kind === 'exile') {
        g.phase = 'awaitNight';
        if (tied[0]) {
          const p = player(g, tied[0]);
          if (p.role === 'idiot' && !p.idiotRevealed && p.alive) {
            p.idiotRevealed = true;
            p.revealed = true;
            event(
              g,
              now,
              'idiotReveal',
              '白痴翻牌免死',
              { player: p.id },
              `${p.seat} 号白痴翻牌免死，失去放逐投票权`,
            );
          } else kill(g, p.id, 'exile', now);
        }
        if (g.deathQueue.length) {
          g.deathReturn = 'awaitNight';
          g.phase = 'deathSkill';
        }
        checkVictory(g);
      }
      break;
    }
    case 'revote': {
      judge();
      const b = g.ballot;
      assert(b?.confirmed && b.tied && b.tied.length > 1, '没有平票');
      const old = b.id;
      b.id = crypto.randomUUID();
      b.candidates = [...b.tied];
      b.votes = {};
      b.confirmed = false;
      b.tally = undefined;
      b.tied = undefined;
      b.pk++;
      b.timer = makeTimer(60, now);
      event(
        g,
        now,
        'pk',
        '平票 PK 重投',
        { previous: old, candidates: b.candidates },
        '平票 PK：仅在同票候选人中重投',
      );
      break;
    }
    case 'noWinner':
      judge();
      assert(g.ballot?.confirmed, '先确认票型');
      g.phase =
        g.ballot.kind === 'sheriff'
          ? 'announce'
          : g.ballot.kind === 'exile'
            ? 'awaitNight'
            : g.ballot.returnPhase;
      if (g.ballot.kind === 'sheriff') g.electionDone = true;
      event(
        g,
        now,
        'noWinner',
        '法官确认无人当选或无人放逐',
        { ballot: g.ballot.id },
        '本轮无人当选或放逐',
      );
      g.timer = g.ballot.suspendedTimer;
      if (g.timer && !g.timer.paused && g.timer.duration)
        g.timer.deadline = now + g.timer.remaining;
      g.ballot = undefined;
      break;
    case 'badge': {
      assert(g.badgePending, '没有待处理警徽');
      assert(who.judge || who.player === g.badgePending, '仅警徽原持有者或法官可操作');
      const to = text(d.target);
      if (to) assert(!player(g, to).publicDead, '不能交给公开死者');
      g.sheriff = to || undefined;
      event(
        g,
        now,
        'badge',
        '警徽移交或撕毁',
        { from: g.badgePending, to: to || null },
        to ? `警徽移交 ${player(g, to).seat} 号` : '警徽已撕毁',
      );
      g.badgePending = undefined;
      break;
    }
    case 'beginDeathSkill':
      judge();
      assert(g.deathQueue.length && !g.pendingDeath, '没有待发动死亡技能');
      assert(
        g.deaths.find((d) => d.id === g.deathQueue[0])?.publicAt !== undefined,
        '请先公布该玩家死亡',
      );
      assert(
        ['deathSkill', 'speech', 'awaitNight', 'announce'].includes(g.phase),
        '先完成当前阶段',
      );
      g.deathReturn = g.phase === 'deathSkill' ? g.deathReturn : g.phase;
      g.phase = 'deathSkill';
      g.timer = makeTimer(g.rules.actionSeconds, now);
      break;
    case 'deathAction': {
      const death = g.deaths.find((x) => x.id === g.deathQueue[0]);
      assert(death && g.phase === 'deathSkill', '没有当前死亡技能');
      const p = actor();
      assert(p.id === death.target, '尚未轮到该死亡技能');
      assert(!expired(g.timer, now), '技能选择已截止');
      assert(!g.pendingDeath || who.judge, '技能已提交，等待法官确认');
      const id = text(d.target);
      if (id) {
        assert(target(g, id).id !== p.id, '不能选择自己');
      }
      g.pendingDeath = { actor: p.id, target: id || undefined, pass: !id };
      break;
    }
    case 'confirmDeath': {
      judge();
      const a = g.pendingDeath;
      assert(a && g.deathQueue.length, '没有待确认死亡技能');
      const p = player(g, a.actor),
        death = g.deaths.find((x) => x.id === g.deathQueue[0]);
      assert(death?.target === p.id, '死亡技能队列不一致');
      g.deathQueue.shift();
      g.pendingDeath = undefined;
      g.timer = undefined;
      if (a.target)
        kill(
          g,
          a.target,
          p.role === 'hunter' ? 'shot' : 'wolfKing',
          now,
          p.id,
          false,
          undefined,
          death.id,
        );
      else
        event(
          g,
          now,
          'deathPass',
          '放弃死亡技能',
          { actor: p.id, death: death.id },
          `${p.seat} 号不发动死亡技能`,
        );
      if (!g.deathQueue.length) g.phase = g.deathReturn ?? 'awaitNight';
      checkVictory(g);
      break;
    }
    case 'kill':
      judge();
      assert(!g.deathQueue.length, '先完成死亡连锁');
      kill(g, text(d.target), 'judge', now, undefined, false);
      event(
        g,
        now,
        'ruling',
        '法官判死',
        { target: d.target, reason: text(d.reason) },
        `法官裁定 ${player(g, text(d.target)).seat} 号死亡`,
      );
      if (g.deathQueue.length) {
        g.deathReturn = g.phase;
        g.phase = 'deathSkill';
      }
      checkVictory(g);
      break;
    case 'revive': {
      judge();
      const p = player(g, text(d.target));
      assert(!p.alive, '玩家仍存活');
      p.alive = true;
      p.publicDead = false;
      p.deathId = undefined;
      event(
        g,
        now,
        'revive',
        '法官复活，消耗不返还',
        { target: p.id, reason: text(d.reason) },
        `${p.seat} 号复活；已消耗技能和警徽不自动恢复`,
      );
      checkVictory(g);
      break;
    }
    case 'faction': {
      judge();
      const p = player(g, text(d.target)),
        to = text(d.faction);
      assert(
        ['good', 'wolves', ...g.rules.thirdParties.map((f) => f.id)].includes(to),
        '阵营未配置',
      );
      const change = {
        player: p.id,
        from: p.faction,
        to,
        source: 'judge',
        reason: text(d.reason).slice(0, 200),
        at: now,
      };
      g.factionHistory.push(change);
      p.faction = to;
      event(g, now, 'faction', '法官修改当前阵营', change, undefined, {
        [p.id]: `你的当前阵营变为 ${to}`,
      });
      checkVictory(g);
      break;
    }
    case 'correct': {
      judge();
      assert(d.confirm === true, '高影响裁定需要明确确认');
      const p = player(g, text(d.target));
      const before = { publicDead: p.publicDead, appearance: p.appearance };
      if (typeof d.publicDead === 'boolean') p.publicDead = d.publicDead;
      if (typeof d.appearance === 'string') p.appearance = d.appearance.slice(0, 40);
      const death = g.deaths.find((x) => x.id === text(d.deathId));
      event(
        g,
        now,
        'correction',
        '法官修正记录，原始历史保留',
        {
          target: p.id,
          before,
          after: { publicDead: p.publicDead, appearance: p.appearance },
          corrects: death?.id,
          correctedCause: text(d.cause),
          reason: text(d.reason),
        },
        '法官已作出修正裁定',
      );
      checkVictory(g);
      break;
    }
    case 'end':
      judge();
      assert(!g.deathQueue.length && !g.interrupt, '死亡连锁尚未完成');
      assert(d.confirm === true, '请明确确认结束');
      checkVictory(g);
      if (Array.isArray(d.factions))
        assert(
          d.factions.every((f) =>
            ['good', 'wolves', ...g.rules.thirdParties.map((p) => p.id)].includes(text(f)),
          ),
          '人工获胜阵营无效',
        );
      g.conclusion = {
        factions: Array.isArray(d.factions) ? d.factions.map(text) : (g.winner?.factions ?? []),
        reason: text(d.reason) || g.winner?.reason || '法官人工结束',
        at: now,
      };
      g.phase = 'ended';
      g.timer = undefined;
      event(
        g,
        now,
        'ended',
        '本局结束',
        { conclusion: g.conclusion },
        `本局结束：${g.conclusion.reason}`,
      );
      break;
    case 'continue':
      judge();
      assert(g.winner, '没有胜利建议');
      event(g, now, 'continue', '法官选择继续游戏', { suggestion: g.winner }, '法官选择继续本局');
      g.winner = undefined;
      break;
    case 'noteEvent':
      judge();
      event(
        g,
        now,
        'judgeNote',
        text(d.reason).slice(0, 500),
        {},
        d.public === true ? text(d.reason).slice(0, 500) : undefined,
      );
      break;
    default:
      throw Error('未知操作');
  }
}
