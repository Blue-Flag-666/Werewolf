import { validateSetup } from '../src/core/validation';
import { type Game, type Role, type Rules, defaultRules, secureRandom } from '../src/core/model';
import { createGame, assert, event } from '../src/core/rules';
import { applyCommand } from '../src/core/engine';
import { project, exportReplay } from '../src/core/views';
export interface Member {
  id: string;
  tokenHash: string;
  name: string;
  seat?: number;
  judge: boolean;
  omniscient: boolean;
  online: boolean;
  lastSeen: number;
  generation: number;
  controls?: string;
  attempts: number;
  attemptAt: number;
  lastCode: number;
}
export interface RoomData {
  paused?: string;
  format: 1;
  code: string;
  owner: string;
  members: Member[];
  password?: { salt: string; hash: string };
  game?: Game;
  archives: Game[];
  rules: Rules;
  roles: Role[];
  codes: { hash: string; seat: string; game: string; expires: number }[];
  touched: number;
  judgeOffer?: { from: string; to: string; expires: number };
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function passwordHash(value: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export const token = () => crypto.randomUUID() + crypto.randomUUID();
export function roomView(r: RoomData, m: Member) {
  const controlled = m.controls ?? (m.seat ? m.id : undefined);
  return {
    serverNow: Date.now(),
    paused: r.paused,
    code: r.code,
    owner: r.owner,
    self: m.id,
    judge: m.judge,
    controls: controlled,
    members: r.members.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      judge: p.judge,
      online: p.online,
      controlledBy: r.members.find((x) => x.controls === p.id)?.id,
    })),
    roles: r.roles,
    rules: r.rules,
    game: r.game ? project(r.game, { judge: m.judge, player: controlled }) : undefined,
    archives: r.archives.map((g) => ({ id: g.id, round: g.round, conclusion: g.conclusion })),
    judgeOffer: r.judgeOffer?.to === m.id ? r.judgeOffer : undefined,
  };
}
export function canControl(r: RoomData, m: Member) {
  if (m.controls) return m.controls;
  if (m.seat && !r.members.some((x) => x.controls === m.id)) return m.id;
  return undefined;
}
export async function roomAction(
  r: RoomData,
  m: Member,
  type: string,
  d: Record<string, unknown>,
  now: number,
) {
  const judge = () => assert(m.judge, '仅法官可执行');
  const owner = () => assert(r.owner === m.id, '仅房主可执行');
  switch (type) {
    case 'nickname':
      m.name = String(d.name || '玩家').slice(0, 24);
      if (r.game) {
        const p = r.game.players.find((p) => p.id === m.id);
        if (p) p.name = m.name;
      }
      break;
    case 'seat': {
      assert(!r.game || r.game.phase === 'ended', '游戏中不能调整座位');
      const subject =
        m.judge && typeof d.member === 'string' ? r.members.find((x) => x.id === d.member) : m;
      assert(subject, '成员不存在');
      const seat = Number(d.seat);
      assert(Number.isInteger(seat) && seat >= 0 && seat <= 24, '座位无效');
      assert(!seat || !r.members.some((p) => p.id !== subject.id && p.seat === seat), '座位已占用');
      subject.seat = seat || undefined;
      break;
    }
    case 'configure':
      judge();
      assert(!r.game || r.game.phase === 'ended', '本局规则已经冻结');
      {
        const setup = validateSetup(d.roles, d.rules);
        r.roles = setup.roles;
        r.rules = setup.rules;
      }
      break;
    case 'start': {
      judge();
      assert(!r.game || r.game.phase === 'ended', '本局尚未结束');
      const seated = r.members.filter((x) => x.seat).sort((a, b) => a.seat! - b.seat!);
      assert(
        seated.every((x, i) => x.seat === i + 1),
        '座位须从 1 连续排列',
      );
      assert(!seated.some((x) => x.judge), '法官应保留观战席，不能作为玩家发牌');
      if (r.game) {
        r.archives.push(r.game);
        r.archives = r.archives.slice(-5);
      }
      r.game = createGame(
        r.roles,
        seated.map((x) => ({ id: x.id, name: x.name })),
        r.rules,
        now,
      );
      r.codes = [];
      for (const p of r.members) p.controls = undefined;
      break;
    }
    case 'resumeConsistency':
      judge();
      r.paused = undefined;
      break;
    case 'command': {
      assert(!r.paused, '房间已暂停，请法官检查并恢复');
      assert(r.game, '尚未开始');
      assert(r.members.some((x) => x.judge && x.online) || !m.judge, '法官离线，等待恢复');
      const c = d.command as Parameters<typeof applyCommand>[1];
      assert(c && typeof c.id === 'string' && typeof c.type === 'string', '命令无效');
      r.game = applyCommand(r.game, c, { judge: m.judge, player: canControl(r, m) }, now);
      break;
    }
    case 'generateCode': {
      assert(r.game && r.game.phase !== 'ended' && m.seat, '只有原玩家可生成代打口令');
      assert(now - m.lastCode >= 30000, '每 30 秒最多生成一次');
      r.codes = r.codes.filter((c) => c.expires > now && c.seat !== m.id);
      let code: string, h: string;
      do {
        code = String(secureRandom(1000000)).padStart(6, '0');
        h = await hash(r.code + r.game.id + code);
      } while (r.codes.some((c) => c.hash === h));
      r.codes.push({ hash: h, seat: m.id, game: r.game.id, expires: now + 120000 });
      m.lastCode = now;
      return { code, expires: now + 120000 };
    }
    case 'takeover': {
      assert(
        r.game && !m.seat && !m.judge && !m.omniscient && !m.controls,
        '仅未接触全知信息的观战者可代打',
      );
      if (now - m.attemptAt > 600000) {
        m.attemptAt = now;
        m.attempts = 0;
      }
      assert(m.attempts < 5, '尝试过多，请十分钟后再试');
      m.attempts++;
      const h = await hash(r.code + r.game.id + String(d.code));
      const index = r.codes.findIndex(
        (c) => c.hash === h && c.game === r.game!.id && c.expires > now,
      );
      assert(index >= 0, '口令无效或已过期');
      const code = r.codes.splice(index, 1)[0];
      for (const x of r.members) if (x.controls === code.seat) x.controls = undefined;
      m.controls = code.seat;
      event(
        r.game,
        now,
        'takeover',
        '观战者接管座位',
        { seat: code.seat, member: m.id },
        `${r.game.players.find((p) => p.id === code.seat)?.seat} 号由代打者接管`,
      );
      r.game.version++;
      break;
    }
    case 'reclaim': {
      const seat = m.judge ? String(d.seat) : m.id;
      assert(m.judge || m.seat, '无收回权限');
      for (const x of r.members) if (x.controls === seat) x.controls = undefined;
      r.codes = r.codes.filter((c) => c.seat !== seat);
      if (r.game) {
        event(r.game, now, 'controlReclaimed', '撤销代打', { seat }, '座位控制权已收回');
        r.game.version++;
      }
      break;
    }
    case 'offerJudge':
      judge();
      {
        const to = r.members.find((x) => x.id === String(d.member));
        assert(to && to.online && !to.seat && !to.controls, '新法官须是在线观战者');
        r.judgeOffer = { from: m.id, to: to.id, expires: now + 120000 };
        break;
      }
    case 'acceptJudge':
      assert(r.judgeOffer?.to === m.id && r.judgeOffer.expires > now, '没有有效法官授权');
      for (const x of r.members) x.judge = false;
      m.judge = true;
      m.omniscient = true;
      r.judgeOffer = undefined;
      if (r.game) {
        event(r.game, now, 'judgeTransfer', '明确授权移交法官', { member: m.id }, '法官权限已移交');
        r.game.version++;
      }
      break;
    case 'owner':
      owner();
      assert(
        r.members.some((x) => x.id === d.member && x.online),
        '目标不在线',
      );
      r.owner = String(d.member);
      break;
    case 'leave':
      m.online = false;
      m.lastSeen = now - 120000;
      if (m.controls) {
        m.controls = undefined;
        if (r.game)
          event(r.game, now, 'substituteLeave', '代打离开，控制权回归原玩家', {}, '代打控制已结束');
      }
      if (!r.game || r.game.phase === 'ended') m.seat = undefined;
      break;
    default:
      throw Error('未知房间操作');
  }
  r.touched = now;
  return {};
}
export function maintain(r: RoomData, now: number) {
  if (!r.game || r.game.phase === 'ended')
    for (const m of r.members) if (!m.online && now - m.lastSeen > 1800000) m.seat = undefined;
  r.codes = r.codes.filter((c) => c.expires > now);
  const own = r.members.find((x) => x.id === r.owner);
  if (!own?.online && now - (own?.lastSeen ?? 0) >= 120000) {
    const next = r.members.find((x) => x.online);
    if (next) r.owner = next.id;
  }
}
export function replay(
  r: RoomData,
  m: Member,
  id: string,
  view: string,
  until?: number,
  round?: number,
) {
  const g = r.game?.id === id ? r.game : r.archives.find((g) => g.id === id);
  assert(g, '复盘不存在或已过期');
  const bound =
    round !== undefined && Number.isFinite(round)
      ? Math.max(0, ...g.events.filter((e) => e.round <= round).map((e) => e.seq))
      : until;
  return exportReplay(g, { judge: m.judge, player: canControl(r, m) }, view, bound);
}
