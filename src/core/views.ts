import { type Game, type Actor, type Event } from './model';
export function visibleEvents(g: Game, view: Actor, until = Infinity) {
  return g.events
    .filter((e) => e.seq <= until)
    .flatMap<
      | Event
      | {
          seq: number;
          at: number;
          round: number;
          phase: string;
          kind: string;
          text?: string;
          data: Record<string, unknown>;
        }
    >((e) => {
      if (view.judge) return [e];
      const privateText = view.player ? e.privateText?.[view.player] : undefined;
      if (!e.publicText && !privateText) return [];
      // Public data uses an allowlist; original event payloads may contain role, death or target secrets.
      const fields: Record<string, string[]> = {
        signup: ['actor'],
        signupConfirmed: ['candidates'],
        withdrawRequested: ['actor'],
        withdrawConfirmed: ['players'],
        sheriffElected: ['sheriff'],
        badge: ['from', 'to'],
        speechOrder: ['origin', 'direction', 'order'],
        nextSpeaker: ['speaker'],
        interruptStart: ['actor'],
        interruptTarget: ['actor', 'target'],
        interruptEnd: ['endsDay'],
        ended: ['conclusion'],
        revive: ['target'],
        lastWords: ['actor'],
      };
      let data: Record<string, unknown> = Object.fromEntries(
        (fields[e.kind] ?? [])
          .filter((key) => key in e.data)
          .map((key) => [key, structuredClone(e.data[key])]),
      );
      if (privateText && e.kind === 'check')
        data = { actor: e.data.actor, target: e.data.target, result: e.data.result };
      if (e.kind === 'ballotConfirmed') {
        const b = e.data;
        data = {
          kind: b.kind,
          title: b.title,
          tally: b.tally,
          tied: b.tied,
          candidates: b.candidates,
          anonymous: b.anonymous,
        };
        if (!b.anonymous) data.votes = b.votes;
      }
      return [
        {
          seq: e.seq,
          at: e.at,
          round: e.round,
          phase: e.phase,
          kind: e.kind,
          text: privateText ?? e.publicText,
          data,
        },
      ];
    });
}
export function project(g: Game, view: Actor) {
  if (view.judge) return { ...structuredClone(g), isJudge: true };
  const own = g.players.find((p) => p.id === view.player);
  const current = g.night.order[g.night.index];
  const canNight =
    !!own &&
    g.phase === 'night' &&
    !g.night.awaitingNext &&
    (current === own.id || (current === 'wolves' && own.faction === 'wolves')) &&
    own.alive;
  const ballot = g.ballot
    ? {
        ...g.ballot,
        votes: Object.fromEntries(
          Object.entries(g.ballot.votes).filter(([id]) => id === view.player),
        ),
        submitted: Object.keys(g.ballot.votes).length,
      }
    : undefined;
  return {
    format: g.format,
    id: g.id,
    version: g.version,
    round: g.round,
    phase: g.phase,
    rules: g.rules,
    isJudge: false,
    players: g.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      name: p.name,
      publicDead: p.publicDead,
      revealed: p.revealed,
      idiotRevealed: p.idiotRevealed,
      confirmed: p.confirmed,
      ...(p.revealed || g.phase === 'ended' ? { role: p.role } : {}),
      ...(g.phase === 'ended' ? { faction: p.faction, initialFaction: p.initialFaction } : {}),
    })),
    own: own
      ? {
          id: own.id,
          role: own.role,
          faction: own.faction,
          medicine: own.medicine,
          checks: own.checks,
          usedKnight: own.usedKnight,
          lastGuard: own.lastGuard,
        }
      : undefined,
    canNight,
    nightActor: canNight ? current : undefined,
    pending: canNight && g.night.pending?.actor === own?.id ? g.night.pending : undefined,
    wolves:
      canNight && current === 'wolves'
        ? g.players
            .filter((p) => p.faction === 'wolves')
            .map((p) => ({ id: p.id, seat: p.seat, role: p.role, alive: p.alive }))
        : undefined,
    wolfVotes: canNight && current === 'wolves' ? g.night.wolfVotes : undefined,
    victim:
      canNight && own?.role === 'witch' && (own.medicine.save > 0 || g.rules.seeVictimWithoutSave)
        ? g.night.knife
        : undefined,
    timer: g.phase === 'night' ? (canNight ? g.timer : undefined) : g.timer,
    interrupt: g.interrupt
      ? { actor: g.interrupt.actor, kind: g.interrupt.kind, targetTimer: g.interrupt.targetTimer }
      : undefined,
    ballot,
    ballots: g.ballots.map((b) => ({ ...b, votes: b.anonymous ? {} : b.votes })),
    candidates: g.candidates,
    withdrawals: g.withdrawals,
    sheriff: g.sheriff,
    badgePending: g.badgePending,
    electionDone: g.electionDone,
    speech: g.speech,
    speechIndex: g.speechIndex,
    pendingDeath: g.pendingDeath?.actor === view.player ? g.pendingDeath : undefined,
    deathActor:
      g.phase === 'deathSkill' ? g.deaths.find((d) => d.id === g.deathQueue[0])?.target : undefined,
    conclusion: g.conclusion,
    events: visibleEvents(g, view),
  };
}
export function exportReplay(
  g: Game,
  requester: Actor,
  perspective: 'public' | 'judge' | string,
  until = Infinity,
) {
  if (
    !requester.judge &&
    g.phase !== 'ended' &&
    perspective !== 'public' &&
    perspective !== requester.player
  )
    throw Error('无权访问该复盘视角');
  if (!requester.judge && perspective === 'judge' && !(g.phase === 'ended' && g.rules.replayOpen))
    throw Error('未开放全知复盘');
  if (
    !requester.judge &&
    g.phase === 'ended' &&
    !g.rules.replayOpen &&
    perspective !== 'public' &&
    perspective !== requester.player
  )
    throw Error('未开放其他玩家视角');
  const view = {
    judge: perspective === 'judge',
    player: perspective === 'public' || perspective === 'judge' ? undefined : perspective,
  };
  return {
    format: 1,
    game: g.id,
    perspective,
    until,
    conclusion: g.events.some((e) => e.kind === 'ended' && e.seq <= until)
      ? g.conclusion
      : undefined,
    events: visibleEvents(g, view, until),
    ...(view.judge ? { deaths: g.deaths, factionHistory: g.factionHistory } : {}),
    ...(g.phase === 'ended' && until === Infinity
      ? {
          reveal: g.players.map((p) => ({
            id: p.id,
            seat: p.seat,
            role: p.role,
            faction: p.faction,
            initialFaction: p.initialFaction,
          })),
        }
      : {}),
  };
}
