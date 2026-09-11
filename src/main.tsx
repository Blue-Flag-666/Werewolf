import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Replay } from './Replay';
import { Setup } from './Setup';
import { Table, type GameView } from './Table';
import { type Game, type Role, type Rules, ROLES } from './core/model';
import { createGame } from './core/rules';
import { applyCommand } from './core/engine';
import { exportReplay } from './core/views';
import { readLocal, writeLocal, compatible, download, useRoom, type Session } from './storage';
import './style.css';
interface RoomView {
  serverNow: number;
  clockOffset?: number;
  paused?: string;
  code: string;
  owner: string;
  self: string;
  judge: boolean;
  controls?: string;
  members: {
    id: string;
    name: string;
    seat?: number;
    judge: boolean;
    online: boolean;
    controlledBy?: string;
  }[];
  game?: GameView;
  archives: { id: string; conclusion?: Game['conclusion'] }[];
  judgeOffer?: unknown;
}
function App() {
  const [mode, setMode] = useState('home'),
    [game, setGame] = useState<Game>(),
    [archives, setArchives] = useState<Game[]>([]),
    [session, setSession] = useState<Session | undefined>(() => {
      try {
        return JSON.parse(localStorage.getItem('room-session') || 'null') ?? undefined;
      } catch {
        return undefined;
      }
    }),
    [room, setRoom] = useState<RoomView>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [shield, setShield] = useState(true),
    [card, setCard] = useState(0),
    [reveal, setReveal] = useState(false),
    [theme, setTheme] = useState(localStorage.getItem('theme') || 'system'),
    [name, setName] = useState(''),
    [code, setCode] = useState(new URLSearchParams(location.search).get('room') || ''),
    [password, setPassword] = useState(''),
    [subcode, setSubcode] = useState(''),
    [notes, setNotes] = useState(''),
    [marks, setMarks] = useState<Record<string, string>>({}),
    [noteState, setNoteState] = useState(''),
    [view, setView] = useState('public'),
    [replayData, setReplayData] = useState<unknown>(),
    [replayNotes, setReplayNotes] = useState<{ text: string; marks: Record<string, string> }>({
      text: '',
      marks: {},
    }),
    [includeNotes, setIncludeNotes] = useState(false),
    [round, setRound] = useState(''),
    [notify, setNotify] = useState(localStorage.getItem('notify') === 'true');
  const connection = useRoom(
    mode === 'online' ? session : undefined,
    (v) => {
      const state = v as RoomView;
      setRoom({ ...state, clockOffset: state.serverNow - Date.now() });
    },
    setError,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => {
    readLocal<Game>('active')
      .then((g) => {
        if (g && !compatible(g)) {
          setError('本地存档格式不兼容，请保留原数据');
          return;
        }
        setGame(g);
      })
      .catch((e) => setError('读取存档失败：' + e.message));
    readLocal<Game[]>('archives').then((a) => setArchives(a ?? []));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  const current = mode === 'local' ? game : room?.game;
  const noteKey = current
    ? 'notes:' + current.id + ':' + (mode === 'local' ? 'judge' : room?.self)
    : '';
  useEffect(() => {
    if (!noteKey) return;
    readLocal<{ text: string; marks: Record<string, string> }>(noteKey).then((n) => {
      setNotes(n?.text ?? '');
      setMarks(n?.marks ?? {});
      setNoteState('已读取本机笔记');
    });
  }, [noteKey]);
  useEffect(() => {
    if (current && notify) navigator.vibrate?.(80);
  }, [current?.phase, notify]);
  async function saveNotes(text: string, nextMarks = marks) {
    setNotes(text);
    setMarks(nextMarks);
    setNoteState('保存中');
    try {
      await writeLocal(noteKey, { text, marks: nextMarks });
      setNoteState('已自动保存在本机');
    } catch {
      setNoteState('保存失败，请复制笔记');
    }
  }
  async function startLocal(roles: Role[], rules: Rules) {
    try {
      const next = createGame(
        roles,
        roles.map((_, i) => ({ id: 'seat-' + (i + 1), name: '玩家 ' + (i + 1) })),
        rules,
      );
      if (game?.phase === 'ended') {
        const a = [...archives, game].slice(-10);
        await writeLocal('archives', a);
        setArchives(a);
      }
      await writeLocal('active', next);
      setGame(next);
      setCard(0);
      setReveal(false);
      setShield(false);
      setMode('local');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(type: string, payload: Record<string, unknown> = {}) {
    setError('');
    if (mode === 'online') {
      if (!room?.game) return;
      connection.send('command', {
        command: { id: crypto.randomUUID(), version: room.game.version, type, payload },
      });
      return;
    }
    if (!game) return;
    setBusy(true);
    try {
      const next = applyCommand(
        game,
        { id: crypto.randomUUID(), version: game.version, type, payload },
        { judge: true },
      );
      await writeLocal('active', next);
      setGame(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function enter(create: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        create ? '/api/create' : '/api/rooms/' + code.toUpperCase() + '/join',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password }),
        },
      );
      const data = (await res.json()) as Session & { error?: string };
      if (!res.ok) throw Error(data.error || '连接失败');
      localStorage.setItem('room-session', JSON.stringify(data));
      setSession(data);
      setMode('online');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadReplay(id = current?.id) {
    if (!id) return;
    try {
      let data: unknown;
      if (mode === 'local') {
        const g = game?.id === id ? game : archives.find((g) => g.id === id);
        if (!g) return;
        const end = round
          ? Math.max(0, ...g.events.filter((e) => e.round <= Number(round)).map((e) => e.seq))
          : Infinity;
        data = exportReplay(g, { judge: true }, view, end);
      } else {
        if (!session) return;
        const res = await fetch(
          '/api/rooms/' +
            session.code +
            '/replay?game=' +
            encodeURIComponent(id) +
            '&view=' +
            encodeURIComponent(view) +
            (round ? '&round=' + encodeURIComponent(round) : ''),
          { headers: { Authorization: 'Bearer ' + session.token } },
        );
        data = await res.json();
        if (!res.ok) throw Error((data as { error: string }).error);
      }
      const loadedNotes = await readLocal<{ text: string; marks: Record<string, string> }>(
        'notes:' + id + ':' + (mode === 'local' ? 'judge' : room?.self),
      );
      setReplayNotes(loadedNotes ?? { text: '', marks: {} });
      setIncludeNotes(false);
      setReplayData(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (mode !== 'local' || !game?.interrupt) return;
    const timer = game.interrupt.targetTimer;
    if (timer.paused || timer.deadline === null) return;
    const id = setTimeout(
      () => {
        void send('timeout');
      },
      Math.max(0, timer.deadline - Date.now()) + 30,
    );
    return () => clearTimeout(id);
  }, [mode, game?.version]);
  const judge = mode === 'local' || !!room?.judge;
  return (
    <>
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode('home');
            setShield(true);
          }}
        >
          ◒{' '}
          <span>
            月隐<small>WEREWOLF TABLE</small>
          </span>
        </a>
        <nav>
          <span className="connection">
            {mode === 'local'
              ? '离线法官模式'
              : mode === 'online'
                ? connection.status
                : '真人狼人杀助手'}
          </span>
          <select aria-label="主题" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </nav>
      </header>
      <main>
        {error && (
          <div role="alert" className="error">
            <strong>操作未完成</strong>
            <p>{error}</p>
            <button onClick={() => setError('')}>关闭提示</button>
          </div>
        )}
        {mode === 'home' && (
          <>
            <section className="hero">
              <span className="eyebrow">让每一局，都有条不紊</span>
              <h1>
                天黑，请闭眼。
                <br />
                <em>余下的，交给月隐。</em>
              </h1>
              <p>
                为真人狼人杀而设计的法官助手。角色行动、发言、投票和复盘，在同一张桌上清晰流转。
              </p>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() => {
                    setMode('local');
                    setShield(true);
                  }}
                >
                  ◈ 单机法官{game ? ' · 恢复本局' : ''}
                </button>
                {session && (
                  <button onClick={() => setMode('online')}>恢复联机房间 {session.code}</button>
                )}
              </div>
            </section>
            <div className="home-grid">
              <section className="panel">
                <span className="eyebrow">一起入席</span>
                <h2>多人联机房间</h2>
                <p className="muted">法官控场，玩家在自己的设备上行动。无需注册。</p>
                <label>
                  昵称
                  <input
                    maxLength={24}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="今晚如何称呼你"
                  />
                </label>
                <label>
                  房间号
                  <input
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="六位房间号"
                  />
                </label>
                <label>
                  房间密码（可选）
                  <input
                    type="password"
                    maxLength={80}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || code.length !== 6}
                    onClick={() => enter(false)}
                  >
                    加入房间
                  </button>
                  <button disabled={busy} onClick={() => enter(true)}>
                    以法官身份创建
                  </button>
                </div>
              </section>
              <section className="panel intro">
                <span className="eyebrow">一台设备，也能开局</span>
                <h2>专注游戏，不漏流程</h2>
                <p>单机模式无需创建房间。传递设备时逐一查看身份，夜间由法官统一操作。</p>
                <ul>
                  <li>刷新后恢复本局，重新打开先遮挡身份</li>
                  <li>可配置版型、地方规则与阶段计时</li>
                  <li>裁定有记录，笔记只保存在本机</li>
                </ul>
                <button
                  onClick={() => {
                    setMode('local');
                    setShield(true);
                  }}
                >
                  进入单机模式 →
                </button>
              </section>
            </div>
          </>
        )}
        {mode === 'local' && !game && <Setup onStart={startLocal} />}
        {mode === 'local' && game && shield && (
          <section className="panel privacy">
            <span className="eyebrow">PRIVATE TABLE</span>
            <h1>身份已遮挡</h1>
            <p>请确认设备已交给法官，再恢复全知界面。</p>
            <button className="primary" onClick={() => setShield(false)}>
              我是法官，恢复本局
            </button>
          </section>
        )}
        {mode === 'local' && game && !shield && game.phase === 'identity' && (
          <section className="panel privacy">
            <span className="eyebrow">
              逐一发牌 · {card + 1} / {game.players.length}
            </span>
            <h2>请将设备交给 {game.players[card].seat} 号</h2>
            {reveal ? (
              <>
                <div className="identity-card">{ROLES[game.players[card].role]}</div>
                <button
                  className="primary"
                  onClick={async () => {
                    await send('identity', { actor: game.players[card].id });
                    setReveal(false);
                    if (card < game.players.length - 1) setCard(card + 1);
                  }}
                >
                  记住身份，隐藏并交给下一位
                </button>
              </>
            ) : (
              <button className="primary" onClick={() => setReveal(true)}>
                仅我查看身份
              </button>
            )}
            {game.players.every((p) => p.confirmed) && (
              <button onClick={() => send('startNight')}>发牌完成，法官开始首夜</button>
            )}
          </section>
        )}
        {mode === 'online' && room && (
          <section className="panel">
            {room.paused && (
              <div className="error">
                {room.paused}
                {room.judge && (
                  <button onClick={() => connection.send('resumeConsistency')}>
                    已检查，恢复房间操作
                  </button>
                )}
              </div>
            )}
            <div className="section-heading">
              <h2>房间 {room.code}</h2>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(location.origin + '/?room=' + room.code)
                    .catch(() => setError('复制失败，请手动复制房间号'))
                }
              >
                复制邀请链接
              </button>
            </div>
            <div className="members">
              {room.members.map((m) => (
                <div key={m.id}>
                  <strong>
                    {m.seat ? m.seat + ' 号' : '观战'} · {m.name}
                  </strong>
                  <small>
                    {m.online ? '在线' : '离线保留'}
                    {m.judge ? ' · 法官' : ''}
                    {m.id === room.owner ? ' · 房主' : ''}
                    {m.controlledBy ? ' · 代打中' : ''}
                  </small>
                  {room.judge && !m.judge && !m.seat && (
                    <button onClick={() => connection.send('offerJudge', { member: m.id })}>
                      授权移交法官
                    </button>
                  )}
                  {room.owner === room.self && m.id !== room.self && (
                    <button onClick={() => connection.send('owner', { member: m.id })}>
                      移交房主
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="actions">
              <input
                placeholder="修改昵称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button onClick={() => connection.send('nickname', { name })}>修改昵称</button>
              {(!room.game || room.game.phase === 'ended') && (
                <label>
                  选择座位
                  <select
                    defaultValue=""
                    onChange={(e) => connection.send('seat', { seat: Number(e.target.value) })}
                  >
                    <option value="">观战席</option>
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1} 号
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                onClick={() => {
                  connection.send('leave');
                  setMode('home');
                }}
              >
                离开房间
              </button>
            </div>
            {!!room.judgeOffer && (
              <div className="notice">
                现任法官邀请你接任。接受后可见所有身份，不能作为普通代打。
                <button onClick={() => connection.send('acceptJudge')}>接受法官授权</button>
              </div>
            )}
            <details>
              <summary>代打控制</summary>
              <p>口令有效 2 分钟、仅使用一次。撤销无法收回已经看到的信息。</p>
              <div className="actions">
                <button onClick={() => connection.send('generateCode')}>原玩家生成口令</button>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  aria-label="六位代打口令"
                  value={subcode}
                  onChange={(e) => setSubcode(e.target.value)}
                />
                <button onClick={() => connection.send('takeover', { code: subcode })}>
                  观战者接管
                </button>
                <button onClick={() => connection.send('reclaim')}>原玩家收回</button>
                {room.judge &&
                  room.members
                    .filter((m) => m.controlledBy)
                    .map((m) => (
                      <button key={m.id} onClick={() => connection.send('reclaim', { seat: m.id })}>
                        撤销 {m.seat} 号代打
                      </button>
                    ))}
              </div>
              {typeof connection.result.code === 'string' && (
                <strong className="code">{connection.result.code}</strong>
              )}
            </details>
          </section>
        )}
        {mode === 'online' && room?.judge && (!room.game || room.game.phase === 'ended') && (
          <>
            <Setup
              label="保存联机版型"
              onStart={(roles, rules) => connection.send('configure', { roles, rules })}
            />
            <button className="primary" onClick={() => connection.send('start')}>
              座位就绪，随机发牌开始本局
            </button>
          </>
        )}
        {current &&
          (mode === 'online' || (mode === 'local' && !shield && game?.phase !== 'identity')) && (
            <>
              <div className="toolbar">
                <span>{busy || connection.pending ? '正在提交…' : '等待阶段操作'}</span>
                {mode === 'local' && <button onClick={() => setShield(true)}>遮挡身份</button>}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => {
                      setNotify(e.target.checked);
                      localStorage.setItem('notify', String(e.target.checked));
                    }}
                  />
                  阶段振动提醒
                </label>
              </div>
              <Table
                g={current as GameView}
                clockOffset={mode === 'online' ? (room?.clockOffset ?? 0) : 0}
                judge={judge}
                me={mode === 'online' ? room?.controls : undefined}
                send={send}
                busy={busy || connection.pending}
              />
              <section className="panel">
                <h2>我的私人笔记</h2>
                <small>{noteState} · 不发送给法官、玩家或代打者</small>
                <textarea
                  rows={6}
                  value={notes}
                  maxLength={20000}
                  placeholder="记录发言、身份猜测与票型"
                  onChange={(e) => saveNotes(e.target.value)}
                />
                <div className="marks">
                  {current.players.map((p) => (
                    <label key={p.id}>
                      {p.seat} 号
                      <input
                        value={marks[p.id] ?? ''}
                        maxLength={80}
                        placeholder="身份猜测 / 可疑程度"
                        onChange={(e) => saveNotes(notes, { ...marks, [p.id]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <details>
                  <summary>笔记预览</summary>
                  <div className="markdown">
                    {notes
                      .split('\n')
                      .map((line, i) =>
                        line.startsWith('# ') ? (
                          <h3 key={i}>{line.slice(2)}</h3>
                        ) : (
                          <p key={i}>{line.startsWith('- ') ? '• ' + line.slice(2) : line}</p>
                        ),
                      )}
                  </div>
                </details>
              </section>
              <details className="panel">
                <summary>复盘与 JSON 导出</summary>
                <div className="actions">
                  <select
                    aria-label="复盘视角"
                    value={view}
                    onChange={(e) => setView(e.target.value)}
                  >
                    <option value="public">公共视角</option>
                    {judge || current.phase === 'ended' ? (
                      <option value="judge">法官全知视角</option>
                    ) : null}
                    {current.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.seat} 号当时视角
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    placeholder="截至回合（空为完整）"
                    value={round}
                    onChange={(e) => setRound(e.target.value)}
                  />
                  <button onClick={() => loadReplay()}>加载本局复盘</button>
                  {(mode === 'local' ? archives : (room?.archives ?? [])).map((g) => (
                    <button key={g.id} onClick={() => loadReplay(g.id)}>
                      上一局 {g.id.slice(0, 6)}
                    </button>
                  ))}
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={includeNotes}
                    onChange={(e) => setIncludeNotes(e.target.checked)}
                  />
                  明确附加我的本机私人笔记
                </label>
                {!!replayData && (
                  <>
                    <button
                      onClick={() =>
                        download(
                          'werewolf-' +
                            (replayData as { game: string }).game +
                            '-' +
                            (replayData as { perspective: string }).perspective +
                            '.json',
                          includeNotes
                            ? { replay: replayData, privateNotes: replayNotes }
                            : replayData,
                        )
                      }
                    >
                      导出当前已加载视角
                    </button>
                    <Replay data={replayData} />
                    {includeNotes && (
                      <div className="notice">
                        <h3>我在这一局的笔记</h3>
                        <pre>{replayNotes.text}</pre>
                        <pre>{JSON.stringify(replayNotes.marks, null, 2)}</pre>
                      </div>
                    )}
                  </>
                )}
              </details>
              {mode === 'local' && game?.phase === 'ended' && (
                <Setup onStart={startLocal} label="开始下一局（保存本局复盘）" />
              )}
            </>
          )}
      </main>
      <footer>
        月隐 · 真人相聚，认真游戏。<span>公开信息与隐藏身份，分别守护。</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
