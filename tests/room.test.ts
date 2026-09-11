import { describe, it, expect } from 'vitest';
import {
  roomAction,
  roomView,
  maintain,
  canControl,
  type Member,
  type RoomData,
} from '../server/room';
import { createGame } from '../src/core/rules';
import { defaultRules, type Role } from '../src/core/model';
const now = 1000000;
function member(id: string, extra: Partial<Member> = {}): Member {
  return {
    id,
    tokenHash: 'hash-' + id,
    name: id,
    judge: false,
    omniscient: false,
    online: true,
    lastSeen: now,
    generation: 1,
    attempts: 0,
    attemptAt: 0,
    lastCode: 0,
    ...extra,
  };
}
function room(): RoomData {
  const roles: Role[] = ['wolf', 'seer', 'witch', 'villager'];
  const members = [
    member('judge', { judge: true, omniscient: true }),
    ...roles.map((_, i) => member('p' + i, { seat: i + 1 })),
    member('watch'),
    member('watch2'),
  ];
  return {
    format: 1,
    code: 'ABCDEF',
    owner: 'judge',
    members,
    game: createGame(
      roles,
      members.filter((m) => m.seat).map((m) => ({ id: m.id, name: m.name })),
      structuredClone(defaultRules),
      now,
      (m) => m - 1,
    ),
    archives: [],
    rules: structuredClone(defaultRules),
    roles,
    codes: [],
    touched: now,
  };
}
describe('房间与代打权限', () => {
  it('口令短时、一次性，接管后原玩家无操作控制权', async () => {
    const r = room(),
      p = r.members[1],
      s = r.members[5];
    const code = await roomAction(r, p, 'generateCode', {}, now);
    expect(String(code.code)).toMatch(/^\d{6}$/);
    await roomAction(r, s, 'takeover', code, now + 1);
    expect(canControl(r, p)).toBeUndefined();
    expect(canControl(r, s)).toBe(p.id);
    expect(roomView(r, s).game).toHaveProperty('own');
    await expect(roomAction(r, r.members[6], 'takeover', code, now + 2)).rejects.toThrow(
      '口令无效',
    );
    await roomAction(r, p, 'reclaim', {}, now + 3);
    expect(canControl(r, p)).toBe(p.id);
    expect(canControl(r, s)).toBeUndefined();
    expect(roomView(r, s).game).not.toHaveProperty('own', expect.anything());
  });
  it('过期口令与频率、猜测次数受限', async () => {
    const r = room(),
      p = r.members[1],
      s = r.members[5];
    const code = await roomAction(r, p, 'generateCode', {}, now);
    await expect(roomAction(r, p, 'generateCode', {}, now + 1)).rejects.toThrow('30 秒');
    await expect(roomAction(r, s, 'takeover', code, now + 120001)).rejects.toThrow('过期');
    for (let i = 0; i < 4; i++)
      await expect(
        roomAction(r, s, 'takeover', { code: 'invalid' }, now + 120002),
      ).rejects.toThrow();
    await expect(roomAction(r, s, 'takeover', code, now + 120003)).rejects.toThrow('尝试过多');
  });
  it('接触过全知信息的法官会话不能代打', async () => {
    const r = room(),
      old = r.members[0];
    old.judge = false;
    await expect(roomAction(r, old, 'takeover', { code: '123456' }, now)).rejects.toThrow(
      '未接触全知',
    );
  });
  it('房主掉线转移不授予法官权限，只有明确授权能接任', async () => {
    const r = room();
    r.members[0].online = false;
    r.members[0].lastSeen = now - 130000;
    maintain(r, now);
    expect(r.owner).toBe('p0');
    expect(r.members[1].judge).toBe(false);
    await expect(roomAction(r, r.members[1], 'acceptJudge', {}, now)).rejects.toThrow();
    r.members[0].online = true;
    await roomAction(r, r.members[0], 'offerJudge', { member: 'watch' }, now);
    await roomAction(r, r.members[5], 'acceptJudge', {}, now + 1);
    expect(r.members[0].judge).toBe(false);
    expect(r.members[5].judge).toBe(true);
    expect(r.members[5].omniscient).toBe(true);
  });
  it('游戏中离开保留角色与座位，不默认判死', async () => {
    const r = room(),
      p = r.members[1];
    await roomAction(r, p, 'leave', {}, now);
    expect(p.seat).toBe(1);
    expect(r.game?.players.find((x) => x.id === p.id)?.alive).toBe(true);
  });
  it('版型不能被游戏中修改，非法配置不能冻结入局', async () => {
    const r = room();
    await expect(
      roomAction(r, r.members[0], 'configure', { roles: ['fake'], rules: {} }, now),
    ).rejects.toThrow('冻结');
    r.game!.phase = 'ended';
    await expect(
      roomAction(
        r,
        r.members[0],
        'configure',
        { roles: ['fake', 'wolf', 'seer', 'villager'], rules: {} },
        now,
      ),
    ).rejects.toThrow('角色');
  });
});
