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
          终局：{r.conclusion.factions.join('、')} · {r.conclusion.reason}
        </div>
      )}
      {rounds.map((round) => (
        <section id={'replay-round-' + round} key={round}>
          <h3>第 {round} 轮</h3>
          {r.events
            .filter((e) => e.round === round)
            .map((e) => (
              <details key={e.seq}>
                <summary>
                  <small>
                    #{e.seq} · {new Date(e.at).toLocaleTimeString()} · {e.phase}
                  </small>
                  <p>{e.text ?? e.judgeText ?? e.publicText ?? e.kind}</p>
                </summary>
                <pre>{JSON.stringify(e.data, null, 2)}</pre>
              </details>
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
                  {p.initialFaction} → {p.faction}
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
