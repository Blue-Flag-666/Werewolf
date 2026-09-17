interface ReplayEvent {
  seq: number;
  at: number;
  round: number;
  kind: string;
  phase: string;
  text?: string;
  publicText?: string;
  judgeText?: string;
  data: Record<string, unknown>;
}
interface ReplayData {
  format: number;
  game: string;
  perspective: string;
  conclusion?: { reason: string; factions: string[] };
  events: ReplayEvent[];
  reveal?: { id: string; seat: number; role: string; faction: string; initialFaction: string }[];
}
const phaseNames: Record<string, string> = {
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
  ended: '本局结束',
};
export function Replay({ data }: { data: unknown }) {
  const r = data as ReplayData;
  if (!r || !Array.isArray(r.events)) return <p>复盘数据格式不可识别</p>;
  const rounds = [...new Set(r.events.map((e) => e.round))];
  return (
    <div className="replay-timeline">
      <p className="muted">
        格式 v{r.format} · 视角 {r.perspective} · 仅展示此视角在相应时点已经获得的信息
      </p>
      <div className="actions">
        {rounds.map((round) => (
          <a key={round} href={'#replay-round-' + round}>
            第 {round} 轮
          </a>
        ))}
      </div>
      {r.conclusion && (
        <div className="notice">
          终局：{r.conclusion.factions.map((f) => factionLabel(f)).join('、')} ·{' '}
          {r.conclusion.reason}
        </div>
      )}
      {rounds.map((round) => (
        <section id={'replay-round-' + round} key={round}>
          <h3>第 {round} 轮</h3>
          {r.events
            .filter((e) => e.round === round)
            .map((e) => (
              <article className="event-item" key={e.seq}>
                <small>
                  #{e.seq} · {new Date(e.at).toLocaleTimeString()} ·{' '}
                  {phaseNames[e.phase] ?? e.phase}
                </small>
                <p>{e.text ?? e.judgeText ?? e.publicText ?? e.kind}</p>
              </article>
            ))}
        </section>
      ))}
      {r.reveal && (
        <details>
          <summary>终局身份揭晓（不会插入过去阶段）</summary>
          <div className="members">
            {r.reveal.map((p) => (
              <div key={p.id}>
                {p.seat} 号 · {p.role}
                <small>
                  {factionLabel(p.initialFaction)} → {factionLabel(p.faction)}
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
import { factionLabel } from './core/model';
