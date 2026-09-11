import { DurableObject } from 'cloudflare:workers';
import {
  type RoomData,
  type Member,
  hash,
  passwordHash,
  token,
  roomView,
  roomAction,
  maintain,
  replay,
} from './room';
import { defaultRules, type Role } from '../src/core/model';
import { assert } from '../src/core/rules';
import { applyCommand } from '../src/core/engine';
interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
async function readBody(req: Request): Promise<Record<string, unknown>> {
  assert(req.method === 'POST', '此接口需要 POST');
  const reader = req.body?.getReader();
  assert(reader, '请求内容为空');
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw Error('请求内容超过 16 KiB');
    }
    parts.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  assert(value && typeof value === 'object' && !Array.isArray(value), '请求格式无效');
  return value;
}
interface Attachment {
  created?: number;
  member: string;
  generation: number;
  count: number;
  window: number;
}
export class Room extends DurableObject<Env> {
  room?: RoomData;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const meta = await ctx.storage.get<{ format: number; chunks: number }>('snapshot');
      if (meta) {
        assert(meta.format === 1, '房间存档格式不兼容');
        const pieces = await ctx.storage.get<string>(
          Array.from({ length: meta.chunks }, (_, i) => 'chunk:' + i),
        );
        this.room = JSON.parse(
          Array.from({ length: meta.chunks }, (_, i) => {
            const s = pieces.get('chunk:' + i);
            assert(typeof s === 'string', '存档分块缺失');
            return s;
          }).join(''),
        );
      } else this.room = await ctx.storage.get<RoomData>('room');
      if (this.room) {
        assert(this.room.format === 1, '房间存档格式不兼容');
        const attached = ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Attachment);
        for (const m of this.room.members) {
          const online = attached.some((a) => a.member === m.id && a.generation === m.generation);
          if (m.online && !online) m.lastSeen = Date.now();
          m.online = online;
        }
      }
    });
  }
  async save() {
    if (this.room) {
      let encoded = JSON.stringify(this.room);
      while (encoded.length > 1400000 && this.room.archives.length) {
        this.room.archives.shift();
        encoded = JSON.stringify(this.room);
      }
      assert(encoded.length < 1500000, '本局存储已达上限，请导出并结束');
      const chunks: string[] = [];
      for (let i = 0; i < encoded.length; i += 24000) chunks.push(encoded.slice(i, i + 24000));
      await this.ctx.storage.transaction(async (tx) => {
        const old = await tx.get<{ chunks: number }>('snapshot');
        await tx.put(Object.fromEntries(chunks.map((s, i) => ['chunk:' + i, s])));
        await tx.put('snapshot', { format: 1, chunks: chunks.length });
        for (let i = chunks.length; i < (old?.chunks ?? 0); i++) await tx.delete('chunk:' + i);
        await tx.delete('room');
      });
      await this.schedule();
    }
  }
  async schedule() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    const t = r.game?.interrupt?.targetTimer;
    const deadlines = [Math.max(now + 3600000, r.touched + 7 * 86400000)];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.member) deadlines.push((a.created ?? a.window) + 10000);
    }
    if (t?.deadline && !t.paused) deadlines.push(t.deadline);
    const own = r.members.find((m) => m.id === r.owner);
    if (own && !own.online && r.members.some((m) => m.online))
      deadlines.push(Math.max(now + 1000, own.lastSeen + 120000));
    await this.ctx.storage.setAlarm(Math.max(now + 100, Math.min(...deadlines)));
  }
  broadcast() {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      const m = this.room.members.find((m) => m.id === a.member);
      if (m && m.generation === a.generation) {
        try {
          ws.send(JSON.stringify({ type: 'state', state: roomView(this.room, m) }));
        } catch {}
      }
    }
  }
  async fetch(req: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const url = new URL(req.url),
          op = url.pathname.split('/').at(-1),
          now = Date.now();
        if (op === 'create') {
          assert(!this.room, '房间号冲突');
          const b = (await readBody(req)) as { name?: string; password?: string; code: string };
          assert((b.password?.length ?? 0) <= 80, '密码过长');
          const secret = token(),
            id = crypto.randomUUID();
          const member: Member = {
            id,
            tokenHash: await hash(secret),
            name: (b.name || '法官').slice(0, 24),
            judge: true,
            omniscient: true,
            online: false,
            lastSeen: now,
            generation: 0,
            attempts: 0,
            attemptAt: 0,
            lastCode: 0,
          };
          const salt = token();
          this.room = {
            format: 1,
            code: b.code,
            owner: id,
            members: [member],
            password: b.password ? { salt, hash: await passwordHash(b.password, salt) } : undefined,
            archives: [],
            rules: structuredClone(defaultRules),
            roles: ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
            codes: [],
            touched: now,
          };
          await this.save();
          return json({ token: secret, code: b.code });
        }
        const r = this.room;
        assert(r && r.format === 1, '房间不存在、已过期或格式不兼容');
        maintain(r, now);
        if (op === 'join') {
          assert(
            r.members.filter((m) => m.online).length < 48 && r.members.length < 80,
            '房间容量已满',
          );
          const b = (await readBody(req)) as { name?: string; password?: string };
          assert((b.password?.length ?? 0) <= 80, '密码过长');
          // The edge address is hashed before storing a rate-limit bucket.
          const bucket = 'join:' + (await hash(req.headers.get('CF-Connecting-IP') || 'local'));
          const buckets = await this.ctx.storage.list<{ at: number; n: number }>({
            prefix: 'join:',
            limit: 129,
          });
          for (const [key, value] of buckets)
            if (now - value.at > 600000) {
              await this.ctx.storage.delete(key);
              buckets.delete(key);
            }
          assert(buckets.has(bucket) || buckets.size < 128, '房间加入请求过多，请稍后重试');
          const limit = await this.ctx.storage.get<{ at: number; n: number }>(bucket);
          assert(!limit || now - limit.at > 600000 || limit.n < 10, '加入尝试过多，请稍后重试');
          await this.ctx.storage.put(bucket, {
            at: !limit || now - limit.at > 600000 ? now : limit.at,
            n: !limit || now - limit.at > 600000 ? 1 : limit.n + 1,
          });
          assert(
            !r.password ||
              (await passwordHash(b.password || '', r.password.salt)) === r.password.hash,
            '房间密码错误',
          );
          const secret = token();
          r.members.push({
            id: crypto.randomUUID(),
            tokenHash: await hash(secret),
            name: (b.name || '观战者').slice(0, 24),
            judge: false,
            omniscient: false,
            online: false,
            lastSeen: now,
            generation: 0,
            attempts: 0,
            attemptAt: 0,
            lastCode: 0,
          });
          r.touched = now;
          await this.save();
          return json({ token: secret, code: r.code });
        }
        if (req.headers.get('Upgrade') === 'websocket') {
          assert(this.ctx.getWebSockets().length < 64, '连接已达上限');
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment({
            created: now,
            member: '',
            generation: 0,
            count: 0,
            window: now,
          } satisfies Attachment);
          await this.schedule();
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        const bearer = req.headers.get('Authorization')?.replace(/^Bearer /, '');
        assert(bearer, '需要会话凭证');
        const h = await hash(bearer);
        const member = r.members.find((m) => m.tokenHash === h);
        assert(member, '凭证无效');
        if (op === 'replay')
          return json(
            replay(
              r,
              member,
              url.searchParams.get('game') || '',
              url.searchParams.get('view') || 'public',
              url.searchParams.has('until') ? Number(url.searchParams.get('until')) : undefined,
              url.searchParams.has('round') ? Number(url.searchParams.get('round')) : undefined,
            ),
          );
        return json(roomView(r, member));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : '请求失败' }, 400);
      }
    });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ctx.blockConcurrencyWhile(async () => {
      let requestId: string | undefined;
      try {
        assert(typeof message === 'string' && message.length <= 16384, '消息过大或格式错误');
        const msg = JSON.parse(message) as {
          id: string;
          type: string;
          token?: string;
          payload?: Record<string, unknown>;
        };
        requestId = msg.id;
        const a = ws.deserializeAttachment() as Attachment,
          now = Date.now();
        if (now - a.window > 10000) {
          a.count = 0;
          a.window = now;
        }
        assert(++a.count <= 30, '操作过于频繁');
        ws.serializeAttachment(a);
        const r = this.room;
        assert(r, '房间已过期');
        if (msg.type === 'auth') {
          assert(!a.member && msg.token && msg.token.length <= 100, '认证格式无效');
          const h = await hash(msg.token);
          const m = r.members.find((m) => m.tokenHash === h);
          assert(m, '凭证无效');
          assert(m.online || r.members.filter((p) => p.online).length < 48, '在线人数已达上限');
          m.generation++;
          m.online = true;
          m.lastSeen = now;
          r.touched = now;
          for (const old of this.ctx.getWebSockets()) {
            const oldA = old.deserializeAttachment() as Attachment;
            if (old !== ws && oldA.member === m.id) old.close(4001, '会话已在新连接恢复');
          }
          ws.serializeAttachment({ ...a, member: m.id, generation: m.generation });
          await this.save();
          this.broadcast();
          return;
        }
        const m = r.members.find((m) => m.id === a.member);
        assert(m && m.generation === a.generation && m.online, '旧连接或尚未认证');
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', now }));
          return;
        }
        // Clone before applying: rejected commands cannot partially mutate authoritative state.
        const next = structuredClone(r),
          member = next.members.find((x) => x.id === m.id)!;
        let result: Record<string, unknown>;
        try {
          result = await roomAction(next, member, msg.type, msg.payload ?? {}, now);
        } catch (e) {
          if (msg.type === 'takeover') {
            m.attempts = member.attempts;
            m.attemptAt = member.attemptAt;
            await this.save();
          }
          throw e;
        }
        this.room = next;
        maintain(next, now);
        try {
          await this.save();
        } catch (error) {
          this.room = r;
          r.paused = '持久化失败，已保留上次确认状态。请检查后恢复。';
          this.broadcast();
          throw error;
        }
        ws.send(JSON.stringify({ type: 'ack', id: msg.id, result }));
        this.broadcast();
      } catch (e) {
        try {
          ws.send(
            JSON.stringify({
              type: 'error',
              id: requestId,
              error: e instanceof Error ? e.message : '操作失败',
            }),
          );
        } catch {}
      }
    });
  }
  async webSocketClose(ws: WebSocket) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const a = ws.deserializeAttachment() as Attachment;
      const m = this.room?.members.find((m) => m.id === a.member);
      if (m && m.generation === a.generation) {
        m.online = false;
        m.lastSeen = Date.now();
        await this.save();
        this.broadcast();
      }
    });
  }
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const r = this.room;
      if (!r) return;
      const now = Date.now();
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment;
        if (!a.member && now - (a.created ?? a.window) >= 10000) ws.close(4003, '认证超时');
      }
      if (!r.members.some((m) => m.online) && now - r.touched >= 7 * 86400000) {
        await this.ctx.storage.deleteAll();
        this.room = undefined;
        return;
      }
      maintain(r, now);
      const t = r.game?.interrupt?.targetTimer;
      if (r.game && t?.deadline && !t.paused && now >= t.deadline) {
        r.game = applyCommand(
          r.game,
          { id: crypto.randomUUID(), version: r.game.version, type: 'timeout' },
          { judge: true },
          now,
        );
      }
      await this.save();
      this.broadcast();
    });
  }
}
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      assert(
        !req.headers.get('Origin') || req.headers.get('Origin') === url.origin,
        '不允许跨站请求',
      );
      assert(Number(req.headers.get('Content-Length') || 0) <= 16384, '请求过大');
      if (url.pathname === '/api/create' && req.method === 'POST') {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
          .map((n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32])
          .join('');
        const data = await readBody(req);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return stub.fetch(
          new Request(url.origin + '/create', {
            method: 'POST',
            body: JSON.stringify({ ...data, code }),
          }),
        );
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|socket|state|replay)$/);
      assert(match, '房间地址无效');
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(req);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : '请求失败' }, 400);
    }
  },
} satisfies ExportedHandler<Env>;
