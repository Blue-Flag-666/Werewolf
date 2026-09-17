import { useEffect, useState } from 'react';
import {
  type Game,
  type Player,
  type Timer,
  type Action,
  type Ballot,
  type Role,
  ROLES,
  factionLabel,
  remaining,
} from './core/model';
import { useNow } from './storage';
export type GameView = Omit<Partial<Game>, 'players' | 'events' | 'interrupt'> & {
  id: string;
  version: number;
  phase: Game['phase'];
  players: (Partial<Player> & { id: string; seat: number; name: string; publicDead: boolean })[];
  events: {
    seq: number;
    round: number;
    kind: string;
    judgeText?: string;
    text?: string;
    publicText?: string;
    data: Record<string, unknown>;
  }[];
  isJudge?: boolean;
  own?: {
    id: string;
    role: Role;
    faction: string;
    medicine: Player['medicine'];
    checks: Player['checks'];
    usedKnight: boolean;
  };
  canNight?: boolean;
  nightActor?: string;
  pending?: Action;
  victim?: string;
  wolves?: { id: string; seat: number; name: string; role: Role; alive: boolean }[];
  wolfVotes?: Record<string, string | null>;
  deathActor?: string;
  interrupt?: { actor: string; kind: string; targetTimer: Timer };
};
export type Send = (type: string, payload?: Record<string, unknown>) => void;
const phaseNames: Record<Game['phase'], string> = {
  identity: '身份确认',
  night: '夜间行动',
  nightDone: '夜间结算',
  signup: '警长报名',
  campaign: '候选人发言',
  sheriffVote: '警长投票',
  announce: '死亡公布',
  speech: '白天发言',
  exileVote: '放逐投票',
  deathSkill: '死亡技能',
  awaitNight: '等待入夜',
  lastWords: '死者遗言',
  ended: '本局复盘',
};
export function Table({
  g,
  judge,
  me,
  send,
  busy,
  clockOffset = 0,
}: {
  clockOffset?: number;
  g: GameView;
  judge: boolean;
  me?: string;
  send: Send;
  busy: boolean;
}) {
  const now = useNow() + clockOffset,
    [chosen, setChosen] = useState(''),
    [acting, setActing] = useState(''),
    [poison, setPoison] = useState(''),
    [save, setSave] = useState(false),
    [reason, setReason] = useState(''),
    [seconds, setSeconds] = useState(30),
    [ballotKind, setBallotKind] = useState('single'),
    [anonymous, setAnonymous] = useState(false),
    [title, setTitle] = useState('临时表决'),
    [voters, setVoters] = useState<string[]>([]),
    [candidates, setCandidates] = useState<string[]>([]),
    [direction, setDirection] = useState(1),
    [deathId, setDeathId] = useState(''),
    [cause, setCause] = useState(''),
    [manualWinners, setManualWinners] = useState<string[]>([]),
    [signupSelection, setSignupSelection] = useState<string[]>([]),
    [judgeTool, setJudgeTool] = useState<'player' | 'ballot' | 'winner'>('player');
  const seat = (id?: string) => g.players.find((p) => p.id === id)?.seat ?? '—';
  const current = g.night?.order[g.night.index] ?? g.nightActor;
  const roleActor = judge
    ? acting ||
      (current === 'wolves'
        ? g.players.find((p) => p.faction === 'wolves' && p.alive)?.id
        : current)
    : me;
  const own = judge ? g.players.find((p) => p.id === roleActor) : g.own;
  const nightOpen = judge ? g.phase === 'night' && !g.night?.awaitingNext : g.canNight;
  const pending = g.night?.pending ?? g.pending;
  const wolfVotes = g.night?.wolfVotes ?? g.wolfVotes ?? {};
  const wolfMembers =
    current === 'wolves'
      ? judge
        ? g.players
            .filter((p) => p.faction === 'wolves' && p.alive)
            .map((p) => ({ id: p.id, seat: p.seat, name: p.name }))
        : (g.wolves ?? [])
            .filter((p) => p.alive)
            .map((p) => ({ id: p.id, seat: p.seat, name: p.name }))
      : [];
  const wolvesSubmitted =
    wolfMembers.length > 0 && wolfMembers.every((p) => Object.hasOwn(wolfVotes, p.id));
  const wolfChoices = wolfMembers.map((p) => wolfVotes[p.id]);
  const wolvesAgreed = wolvesSubmitted && wolfChoices.every((choice) => choice === wolfChoices[0]);
  const describeAction = (action: Action) => {
    if (action.pass) return '不发动';
    const parts: string[] = [];
    if (action.target) parts.push(`选择 ${seat(action.target)} 号`);
    if (action.save) parts.push('使用解药');
    if (action.poison) parts.push(`毒药选择 ${seat(action.poison)} 号`);
    return parts.join('，') || '已提交操作';
  };
  const t = g.interrupt?.targetTimer ?? g.ballot?.timer ?? g.timer;
  const deadline = t ? remaining(t, now) : 0;
  useEffect(() => {
    setChosen('');
    setPoison('');
    setSave(false);
    setActing('');
  }, [g.phase, current, g.interrupt?.actor]);
  useEffect(() => {
    if (g.phase === 'signup')
      setSignupSelection((selected) => [...new Set([...selected, ...(g.candidates ?? [])])]);
    else setSignupSelection([]);
  }, [g.phase, (g.candidates ?? []).join('|')]);
  const act = (type: string, data: Record<string, unknown> = {}) => send(type, data);
  const confirm = (type: string, payload: Record<string, unknown>, message: string) => {
    if (window.confirm(message)) act(type, { ...payload, confirm: true, reason });
  };
  const button = (
    label: string,
    type: string,
    data: Record<string, unknown> = {},
    disabled = false,
  ) => (
    <button disabled={busy || disabled} onClick={() => act(type, data)}>
      {label}
    </button>
  );
  const targets = (
    value: string,
    onChange: (v: string) => void,
    includeDead = false,
    label = '选择操作对象',
  ) => (
    <div className="target-picker" role="group" aria-label={label}>
      <span className="target-label">{label} · 再次点击可取消</span>
      {g.players
        .filter((p) => includeDead || !p.publicDead)
        .map((p) => (
          <button
            type="button"
            key={p.id}
            className={`${value === p.id ? 'selected' : ''} ${p.publicDead ? 'dead' : ''}`}
            aria-pressed={value === p.id}
            onClick={() => onChange(value === p.id ? '' : p.id)}
          >
            <strong>{p.seat} 号</strong>
            <small>{p.name}</small>
          </button>
        ))}
    </div>
  );
  const multipleTargets = (
    values: string[],
    onChange: (values: string[]) => void,
    label: string,
  ) => (
    <div className="target-picker" role="group" aria-label={label}>
      <span className="target-label">{label} · 可选择多人，再次点击可取消</span>
      {g.players
        .filter((p) => !p.publicDead)
        .map((p) => {
          const selected = values.includes(p.id);
          return (
            <button
              type="button"
              key={p.id}
              className={selected ? 'selected' : ''}
              aria-pressed={selected}
              onClick={() =>
                onChange(selected ? values.filter((id) => id !== p.id) : [...values, p.id])
              }
            >
              <strong>{p.seat} 号</strong>
              <small>{p.name}</small>
            </button>
          );
        })}
    </div>
  );
  const deathActor = g.deathActor ?? g.deaths?.find((d) => d.id === g.deathQueue?.[0])?.target;
  const factionOptions = ['good', 'wolves', ...(g.rules?.thirdParties.map((f) => f.id) ?? [])];
  return (
    <div className="game-layout">
      <section className="main-column">
        <div className="panel phase-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                ROUND {g.round} · {judge ? '法官全知视角' : me ? '玩家视角' : '公开观战'}
              </span>
              <h2>{phaseNames[g.phase]}</h2>
            </div>
            {judge && g.phase !== 'ended' && (
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  confirm('end', {}, '确认立即结束本局？当前投票、技能和死亡结算将一并终止。')
                }
              >
                结束本局
              </button>
            )}
            {t && (
              <div className="clock" aria-live="off">
                {t.deadline === null && !t.paused ? '不限时' : `${Math.ceil(deadline / 1000)}s`}
                <small>
                  {t.paused
                    ? '已暂停'
                    : deadline === 0 && t.duration
                      ? '已截止 · 等待处理'
                      : '剩余时间'}
                </small>
              </div>
            )}
          </div>
          <p className="muted">
            {g.interrupt
              ? `${seat(g.interrupt.actor)} 号正在选择技能目标，其他流程已中断`
              : g.phase === 'night'
                ? nightOpen
                  ? `${current === 'wolves' ? '狼人团队' : `${seat(current)} 号`}行动中`
                  : '等待法官确认开始下一角色'
                : g.speech?.[g.speechIndex ?? 0]
                  ? `当前发言：${seat(g.speech[g.speechIndex ?? 0])} 号`
                  : '按阶段面板完成操作，普通结果等待法官确认。'}
          </p>
          {g.winner && judge && (
            <div className="notice">
              <strong>
                胜利建议：{g.winner.factions.map((f) => factionLabel(f, g.rules)).join('、')}
              </strong>
              <p>{g.winner.reason}</p>
              <button
                className="primary"
                onClick={() => confirm('end', {}, '确认结束本局并保存结论？')}
              >
                确认结束
              </button>
              {button('继续游戏', 'continue')}
            </div>
          )}
          {g.conclusion && (
            <div className="notice">
              <strong>
                {g.conclusion.factions.map((f) => factionLabel(f, g.rules)).join('、') ||
                  '人工结束'}
              </strong>
              <p>{g.conclusion.reason}</p>
            </div>
          )}
          {g.interrupt && (
            <div className="notice">
              <strong>
                {g.interrupt.kind === 'knight' ? '骑士决斗' : '白狼王自爆'}已发动，不能撤回
              </strong>
              {(judge || me === g.interrupt.actor) && (
                <>
                  {targets(chosen, setChosen, false, '技能目标')}
                  {button(
                    '提交目标并立即结算',
                    'interruptTarget',
                    { target: chosen },
                    !!t && deadline === 0 && !!t.duration,
                  )}
                </>
              )}
              <p>未选目标：白狼王仍结束白天；骑士无效果并恢复流程。</p>
              {deadline === 0 && !!t?.duration && button('结算目标超时', 'timeout')}
            </div>
          )}
          {!g.interrupt && (
            <>
              {g.phase === 'identity' && (
                <div className="actions">
                  {judge
                    ? g.players.map((p) => (
                        <button
                          key={p.id}
                          disabled={p.confirmed || busy}
                          onClick={() => act('identity', { actor: p.id })}
                        >
                          {p.seat} 号 {p.confirmed ? '已确认' : '确认身份'}
                        </button>
                      ))
                    : me && button('我已确认身份', 'identity')}
                  {judge && button('全部确认后进入首夜', 'startNight')}
                </div>
              )}
              {judge &&
                g.phase === 'night' &&
                g.night?.awaitingNext &&
                button(
                  g.night.index >= g.night.order.length ? '结束角色行动' : '确认开始下一角色',
                  'nextRole',
                )}
              {nightOpen && (
                <div className="action-form">
                  <h3>
                    {current === 'wolves' ? '狼人团队刀口' : ROLES[own?.role ?? 'villager']}操作
                  </h3>
                  {(current === 'wolves' || own?.role !== 'witch') &&
                    targets(
                      chosen,
                      setChosen,
                      false,
                      current === 'wolves' && judge ? '法官最终目标' : '行动目标',
                    )}
                  {own?.role === 'witch' && current !== 'wolves' && (
                    <>
                      <p>
                        刀口：{seat(judge ? g.night?.knife : g.victim)} 号 · 解药{' '}
                        {own.medicine?.save} / 毒药 {own.medicine?.poison}
                      </p>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={save}
                          onChange={(e) => setSave(e.target.checked)}
                        />
                        使用解药
                      </label>
                      {targets(poison, setPoison, false, '毒药目标')}
                    </>
                  )}
                  {current === 'wolves' && judge ? (
                    <>
                      <div className="target-picker" role="group" aria-label="狼人最终操作">
                        <span className="target-label">最终选择 · 单选，再次点击可取消</span>
                        <button
                          type="button"
                          className={chosen === '__empty_knife__' ? 'selected' : ''}
                          aria-pressed={chosen === '__empty_knife__'}
                          onClick={() =>
                            setChosen(chosen === '__empty_knife__' ? '' : '__empty_knife__')
                          }
                        >
                          <strong>不选</strong>
                          <small>本夜空刀</small>
                        </button>
                      </div>
                      <div className="actions">
                        <button
                          className="primary"
                          disabled={busy || !chosen}
                          onClick={() =>
                            confirm(
                              'confirmAction',
                              chosen === '__empty_knife__' ? { pass: true } : { target: chosen },
                              chosen === '__empty_knife__'
                                ? '确认狼人本夜不选择目标？'
                                : `确认狼人最终刀口为 ${seat(chosen)} 号？`,
                            )
                          }
                        >
                          确认狼人最终操作
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="actions">
                      <button
                        disabled={busy}
                        className="primary"
                        onClick={() =>
                          act('submitAction', { actor: roleActor, target: chosen, save, poison })
                        }
                      >
                        {current === 'wolves' ? '确认我的选择' : '提交，等待法官'}
                      </button>
                      {button(current === 'wolves' ? '确认空刀' : '不发动', 'submitAction', {
                        actor: roleActor,
                        pass: true,
                      })}
                    </div>
                  )}
                  {pending && current !== 'wolves' && (
                    <p className="notice">
                      {seat(pending.actor)} 号：{describeAction(pending)} · 等待法官确认
                    </p>
                  )}
                  {current === 'wolves' && wolfMembers.length > 0 && (
                    <div className="notice team-intent">
                      <strong>狼人团队意向</strong>
                      <div className="team-choices">
                        {wolfMembers.map((wolf) => (
                          <span key={wolf.id}>
                            {wolf.seat} 号{wolf.name ? ` ${wolf.name}` : ''}：
                            {Object.hasOwn(wolfVotes, wolf.id)
                              ? wolfVotes[wolf.id]
                                ? `${seat(wolfVotes[wolf.id] ?? undefined)} 号`
                                : '空刀'
                              : '待确认'}
                          </span>
                        ))}
                      </div>
                      <small>
                        {wolvesAgreed ? '全员意见一致，可以确认刀口' : '等待全员提交并统一意见'}
                      </small>
                    </div>
                  )}
                  {judge && (
                    <div className="actions">
                      {button(
                        current === 'wolves' ? '采用团队一致选择' : '确认当前行动',
                        'confirmAction',
                        {},
                        current === 'wolves' ? !wolvesAgreed : !pending,
                      )}
                      {button(
                        current === 'wolves' ? '清空狼人选择' : '驳回重选',
                        'rejectAction',
                        {},
                        current === 'wolves'
                          ? !Object.keys(wolfVotes).length && !pending
                          : !pending,
                      )}
                      {button('跳过当前角色', 'skipRole')}
                    </div>
                  )}
                </div>
              )}
              {judge && g.phase === 'nightDone' && button('结算夜间效果', 'settleNight')}
              {g.phase === 'signup' && (
                <div className="actions">
                  {me && button('举手上警', 'signup')}
                  {judge && (
                    <>
                      {multipleTargets(signupSelection, setSignupSelection, '警长报名名单')}
                      {button(`确认报名名单（${signupSelection.length} 人）`, 'confirmSignup', {
                        candidates: signupSelection,
                      })}
                    </>
                  )}
                </div>
              )}
              {g.phase === 'campaign' && (
                <div className="actions">
                  {me && button('申请退水', 'withdraw')}
                  {judge && (
                    <>
                      {targets(acting, setActing, false, '代操作玩家')}
                      {button('代为退水', 'withdraw', { actor: acting })}
                      {button('确认退水', 'confirmWithdraw')}
                      {button('开始警长投票', 'openBallot', { kind: 'sheriff', title: '警长选举' })}
                      {button('下一位候选人', 'nextSpeaker')}
                    </>
                  )}
                </div>
              )}
              {judge && g.phase === 'announce' && button('公布夜间死亡', 'announce')}
              {(judge || me === g.sheriff) && g.phase === 'speech' && (
                <div className="actions">
                  {targets(chosen, setChosen, true, '发言起点')}
                  <select
                    aria-label="发言方向"
                    value={direction}
                    onChange={(e) => setDirection(Number(e.target.value))}
                  >
                    <option value={1}>向左（座位递增）</option>
                    <option value={-1}>向右（座位递减）</option>
                  </select>
                  {button('安排发言', 'startSpeech', {
                    start: chosen,
                    direction: g.sheriff || chosen ? direction : undefined,
                  })}
                  {judge && button('下一位发言', 'nextSpeaker')}
                  {judge &&
                    button('发起放逐投票', 'openBallot', { kind: 'exile', title: '放逐投票' })}
                </div>
              )}
              {g.speech && g.speech.length > 0 && (
                <p className="order">
                  发言顺序{' '}
                  {g.speech.map((id, i) => (
                    <span className={i === g.speechIndex ? 'active' : ''} key={id}>
                      {seat(id)}
                    </span>
                  ))}
                </p>
              )}
              {g.phase === 'deathSkill' && (
                <div className="action-form">
                  <h3>{seat(deathActor)} 号死亡技能</h3>
                  {judge && button('开始技能计时', 'beginDeathSkill')}
                  {(judge || me === deathActor) && (
                    <>
                      {targets(chosen, setChosen, false, '技能目标')}
                      {button('提交目标 / 不发动', 'deathAction', {
                        actor: deathActor,
                        target: chosen,
                      })}
                    </>
                  )}
                  {judge && button('确认死亡技能', 'confirmDeath', {}, !g.pendingDeath)}
                  {judge && button('驳回死亡技能', 'rejectDeath', {}, !g.pendingDeath)}
                  {judge && button('登记放弃技能', 'skipDeath')}
                  {g.pendingDeath && (
                    <p>
                      待确认：
                      {g.pendingDeath.target ? `${seat(g.pendingDeath.target)} 号` : '不发动'}
                    </p>
                  )}
                </div>
              )}
              {g.badgePending && (judge || me === g.badgePending) && (
                <div className="notice">
                  <h3>警徽待处理</h3>
                  {targets(chosen, setChosen, false, '警徽接收者')}
                  {button('移交警徽 / 不选即撕毁', 'badge', { target: chosen })}
                </div>
              )}
              {judge && g.phase === 'lastWords' && button('结束本位遗言', 'nextSpeaker')}
              {judge &&
                g.phase === 'awaitNight' &&
                button(
                  g.players.some((p) => p.alive === false && !p.publicDead)
                    ? '先公布未公开死亡并结算技能'
                    : '确认进入下一夜',
                  'startNight',
                )}
            </>
          )}
          {judge && t && deadline === 0 && !!t.duration && button('处理本阶段超时', 'timeout')}
          {judge && t && (
            <details>
              <summary>计时控制</summary>
              <div className="actions">
                {['pause', 'resume', 'reset', 'end'].map((mode, i) => (
                  <button key={mode} onClick={() => act('timer', { mode })}>
                    {['暂停', '继续', '重置', '结束计时'][i]}
                  </button>
                ))}
                <input
                  aria-label="调整秒数"
                  type="number"
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                />
                {button('延长秒数', 'timer', { mode: 'extend', seconds })}
                {button('设为剩余秒数', 'timer', { mode: 'set', seconds })}
              </div>
            </details>
          )}
        </div>
        {g.ballot && (
          <section className="panel">
            <h2>{g.ballot.title}</h2>
            <p>
              {g.ballot.confirmed
                ? '结果已确认'
                : `已投 ${'submitted' in g.ballot ? g.ballot.submitted : Object.keys(g.ballot.votes).length} / ${g.ballot.voters.length}，等待法官确认`}{' '}
              · {g.ballot.anonymous ? '匿名' : '公开票型'}
            </p>
            {judge && targets(acting, setActing, false, '代投玩家')}
            <div className="actions">
              {g.ballot.candidates.map((id) => (
                <button
                  key={id}
                  disabled={busy || g.ballot?.confirmed}
                  onClick={() => act('vote', { actor: acting, target: id })}
                >
                  {g.players.some((p) => p.id === id) ? `${seat(id)} 号` : id}
                </button>
              ))}
              {g.ballot.abstain && button('弃票', 'vote', { actor: acting }, g.ballot.confirmed)}
            </div>
            {g.ballot.tally && (
              <p>
                {Object.entries(g.ballot.tally)
                  .map(
                    ([id, n]) =>
                      `${g.players.some((p) => p.id === id) ? seat(id) + '号' : id}：${n}票`,
                  )
                  .join(' / ')}
              </p>
            )}
            {judge && (
              <div className="actions">
                {!g.ballot.confirmed && (
                  <>
                    {button('确认票型及结果', 'confirmBallot', { close: true })}
                    {button('取消未确认投票', 'cancelBallot')}
                  </>
                )}
                {g.ballot.confirmed && (
                  <>
                    {button('平票 PK 重投', 'revote')}
                    {button('本轮无人当选 / 放逐', 'noWinner')}
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {judge && (
          <details className="panel">
            <summary>法官工具</summary>
            <p className="muted">仅用于临时表决、人工纠错和特殊胜负裁定。</p>
            <div className="tool-tabs" role="group" aria-label="法官工具分类">
              <button
                className={judgeTool === 'player' ? 'selected' : ''}
                aria-pressed={judgeTool === 'player'}
                onClick={() => setJudgeTool('player')}
              >
                玩家裁定
              </button>
              <button
                className={judgeTool === 'ballot' ? 'selected' : ''}
                aria-pressed={judgeTool === 'ballot'}
                onClick={() => setJudgeTool('ballot')}
              >
                临时表决
              </button>
              <button
                className={judgeTool === 'winner' ? 'selected' : ''}
                aria-pressed={judgeTool === 'winner'}
                onClick={() => setJudgeTool('winner')}
              >
                胜负裁定
              </button>
            </div>
            {judgeTool === 'player' && (
              <fieldset disabled={!!g.interrupt || busy}>
                <legend>选择玩家并执行裁定</legend>
                {targets(chosen, setChosen, true, '裁定玩家')}
                <input
                  placeholder="裁定原因（可选）"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="actions">
                  {button('安排遗言', 'lastWords', { target: chosen }, !chosen)}
                  <button
                    disabled={!chosen}
                    onClick={() =>
                      confirm('kill', { target: chosen }, '确认判死？可能产生死亡技能连锁。')
                    }
                  >
                    判死
                  </button>
                  <button
                    disabled={!chosen}
                    onClick={() =>
                      confirm('revive', { target: chosen }, '确认复活？不返还消耗，不恢复警徽。')
                    }
                  >
                    复活
                  </button>
                  <button
                    disabled={!chosen}
                    onClick={() =>
                      confirm(
                        'correct',
                        { target: chosen, publicDead: false },
                        '修正为尚未公开死亡？原始死亡历史仍保留。',
                      )
                    }
                  >
                    撤销公开死亡
                  </button>
                </div>
                <div className="tool-section">
                  <strong>调整阵营</strong>
                  <div className="actions">
                    {factionOptions.map((f) => (
                      <button
                        key={f}
                        disabled={!chosen}
                        onClick={() =>
                          confirm(
                            'faction',
                            { target: chosen, faction: f },
                            `确认将该玩家转为${factionLabel(f, g.rules)}？`,
                          )
                        }
                      >
                        {factionLabel(f, g.rules)}
                      </button>
                    ))}
                  </div>
                </div>
                <details>
                  <summary>修正死亡记录</summary>
                  <label>
                    原始记录
                    <select value={deathId} onChange={(e) => setDeathId(e.target.value)}>
                      <option value="">选择记录</option>
                      {g.deaths
                        ?.filter((d) => d.target === chosen)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            第 {d.round} 轮 #{d.order} · {d.cause}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    修正后的死因
                    <input
                      value={cause}
                      onChange={(e) => setCause(e.target.value)}
                      placeholder="保留原记录，附加修正说明"
                    />
                  </label>
                  <button
                    disabled={!chosen || !deathId}
                    onClick={() =>
                      confirm(
                        'correct',
                        { target: chosen, deathId, cause },
                        '确认附加死因修正记录？原始事件不会删除。',
                      )
                    }
                  >
                    保存修正记录
                  </button>
                </details>
              </fieldset>
            )}
            {judgeTool === 'ballot' && (
              <fieldset disabled={!!g.interrupt || busy}>
                <legend>临时表决</legend>
                <div className="fields">
                  <label>
                    标题
                    <input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </label>
                  <label>
                    类型
                    <select value={ballotKind} onChange={(e) => setBallotKind(e.target.value)}>
                      <option value="single">单选</option>
                      <option value="yesno">赞成 / 反对</option>
                      <option value="hands">举手</option>
                    </select>
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(e) => setAnonymous(e.target.checked)}
                  />
                  匿名票型
                </label>
                <details>
                  <summary>指定选民与候选人</summary>
                  <p className="muted">不选择时使用当前全部合法座位。</p>
                  {g.players
                    .filter((p) => !p.publicDead)
                    .map((p) => (
                      <div className="checks" key={p.id}>
                        <span>{p.seat} 号</span>
                        <label>
                          <input
                            type="checkbox"
                            checked={voters.includes(p.id)}
                            onChange={(e) =>
                              setVoters(
                                e.target.checked
                                  ? [...voters, p.id]
                                  : voters.filter((x) => x !== p.id),
                              )
                            }
                          />
                          选民
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={candidates.includes(p.id)}
                            onChange={(e) =>
                              setCandidates(
                                e.target.checked
                                  ? [...candidates, p.id]
                                  : candidates.filter((x) => x !== p.id),
                              )
                            }
                          />
                          候选人
                        </label>
                      </div>
                    ))}
                </details>
                {button('发起临时表决', 'openBallot', {
                  kind: ballotKind,
                  title,
                  anonymous,
                  seconds,
                  voters: voters.length ? voters : undefined,
                  candidates: candidates.length ? candidates : undefined,
                })}
              </fieldset>
            )}
            {judgeTool === 'winner' && (
              <fieldset disabled={!!g.interrupt || busy}>
                <legend>人工指定胜方</legend>
                <p className="muted">不选择阵营时，优先采用系统当前的胜利建议。</p>
                <div className="winner-options">
                  {factionOptions.map((f) => (
                    <label className="check" key={f}>
                      <input
                        type="checkbox"
                        checked={manualWinners.includes(f)}
                        onChange={(e) =>
                          setManualWinners(
                            e.target.checked
                              ? [...manualWinners, f]
                              : manualWinners.filter((item) => item !== f),
                          )
                        }
                      />
                      {factionLabel(f, g.rules)}
                    </label>
                  ))}
                </div>
                <button
                  className="danger"
                  onClick={() =>
                    confirm(
                      'end',
                      manualWinners.length ? { factions: manualWinners } : {},
                      '确认按当前胜负裁定结束本局？',
                    )
                  }
                >
                  确认胜负并结束
                </button>
              </fieldset>
            )}
          </details>
        )}
      </section>
      <aside>
        <section className="panel">
          <h2>座位与状态</h2>
          <div className="seats">
            {g.players.map((p) => {
              const role = p.role ?? (p.id === me ? g.own?.role : undefined);
              const canInterrupt =
                !g.interrupt &&
                ['signup', 'campaign', 'sheriffVote', 'announce', 'speech', 'exileVote'].includes(
                  g.phase,
                ) &&
                !p.publicDead &&
                (judge || p.id === me) &&
                !!role &&
                ['wolf', 'wolfKing', 'whiteWolf', 'knight'].includes(role) &&
                (p.alive !== false || ['whiteWolf', 'knight'].includes(role));
              return (
                <article
                  key={p.id}
                  className={`seat ${p.publicDead ? 'dead' : ''} ${p.id === me ? 'mine' : ''}`}
                >
                  <span className="seat-number">{p.seat}</span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.publicDead ? '已公布死亡' : '在场'}
                    {judge && p.alive === false && !p.publicDead ? ' · 隐藏死亡' : ''}
                    {g.sheriff === p.id ? ' · 警长' : ''}
                  </small>
                  {p.role && (
                    <span>
                      {ROLES[p.role]}
                      {judge && p.faction ? ` · ${factionLabel(p.faction, g.rules)}` : ''}
                    </span>
                  )}
                  {canInterrupt && (
                    <button
                      className="danger seat-skill"
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          'interrupt',
                          { actor: p.id },
                          `${p.seat} 号发动${role === 'knight' ? '决斗' : '自爆'}？发动即打断当前流程，不能撤回。`,
                        )
                      }
                    >
                      {role === 'knight' ? '发动决斗' : '自爆'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
        {g.own && (
          <section className="panel">
            <h2>我的身份</h2>
            <strong>{ROLES[g.own.role]}</strong>
            <p>当前阵营：{factionLabel(g.own.faction, g.rules)}</p>
            {g.own.checks.map((c) => (
              <p key={c.event}>
                第 {c.round} 夜 · {seat(c.target)} 号：{c.result}
              </p>
            ))}
          </section>
        )}
        <section className="panel">
          <h2>事件记录</h2>
          <div className="events">
            {g.events
              .slice()
              .reverse()
              .map((e) => (
                <article className="event-item" key={e.seq}>
                  <small>
                    #{e.seq} · 第 {e.round} 轮
                  </small>
                  <p>{e.text ?? e.publicText ?? e.judgeText}</p>
                </article>
              ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
