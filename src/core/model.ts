export const ROLES = {
  villager: '平民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  wolf: '狼人',
  wolfKing: '狼王',
  whiteWolf: '白狼王',
  knight: '骑士',
  idiot: '白痴',
} as const;
export type Role = keyof typeof ROLES;
export const wolfRole = (r: Role) => ['wolf', 'wolfKing', 'whiteWolf'].includes(r);
export type Phase =
  | 'identity'
  | 'night'
  | 'nightDone'
  | 'signup'
  | 'campaign'
  | 'sheriffVote'
  | 'announce'
  | 'speech'
  | 'exileVote'
  | 'deathSkill'
  | 'awaitNight'
  | 'lastWords'
  | 'ended';
export interface Rules {
  win: 'edge' | 'city';
  sheriff: boolean;
  sheriffWeight: number;
  witchFirstSelf: boolean;
  witchOtherSelf: boolean;
  doubleMedicine: boolean;
  seeVictimWithoutSave: boolean;
  guardSelf: boolean;
  guardRepeat: boolean;
  saveAndGuardKills: boolean;
  emptyKnife: boolean;
  poisonedHunterShoots: boolean;
  poisonedWolfKingShoots: boolean;
  wolfKingExplosionShoots: boolean;
  knightRepeat: boolean;
  explosionEndsElection: boolean;
  speechSeconds: number;
  actionSeconds: number;
  targetSeconds: number;
  replayOpen: boolean;
  cityTargets: string[];
  thirdParties: {
    id: string;
    label: string;
    condition: 'soleSurvivors' | 'parity';
    priority: number;
    shared: boolean;
  }[];
}
export const defaultRules: Rules = {
  win: 'edge',
  sheriff: true,
  sheriffWeight: 1.5,
  witchFirstSelf: true,
  witchOtherSelf: false,
  doubleMedicine: false,
  seeVictimWithoutSave: false,
  guardSelf: true,
  guardRepeat: false,
  saveAndGuardKills: false,
  emptyKnife: true,
  poisonedHunterShoots: false,
  poisonedWolfKingShoots: false,
  wolfKingExplosionShoots: false,
  knightRepeat: false,
  explosionEndsElection: true,
  speechSeconds: 90,
  actionSeconds: 60,
  targetSeconds: 30,
  replayOpen: true,
  cityTargets: ['good'],
  thirdParties: [],
};
export interface Timer {
  started: number;
  deadline: number | null;
  remaining: number;
  paused: boolean;
  duration: number;
}
export interface Player {
  id: string;
  seat: number;
  name: string;
  role: Role;
  initialFaction: string;
  faction: string;
  group: 'civilian' | 'god' | 'wolf';
  appearance: string;
  alive: boolean;
  publicDead: boolean;
  revealed: boolean;
  confirmed: boolean;
  medicine: { save: number; poison: number };
  usedKnight: boolean;
  idiotRevealed: boolean;
  lastGuard?: string;
  deathId?: string;
  checks: { target: string; result: string; round: number; event: number }[];
}
export interface Event {
  seq: number;
  at: number;
  round: number;
  phase: Phase;
  kind: string;
  publicText?: string;
  judgeText: string;
  privateText?: Record<string, string>;
  data: Record<string, unknown>;
  audience: 'public' | 'judge' | string[];
}
export interface Death {
  id: string;
  target: string;
  source?: string;
  cause: string;
  at: number;
  round: number;
  phase: Phase;
  order: number;
  effective: boolean;
  blocked?: string;
  publicAt?: number;
  related?: string;
}
export interface Action {
  actor: string;
  target?: string;
  save?: boolean;
  poison?: string;
  pass?: boolean;
}
export interface Night {
  order: string[];
  index: number;
  awaitingNext: boolean;
  pending?: Action;
  knife?: string;
  guard?: string;
  guards?: { source: string; target: string }[];
  saves: string[];
  poisons: { source: string; target: string }[];
  wolfVotes: Record<string, string | null>;
}
export interface Ballot {
  id: string;
  kind: 'exile' | 'sheriff' | 'single' | 'yesno' | 'hands';
  title: string;
  candidates: string[];
  voters: string[];
  anonymous: boolean;
  abstain: boolean;
  votes: Record<string, string | null>;
  confirmed: boolean;
  tally?: Record<string, number>;
  tied?: string[];
  returnPhase: Phase;
  suspendedTimer?: Timer;
  timer: Timer;
  pk: number;
}
export interface Interrupt {
  actor: string;
  kind: 'whiteWolf' | 'knight';
  phase: Phase;
  timer?: Timer;
  targetTimer: Timer;
  speechIndex: number;
  ballot?: Ballot;
}
export interface Game {
  lastWordsReturn?: Phase;
  format: 1;
  id: string;
  version: number;
  round: number;
  phase: Phase;
  rules: Rules;
  players: Player[];
  events: Event[];
  deaths: Death[];
  processed: string[];
  timer?: Timer;
  night: Night;
  interrupt?: Interrupt;
  ballot?: Ballot;
  ballots: Ballot[];
  candidates: string[];
  withdrawals: string[];
  sheriff?: string;
  badgePending?: string;
  electionDone: boolean;
  speech: string[];
  speechIndex: number;
  deathQueue: string[];
  deathReturn?: Phase;
  pendingDeath?: Action;
  nightDeaths: string[];
  enabledGroups: string[];
  winner?: { factions: string[]; reason: string };
  conclusion?: { factions: string[]; reason: string; at: number };
  factionHistory: {
    player: string;
    from: string;
    to: string;
    source: string;
    reason: string;
    at: number;
  }[];
}
export interface Command {
  id: string;
  version: number;
  type: string;
  payload?: Record<string, unknown>;
}
export interface Actor {
  judge: boolean;
  player?: string;
}
export type Random = (max: number) => number;
export const secureRandom: Random = (max) => {
  if (!Number.isSafeInteger(max) || max < 1) throw Error('随机范围无效');
  const limit = Math.floor(0x100000000 / max) * max;
  let n: number;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= limit);
  return n % max;
};
export function makeTimer(seconds: number, now: number): Timer {
  return {
    started: now,
    deadline: seconds ? now + seconds * 1000 : null,
    remaining: seconds * 1000,
    paused: false,
    duration: seconds * 1000,
  };
}
export const remaining = (t: Timer, now: number) =>
  t.paused ? t.remaining : t.deadline === null ? 0 : Math.max(0, t.deadline - now);
export const expired = (t: Timer | undefined, now: number) =>
  !!t && !t.paused && t.deadline !== null && now >= t.deadline;
