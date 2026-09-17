import { validateSetup } from './validation';
import {
  type Game,
  type Player,
  type Role,
  type Rules,
  type Random,
  type Event,
  type Phase,
  type Death,
  defaultRules,
  factionLabel,
  ROLES,
  secureRandom,
  wolfRole,
  makeTimer,
} from './model';
export function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export function player(g: Game, id: string): Player {
  const p = g.players.find((p) => p.id === id);
  assert(p, '座位不存在');
  return p;
}
export function event(
  g: Game,
  now: number,
  kind: string,
  judgeText: string,
  data: Record<string, unknown> = {},
  publicText?: string,
  privateText?: Record<string, string>,
): Event {
  assert(g.events.length < 6000, '记录已达上限，请导出并结束本局');
  const e: Event = {
    seq: g.events.length + 1,
    at: now,
    round: g.round,
    phase: g.phase,
    kind,
    judgeText,
    data,
    publicText,
    privateText,
    audience: publicText ? 'public' : privateText ? Object.keys(privateText) : 'judge',
  };
  g.events.push(e);
  return e;
}
export function createGame(
  roles: Role[],
  names: { id: string; name: string }[],
  rules: Rules = defaultRules,
  now = Date.now(),
  random: Random = secureRandom,
): Game {
  ({ roles, rules } = validateSetup(roles, rules));
  assert(
    roles.length >= 4 && roles.length <= 24 && roles.length === names.length,
    '需要 4–24 人，座位与身份数量必须一致',
  );
  assert(roles.some(wolfRole) && roles.some((r) => !wolfRole(r)), '至少需要一名狼人和一名好人');
  assert(new Set(names.map((n) => n.id)).size === names.length, '座位身份重复');
  const deck = [...roles];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const players: Player[] = names.map((n, i) => ({
    ...n,
    name: n.name.slice(0, 24),
    seat: i + 1,
    role: deck[i],
    initialFaction: wolfRole(deck[i]) ? 'wolves' : 'good',
    faction: wolfRole(deck[i]) ? 'wolves' : 'good',
    group: wolfRole(deck[i]) ? 'wolf' : deck[i] === 'villager' ? 'civilian' : 'god',
    appearance: wolfRole(deck[i]) ? '狼人' : '好人',
    alive: true,
    publicDead: false,
    revealed: false,
    confirmed: false,
    medicine: { save: 1, poison: 1 },
    usedKnight: false,
    idiotRevealed: false,
    checks: [],
  }));
  const g: Game = {
    format: 1,
    id: crypto.randomUUID(),
    version: 0,
    round: 0,
    phase: 'identity',
    rules: structuredClone(rules),
    players,
    events: [],
    deaths: [],
    processed: [],
    night: { order: [], index: 0, awaitingNext: false, saves: [], poisons: [], wolfVotes: {} },
    ballots: [],
    candidates: [],
    withdrawals: [],
    electionDone: !rules.sheriff,
    speech: [],
    speechIndex: 0,
    deathQueue: [],
    nightDeaths: [],
    enabledGroups: [...new Set(players.filter((p) => p.faction === 'good').map((p) => p.group))],
    factionHistory: [],
  };
  event(
    g,
    now,
    'deal',
    '安全随机发牌完成',
    { roles: players.map((p) => ({ id: p.id, role: p.role, faction: p.faction })) },
    '身份已分配，请依次确认',
    Object.fromEntries(
      players.map((p) => [
        p.id,
        `你的身份：${ROLES[p.role]}；阵营：${factionLabel(p.faction, rules)}`,
      ]),
    ),
  );
  return g;
}
export function deathEligible(g: Game, p: Player, cause: string) {
  if (p.role === 'hunter') return cause !== 'poison' || g.rules.poisonedHunterShoots;
  if (p.role === 'wolfKing')
    return (
      (cause !== 'poison' || g.rules.poisonedWolfKingShoots) &&
      (cause !== 'explosion' || g.rules.wolfKingExplosionShoots)
    );
  return false;
}
export function kill(
  g: Game,
  target: string,
  cause: string,
  now: number,
  source?: string,
  hidden = false,
  blocked?: string,
  related?: string,
): Death {
  const p = player(g, target);
  const reason = blocked ?? (!p.alive ? '目标已经实际死亡' : undefined);
  const d: Death = {
    id: crypto.randomUUID(),
    target,
    source,
    cause,
    at: now,
    round: g.round,
    phase: g.phase,
    order: g.deaths.length + 1,
    effective: !reason,
    blocked: reason,
    publicAt: hidden ? undefined : now,
    related,
  };
  g.deaths.push(d);
  if (d.effective) {
    p.alive = false;
    p.deathId = d.id;
    if (!hidden) p.publicDead = true;
    if (deathEligible(g, p, cause)) g.deathQueue.push(d.id);
    if (g.sheriff === target && !hidden) {
      g.sheriff = undefined;
      g.badgePending = target;
    }
  }
  event(
    g,
    now,
    'death',
    `${p.seat} 号 ${cause}：${reason ?? '死亡生效'}`,
    { ...d },
    hidden ? undefined : `${p.seat} 号${d.effective ? '死亡' : '未产生新的死亡'}`,
  );
  return d;
}
export function checkVictory(g: Game) {
  if (g.interrupt || g.deathQueue.length || g.pendingDeath) {
    g.winner = undefined;
    return;
  }
  const alive = g.players.filter((p) => p.alive);
  const wins: { faction: string; priority: number; shared: boolean; reason: string }[] = [];
  for (const f of g.rules.thirdParties) {
    const count = alive.filter((p) => p.faction === f.id).length;
    if (
      count &&
      (f.condition === 'soleSurvivors' ? count === alive.length : count >= alive.length - count)
    )
      wins.push({
        faction: f.id,
        priority: f.priority,
        shared: f.shared,
        reason: `${f.label}满足${f.condition === 'parity' ? '人数优势' : '独存'}条件`,
      });
  }
  if (!alive.some((p) => p.faction === 'wolves'))
    wins.push({ faction: 'good', priority: 0, shared: true, reason: '当前狼人阵营已全部出局' });
  else if (
    g.rules.win === 'city'
      ? !alive.some((p) => g.rules.cityTargets.includes(p.faction))
      : g.enabledGroups.some(
          (group) => !alive.some((p) => p.faction === 'good' && p.group === group),
        )
  )
    wins.push({
      faction: 'wolves',
      priority: 0,
      shared: true,
      reason: g.rules.win === 'city' ? '屠城目标阵营已全部出局' : '开局启用的好人分组已被消灭',
    });
  wins.sort((a, b) => b.priority - a.priority);
  if (!wins.length) {
    g.winner = undefined;
    return;
  }
  const chosen = wins[0].shared
    ? wins.filter((w) => w.priority === wins[0].priority && w.shared)
    : [wins[0]];
  g.winner = {
    factions: chosen.map((w) => w.faction),
    reason: chosen.map((w) => w.reason).join('；'),
  };
}
export function startNight(g: Game, now: number) {
  assert(!g.interrupt && !g.deathQueue.length && !g.badgePending, '先完成技能连锁和警徽处理');
  g.round++;
  g.phase = 'night';
  g.timer = undefined;
  g.ballot = undefined;
  g.nightDeaths = [];
  const ids = (role: Role) => g.players.filter((p) => p.alive && p.role === role).map((p) => p.id);
  g.night = {
    order: [
      ...ids('guard'),
      ...(g.players.some((p) => p.alive && p.faction === 'wolves') ? ['wolves'] : []),
      ...ids('witch'),
      ...ids('seer'),
    ],
    index: 0,
    awaitingNext: true,
    saves: [],
    poisons: [],
    wolfVotes: {},
  };
  event(g, now, 'nightStart', `第 ${g.round} 夜`, {}, `第 ${g.round} 夜开始，等待法官唤醒角色`);
}
export function settleNight(g: Game, now: number) {
  const n = g.night;
  if (n.knife) {
    const guarded = n.guard === n.knife || !!n.guards?.some((guard) => guard.target === n.knife),
      saved = n.saves.includes(n.knife);
    const blocked =
      (guarded || saved) && !(guarded && saved && g.rules.saveAndGuardKills)
        ? '守护或解药阻止狼刀'
        : undefined;
    kill(g, n.knife, 'knife', now, 'wolves', true, blocked);
  }
  for (const poison of n.poisons) kill(g, poison.target, 'poison', now, poison.source, true);
  g.nightDeaths = g.players.filter((p) => !p.alive && !p.publicDead).map((p) => p.id);
  g.phase = !g.electionDone ? 'signup' : 'announce';
  if (g.phase === 'signup') {
    g.candidates = [];
    g.withdrawals = [];
  }
  g.timer = undefined;
  event(
    g,
    now,
    'nightSettled',
    '夜间效果已结算，死亡尚未公布',
    { dead: g.nightDeaths },
    g.phase === 'signup' ? '进入警长报名，夜间死亡尚未公布' : '等待法官公布夜间结果',
  );
}
export function announce(g: Game, now: number) {
  for (const p of g.players.filter((p) => !p.alive && !p.publicDead)) {
    p.publicDead = true;
    for (const d of g.deaths.filter((d) => d.target === p.id && d.publicAt === undefined))
      d.publicAt = now;
    if (g.sheriff === p.id) {
      g.sheriff = undefined;
      g.badgePending = p.id;
    }
  }
  event(
    g,
    now,
    'announcement',
    '公布夜间死亡',
    { players: g.nightDeaths },
    g.nightDeaths.length
      ? `昨夜出局：${g.nightDeaths.map((id) => player(g, id).seat).join('、')} 号`
      : '昨夜平安夜',
  );
  g.phase = g.deathQueue.length ? 'deathSkill' : 'speech';
  g.deathReturn = 'speech';
  checkVictory(g);
}
export function speechOrder(
  g: Game,
  now: number,
  random: Random,
  start?: string,
  direction?: number,
) {
  const living = g.players.filter((p) => !p.publicDead);
  assert(living.length, '没有合法发言者');
  const dir = direction === -1 || direction === 1 ? direction : random(2) ? 1 : -1;
  const origin = start
    ? player(g, start)
    : g.nightDeaths.length
      ? player(g, g.nightDeaths[random(g.nightDeaths.length)])
      : living[random(living.length)];
  const result: string[] = [];
  for (
    let step = origin.publicDead ? 1 : 0;
    step < g.players.length + (origin.publicDead ? 1 : 0);
    step++
  ) {
    const index =
      (((origin.seat - 1 + step * dir) % g.players.length) + g.players.length) % g.players.length;
    const p = g.players[index];
    if (!p.publicDead) result.push(p.id);
  }
  g.speech = result;
  g.speechIndex = 0;
  g.timer = makeTimer(g.rules.speechSeconds, now);
  event(
    g,
    now,
    'speechOrder',
    '计算座位环发言顺序',
    { origin: origin.id, direction: dir, order: result },
    `发言顺序：${result.map((id) => player(g, id).seat).join(' → ')} 号`,
  );
}
