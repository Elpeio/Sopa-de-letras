import { type Sock, newCode, sendTo } from "./rooms";
import { cleanName } from "./sopa";
import { type Card, newDeck } from "./chinchon";

// Truco argentino: 1 vs 1 o 2 vs 2, con envido, truco, flor (opcional) y
// paraguayana (opcional). Las sillas van en ronda: 0, 1, 2, 3. Los equipos son
// las sillas pares (equipo 0, "nosotros" para la silla 0) e impares (equipo 1).

export type Team = 0 | 1;
export const TARGETS = [15, 30];
const BOT_DELAY = 1100;
const NEXT_HAND_DELAY = 5000;
const BOT_NAMES = ["Cacho 🤖", "Nelly 🤖", "Tito 🤖"];

// --- Valor de las cartas --------------------------------------------------------

/** Fuerza de una carta para el truco (14 = ancho de espadas … 1 = cuatro). */
export function power(c: Card): number {
  if (c.n === 1 && c.s === 2) return 14;
  if (c.n === 1 && c.s === 3) return 13;
  if (c.n === 7 && c.s === 2) return 12;
  if (c.n === 7 && c.s === 0) return 11;
  return ({ 3: 10, 2: 9, 1: 8, 12: 7, 11: 6, 10: 5, 7: 4, 6: 3, 5: 2, 4: 1 } as Record<number, number>)[c.n];
}
export const envidoValue = (c: Card) => (c.n >= 10 ? 0 : c.n);

/** Tanto del envido: dos del mismo palo suman 20 más sus valores; si no, la carta más alta. */
export function envidoOf(hand: Card[]): number {
  let best = 0;
  for (const c of hand) best = Math.max(best, envidoValue(c));
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      if (hand[i].s === hand[j].s) best = Math.max(best, 20 + envidoValue(hand[i]) + envidoValue(hand[j]));
  return best;
}
export const hasFlor = (hand: Card[]) => hand.length === 3 && hand.every((c) => c.s === hand[0].s);
export const florOf = (hand: Card[]) => 20 + hand.reduce((s, c) => s + envidoValue(c), 0);
/** Tres cartas "de descarte": distinto palo y todas 4, 5, 6 o 7 falso. */
export function isParaguayana(hand: Card[]) {
  if (hand.length !== 3 || new Set(hand.map((c) => c.s)).size !== 3) return false;
  return hand.every((c) => c.n === 4 || c.n === 5 || c.n === 6 || (c.n === 7 && (c.s === 1 || c.s === 3)));
}

// --- Cantos -----------------------------------------------------------------------

export type EnvidoCall = "E" | "R" | "F";
export const ENVIDO_NAMES: Record<EnvidoCall, string> = { E: "Envido", R: "Real envido", F: "Falta envido" };
export const TRUCO_NAMES = ["", "Truco", "Retruco", "Vale cuatro"];

export const falta = (scores: number[], target: number) => Math.max(1, target - Math.max(...scores));

/** Puntos del envido según la cadena de cantos. Si no se quiere, vale lo cantado antes del último (mínimo 1). */
export function envidoPoints(calls: EnvidoCall[], accepted: boolean, scores: number[], target: number) {
  const used = accepted ? calls : calls.slice(0, -1);
  if (!used.length) return accepted ? 0 : 1;
  return used.reduce((pts, c) => pts + (c === "E" ? 2 : c === "R" ? 3 : falta(scores, target)), 0);
}
export function envidoRaises(calls: EnvidoCall[]): EnvidoCall[] {
  const out: EnvidoCall[] = [];
  if (!calls.length || (calls.length === 1 && calls[0] === "E")) out.push("E");
  if (!calls.includes("R") && !calls.includes("F")) out.push("R");
  if (!calls.includes("F")) out.push("F");
  return out;
}

// --- Mano -------------------------------------------------------------------------

export interface Play { seat: number; card: Card }
export interface Hand {
  num: number;
  mano: number;
  turn: number;
  trick: number;
  dealt: Card[][];
  cards: Card[][];
  tricks: Play[][];
  trickWinner: number[];
  pending: { kind: "envido" | "truco" | "flor"; team: Team } | null;
  envido: { calls: EnvidoCall[]; by: number; state: "none" | "open" | "done" };
  truco: { level: number; state: "none" | "pending" | "accepted"; by: number; owner: number; interrupted: boolean };
  flor: { singer: number; level: number; state: "none" | "open" | "done" };
  envidoResult: { team: Team; points: number; accepted: boolean; says: { seat: number; value: number | null }[] } | null;
  florResult: { team: Team; points: number; text: string } | null;
  ended: boolean;
  result: { team: Team; points: number; reason: "tricks" | "noquiero" | "mazo" | "over" } | null;
}

export interface Opts { flor: boolean; paraguayana: boolean }

export interface TrucoRoom {
  code: string;
  size: 2 | 4;
  names: (string | null)[];
  tokens: (string | null)[];
  bots: boolean[];
  opts: Opts;
  target: number;
  scores: number[];
  wins: number[];
  started: boolean;
  over: boolean;
  winner: number;
  hand: Hand | null;
  handCount: number;
  events: { seq: number; kind: string; seat: number; text?: string; card?: Card; team?: number; points?: number }[];
  sockets: Set<Sock>;
  touched: number;
  botSeq: number;
  timer?: ReturnType<typeof setTimeout>;
  nextTimer?: ReturnType<typeof setTimeout>;
}

export const trucoRooms = new Map<string, TrucoRoom>();

const teamOf = (seat: number) => (seat % 2) as Team;
const seatsOf = (r: TrucoRoom, team: number) => Array.from({ length: r.size }, (_, i) => i).filter((i) => teamOf(i) === team);
const teamHasHuman = (r: TrucoRoom, team: number) => seatsOf(r, team).some((i) => !r.bots[i]);
/** Quiénes del equipo tienen flor y todavía pueden cantarla (no jugaron carta). */
const florHolders = (r: TrucoRoom, team: number) =>
  r.opts.flor && r.hand ? seatsOf(r, team).filter((i) => hasFlor(r.hand!.dealt[i]) && r.hand!.cards[i].length === 3) : [];

let eventSeq = 0;
function event(r: TrucoRoom, e: Omit<TrucoRoom["events"][number], "seq">) {
  r.events.push({ ...e, seq: ++eventSeq });
  if (r.events.length > 12) r.events.splice(0, r.events.length - 12);
}

export function deal(r: TrucoRoom, keepMano = false) {
  const num = keepMano && r.hand ? r.hand.num : r.handCount++;
  const deck = newDeck();
  const dealt = Array.from({ length: r.size }, () => deck.splice(0, 3));
  const mano = num % r.size;
  r.hand = {
    num, mano, turn: mano, trick: 0, dealt, cards: dealt.map((h) => [...h]), tricks: [[], [], []], trickWinner: [],
    pending: null, envido: { calls: [], by: -1, state: "none" }, truco: { level: 0, state: "none", by: -1, owner: -1, interrupted: false },
    flor: { singer: -1, level: 0, state: "none" }, envidoResult: null, florResult: null, ended: false, result: null,
  };
  r.started = true;
  event(r, { kind: "deal", seat: mano });
}

/** Qué puede hacer cada silla en este momento. Sirve para validar y para dibujar los botones. */
export function actionsFor(r: TrucoRoom, i: number): string[] {
  const h = r.hand;
  if (!h || h.ended || r.over) return [];
  const team = teamOf(i);
  const myFlor = r.opts.flor && hasFlor(h.dealt[i]);
  const played = h.cards[i].length < 3;
  const envidoOpen = h.trick === 0 && !played && h.envido.state !== "done" && h.flor.state === "none";
  const out: string[] = [];
  if (h.pending) {
    if (h.pending.team !== team) return [];
    if (h.pending.kind === "truco") {
      out.push("quiero", "noquiero");
      if (h.truco.level < 3) out.push(h.truco.level === 1 ? "retruco" : "vale4");
      if (envidoOpen && h.envido.state === "none") {
        if (myFlor) out.push("flor");
        else out.push(...envidoRaises([]));
      }
    } else if (h.pending.kind === "envido") {
      out.push("quiero", "noquiero", ...envidoRaises(h.envido.calls));
      if (myFlor && h.trick === 0 && !played) out.push("flor");
    } else if (h.pending.kind === "flor") {
      if (myFlor) out.push("florquiero", "florachico", ...(h.flor.level === 1 ? ["contraflor"] : []));
    }
    out.push("mazo");
    return out;
  }
  if (r.opts.paraguayana && h.trick === 0 && !played && h.envido.state === "none" && h.truco.level === 0 && h.flor.state === "none" && isParaguayana(h.dealt[i])) out.push("paraguayana");
  if (h.turn !== i) return out;
  out.push("play");
  if (envidoOpen && h.truco.level === 0 && h.envido.state === "none") {
    if (myFlor) out.push("flor");
    else out.push(...envidoRaises([]));
  }
  if (h.truco.level === 0) out.push("truco");
  else if (h.truco.state === "accepted" && h.truco.owner === team && h.truco.level < 3) out.push(h.truco.level === 1 ? "retruco" : "vale4");
  out.push("mazo");
  return out;
}

function award(r: TrucoRoom, team: number, points: number) {
  if (points <= 0) return;
  r.scores[team] += points;
  if (r.scores[team] >= r.target) {
    r.over = true;
    r.winner = team;
    r.wins[team]++;
    if (r.hand && !r.hand.ended) {
      r.hand.ended = true;
      r.hand.pending = null;
      r.hand.result = { team: team as Team, points: 0, reason: "over" };
    }
    event(r, { kind: "over", seat: -1, team });
  }
}

function endHand(r: TrucoRoom, team: Team, points: number, reason: "tricks" | "noquiero" | "mazo") {
  const h = r.hand!;
  h.ended = true;
  h.pending = null;
  h.result = { team, points, reason };
  event(r, { kind: "hand", seat: -1, team, points, text: reason });
  award(r, team, points);
  if (!r.over) {
    clearTimeout(r.nextTimer);
    r.nextTimer = setTimeout(() => { if (r.hand === h) { deal(r); emit(r); botTurn(r); } }, NEXT_HAND_DELAY);
  }
}

/** Devuelve el equipo que ganó la mano, o -1 si todavía no se sabe. */
export function handWinner(w: number[], mano: number): number {
  if (w.length >= 2) {
    const [a, b] = w;
    if (a >= 0 && a === b) return a;
    if (a === -1 && b >= 0) return b;
    if (b === -1 && a >= 0) return a;
  }
  if (w.length === 3) {
    const [a, , c] = w;
    if (c >= 0) return c;
    if (a >= 0) return a;
    return teamOf(mano);
  }
  return -1;
}

const handValue = (h: Hand) => (h.truco.level === 0 ? 1 : h.truco.level + 1);

function playCard(r: TrucoRoom, i: number, id: number): string | null {
  const h = r.hand!;
  const k = h.cards[i].findIndex((c) => c.id === id);
  if (k < 0) return "Esa carta no está en tu mano.";
  const card = h.cards[i].splice(k, 1)[0];
  h.tricks[h.trick].push({ seat: i, card });
  event(r, { kind: "play", seat: i, card });
  if (h.tricks[h.trick].length < r.size) {
    h.turn = (i + 1) % r.size;
    return null;
  }
  // Se cierra la baza.
  const plays = h.tricks[h.trick];
  const top = Math.max(...plays.map((p) => power(p.card)));
  const best = plays.filter((p) => power(p.card) === top);
  const teams = new Set(best.map((p) => teamOf(p.seat)));
  const winner = teams.size === 1 ? teamOf(best[0].seat) : -1;
  h.trickWinner.push(winner);
  event(r, { kind: "trick", seat: winner >= 0 ? best[0].seat : -1, team: winner });
  h.turn = winner >= 0 ? best[0].seat : h.mano;
  h.trick++;
  const result = handWinner(h.trickWinner, h.mano);
  if (result >= 0) endHand(r, result as Team, handValue(h), "tricks");
  return null;
}

// --- Envido y flor ----------------------------------------------------------------

function resolveEnvido(r: TrucoRoom, accepted: boolean) {
  const h = r.hand!;
  const points = envidoPoints(h.envido.calls, accepted, r.scores, r.target);
  h.envido.state = "done";
  h.pending = null;
  let team: Team;
  const says: { seat: number; value: number | null }[] = [];
  if (accepted) {
    const values = h.dealt.map((cards) => envidoOf(cards));
    const teamBest = [0, 1].map((t) => Math.max(...seatsOf(r, t).map((s) => values[s])));
    team = teamBest[0] === teamBest[1] ? teamOf(h.mano) : teamBest[0] > teamBest[1] ? 0 : 1;
    // Cada uno canta su tanto en orden desde el mano; quien no supera dice "son buenas".
    let best = -1, bestTeam = -1;
    for (let k = 0; k < r.size; k++) {
      const s = (h.mano + k) % r.size;
      const v = values[s];
      const beats = v > best || (v === best && teamOf(s) === teamOf(h.mano) && bestTeam !== teamOf(h.mano));
      if (k === 0 || beats) { says.push({ seat: s, value: v }); best = v; bestTeam = teamOf(s); }
      else says.push({ seat: s, value: null });
    }
  } else team = teamOf(h.envido.by);
  h.envidoResult = { team, points, accepted, says };
  event(r, { kind: "envido", seat: h.envido.by, team, points, text: accepted ? "quiero" : "noquiero" });
  award(r, team, points);
  resumeTruco(r);
}

function resolveFlor(r: TrucoRoom, team: Team, points: number, text: string) {
  const h = r.hand!;
  h.flor.state = "done";
  h.envido.state = "done";
  h.pending = null;
  h.florResult = { team, points, text };
  event(r, { kind: "flor", seat: h.flor.singer, team, points, text });
  award(r, team, points);
  resumeTruco(r);
}

/** Si el truco había quedado interrumpido por un envido o una flor, vuelve a esperar respuesta. */
function resumeTruco(r: TrucoRoom) {
  const h = r.hand!;
  if (h.ended || !h.truco.interrupted) return;
  h.truco.interrupted = false;
  h.pending = { kind: "truco", team: (1 - teamOf(h.truco.by)) as Team };
}

function singFlor(r: TrucoRoom, i: number) {
  const h = r.hand!;
  const team = teamOf(i);
  if (h.pending?.kind === "truco") h.truco.interrupted = true;
  if (h.envido.state === "open") h.envido.state = "done";
  h.flor = { singer: i, level: 1, state: "open" };
  event(r, { kind: "call", seat: i, text: "¡Flor!" });
  if (florHolders(r, 1 - team).length) h.pending = { kind: "flor", team: (1 - team) as Team };
  else resolveFlor(r, team, 3, "flor");
}

function fold(r: TrucoRoom, i: number) {
  const h = r.hand!;
  const team = teamOf(i), other = (1 - team) as Team;
  event(r, { kind: "call", seat: i, text: "Me voy al mazo" });
  if (h.pending?.kind === "envido" && h.pending.team === team) resolveEnvido(r, false);
  if (h.pending?.kind === "flor" && h.pending.team === team) {
    if (h.flor.level === 1) resolveFlor(r, teamOf(h.flor.singer), 4, "achico");
    else resolveFlor(r, other, 6, "achico");
  }
  if (r.over) return;
  let points = h.truco.state === "pending" ? h.truco.level : handValue(h);
  if (h.trick === 0 && h.envido.state === "none" && h.flor.state === "none") points += 1;
  endHand(r, other, points, "mazo");
}

// --- Acciones ---------------------------------------------------------------------

export function act(r: TrucoRoom, i: number, m: any): string | null {
  const h = r.hand;
  if (!h || h.ended || r.over) return "La mano ya terminó.";
  const allowed = actionsFor(r, i);
  const a: string = String(m.action);
  if (!allowed.includes(a)) return "Ahora no podés hacer eso.";
  const team = teamOf(i), other = (1 - team) as Team;
  switch (a) {
    case "play": return playCard(r, i, Number(m.id));
    case "paraguayana": {
      event(r, { kind: "paraguayana", seat: i, text: "¡Paraguayana!" });
      deal(r, true);
      return null;
    }
    case "E": case "R": case "F": {
      if (h.pending?.kind === "truco") h.truco.interrupted = true;
      h.envido.calls.push(a);
      h.envido.by = i;
      h.envido.state = "open";
      h.pending = { kind: "envido", team: other };
      event(r, { kind: "call", seat: i, text: (h.envido.calls.length > 1 && a === "E" ? "¡Envido!" : "¡" + ENVIDO_NAMES[a] + "!") });
      return null;
    }
    case "flor": singFlor(r, i); return null;
    case "truco": case "retruco": case "vale4": {
      h.truco.level = a === "truco" ? 1 : a === "retruco" ? 2 : 3;
      h.truco.state = "pending";
      h.truco.by = i;
      h.pending = { kind: "truco", team: other };
      event(r, { kind: "call", seat: i, text: "¡" + TRUCO_NAMES[h.truco.level] + "!" });
      return null;
    }
    case "quiero": {
      event(r, { kind: "call", seat: i, text: "¡Quiero!" });
      if (h.pending!.kind === "envido") resolveEnvido(r, true);
      else { h.truco.state = "accepted"; h.truco.owner = team; h.pending = null; }
      return null;
    }
    case "noquiero": {
      event(r, { kind: "call", seat: i, text: "No quiero" });
      if (h.pending!.kind === "envido") resolveEnvido(r, false);
      else endHand(r, other, h.truco.level, "noquiero");
      return null;
    }
    case "florquiero": {
      event(r, { kind: "call", seat: i, text: "¡Con flor quiero!" });
      const best = [0, 1].map((t) => Math.max(-1, ...florHolders(r, t).map((s) => florOf(h.dealt[s]))));
      const winner = best[0] === best[1] ? teamOf(h.mano) : best[0] > best[1] ? 0 : 1;
      resolveFlor(r, winner, h.flor.level === 1 ? 6 : falta(r.scores, r.target), h.flor.level === 1 ? "contraflor" : "resto");
      return null;
    }
    case "florachico": {
      event(r, { kind: "call", seat: i, text: "Con flor me achico" });
      if (h.flor.level === 1) resolveFlor(r, other, 4, "achico");
      else resolveFlor(r, other, 6, "achico");
      return null;
    }
    case "contraflor": {
      h.flor.level = 2;
      h.pending = { kind: "flor", team: other };
      event(r, { kind: "call", seat: i, text: "¡Contraflor al resto!" });
      return null;
    }
    case "mazo": fold(r, i); return null;
  }
  return "Acción desconocida.";
}

// --- Estado para el navegador -----------------------------------------------------

export function emit(r: TrucoRoom) {
  r.touched = Date.now();
  const online = r.names.map((_, i) => r.bots[i] || [...r.sockets].some((s) => s.data.seat === i));
  for (const ws of r.sockets) {
    const i = ws.data.seat;
    const h = r.hand;
    sendTo(ws, {
      type: "trucoState",
      state: {
        code: r.code, size: r.size, names: r.names, online, bots: r.bots, opts: r.opts, target: r.target,
        scores: r.scores, wins: r.wins, started: r.started, over: r.over, winner: r.winner,
        hand: h && {
          num: h.num, mano: h.mano, turn: h.turn, trick: h.trick, counts: h.cards.map((c) => c.length),
          mine: h.cards[i] ?? [], tricks: h.tricks, trickWinner: h.trickWinner, pending: h.pending,
          envido: h.envido, truco: h.truco, flor: h.flor, envidoResult: h.envidoResult, florResult: h.florResult,
          ended: h.ended, result: h.result, reveal: h.ended ? h.dealt : null,
          actions: actionsFor(r, i), myEnvido: h.dealt[i] ? envidoOf(h.dealt[i]) : 0,
          myFlor: h.dealt[i] && r.opts.flor && hasFlor(h.dealt[i]) ? florOf(h.dealt[i]) : null,
        },
        events: r.events,
      },
    });
  }
}

// --- Bot ----------------------------------------------------------------------------

/** Fuerza de la mano para el truco, entre 0 y 1, mirando cómo viene la mano. */
function trucoStrength(r: TrucoRoom, i: number) {
  const h = r.hand!;
  const team = teamOf(i);
  const cards = [...h.cards[i]].sort((a, b) => power(b) - power(a));
  if (!cards.length) return 0;
  const p = cards.map((c) => power(c) / 14);
  let s = cards.length >= 2 ? p[0] * 0.65 + p[1] * 0.35 : p[0];
  const won = h.trickWinner.filter((w) => w === team).length, lost = h.trickWinner.filter((w) => w >= 0 && w !== team).length;
  s += won * 0.18 - lost * 0.18;
  // Si en la baza actual ya estamos ganando con lo jugado, mejor todavía.
  const plays = h.tricks[h.trick];
  if (plays.length) {
    const top = Math.max(...plays.map((x) => power(x.card)));
    const ours = plays.some((x) => teamOf(x.seat) === team && power(x.card) === top);
    const theirs = plays.some((x) => teamOf(x.seat) !== team && power(x.card) === top);
    if (ours && !theirs) s += 0.12;
    else if (theirs && !cards.some((c) => power(c) > top)) s -= 0.25;
  }
  return Math.max(0, Math.min(1, s));
}

function chooseCard(r: TrucoRoom, i: number): Card {
  const h = r.hand!;
  const team = teamOf(i);
  const cards = [...h.cards[i]].sort((a, b) => power(a) - power(b));
  const plays = h.tricks[h.trick];
  const low = cards[0], high = cards[cards.length - 1];
  if (!plays.length) {
    if (h.trick === 0) return power(high) >= 12 && cards.length === 3 && power(cards[1]) >= 8 ? cards[1] : low;
    return high;
  }
  const bestOf = (mine: boolean) => Math.max(-1, ...plays.filter((x) => (teamOf(x.seat) === team) === mine).map((x) => power(x.card)));
  const ours = bestOf(true), theirs = bestOf(false);
  if (ours > theirs) return low;
  const beating = cards.filter((c) => power(c) > theirs);
  if (beating.length) return beating[0];
  const tie = cards.find((c) => power(c) === theirs);
  if (tie && h.trick === 0 && teamOf(h.mano) === team) return tie;
  return low;
}

function botChoice(r: TrucoRoom, i: number): any {
  const h = r.hand!;
  const acts = actionsFor(r, i);
  const team = teamOf(i);
  const env = envidoOf(h.dealt[i]);
  const edge = teamOf(h.mano) === team ? 0 : 1;
  const rnd = Math.random();
  if (acts.includes("paraguayana")) return { action: "paraguayana" };
  if (acts.includes("flor")) return { action: "flor" };
  if (h.pending) {
    if (h.pending.kind === "envido") {
      if (env >= 33 && acts.includes("F") && rnd < 0.5) return { action: "F" };
      if (env >= 31 && acts.includes("R")) return { action: "R" };
      if (env >= 29 && acts.includes("E")) return { action: "E" };
      if (env >= 27 + edge || (env >= 24 + edge && rnd < 0.35)) return { action: "quiero" };
      return { action: "noquiero" };
    }
    if (h.pending.kind === "truco") {
      if (acts.includes("E") && env >= 28) return { action: env >= 32 ? "R" : "E" };
      const s = trucoStrength(r, i);
      const raise = acts.find((a) => a === "retruco" || a === "vale4");
      if (raise && s >= 0.8) return { action: raise };
      if (s >= 0.45 || rnd < 0.12) return { action: "quiero" };
      return { action: "noquiero" };
    }
    if (h.pending.kind === "flor") {
      const f = florOf(h.dealt[i]);
      if (h.flor.level === 2) return { action: f >= 32 ? "florquiero" : "florachico" };
      if (f >= 35 && acts.includes("contraflor")) return { action: "contraflor" };
      if (f >= 29) return { action: "florquiero" };
      return { action: "florachico" };
    }
  }
  if (acts.includes("E")) {
    if (env >= 33 && rnd < 0.4) return { action: "F" };
    if (env >= 31) return { action: rnd < 0.5 ? "R" : "E" };
    if (env >= 27 + edge || (env >= 23 && rnd < 0.3) || rnd < 0.06) return { action: "E" };
  }
  const trucoAct = acts.find((a) => a === "truco" || a === "retruco" || a === "vale4");
  if (trucoAct) {
    const s = trucoStrength(r, i);
    const threshold = trucoAct === "truco" ? 0.6 : trucoAct === "retruco" ? 0.74 : 0.88;
    if (s >= threshold || rnd < 0.07) return { action: trucoAct };
  }
  if (acts.includes("play")) return { action: "play", id: chooseCard(r, i).id };
  return null;
}

/** Elige qué bot debería actuar ahora, si alguno. */
function botSeat(r: TrucoRoom): number {
  const h = r.hand;
  if (!h || h.ended || r.over) return -1;
  for (let i = 0; i < r.size; i++) if (r.bots[i] && actionsFor(r, i).includes("paraguayana")) return i;
  if (h.pending) {
    const team = h.pending.team;
    if (h.pending.kind !== "flor" && teamHasHuman(r, team)) return -1;
    return seatsOf(r, team).find((i) => r.bots[i] && actionsFor(r, i).length) ?? -1;
  }
  return r.bots[h.turn] ? h.turn : -1;
}

export function botTurn(r: TrucoRoom) {
  const i = botSeat(r);
  if (i < 0) return;
  const seq = ++r.botSeq;
  clearTimeout(r.timer);
  r.timer = setTimeout(() => {
    if (seq !== r.botSeq || botSeat(r) !== i) return;
    const choice = botChoice(r, i);
    if (!choice) return;
    act(r, i, choice);
    emit(r);
    botTurn(r);
  }, BOT_DELAY + Math.random() * 700);
}

// --- Mensajes ---------------------------------------------------------------------

function newRoom(m: any, size: 2 | 4, vsBot: boolean): TrucoRoom {
  const code = newCode(trucoRooms);
  const names: (string | null)[] = Array(size).fill(null);
  const bots: boolean[] = Array(size).fill(false);
  names[0] = cleanName(m.name, "Jugador 1");
  if (vsBot) for (let i = 1; i < size; i++) { bots[i] = true; names[i] = BOT_NAMES[i - 1]; }
  const r: TrucoRoom = {
    code, size, names, tokens: [String(m.token), ...Array(size - 1).fill(null)], bots,
    opts: { flor: !!m.flor, paraguayana: !!m.paraguayana }, target: TARGETS.includes(m.target) ? m.target : 30,
    scores: [0, 0], wins: [0, 0], started: false, over: false, winner: -1, hand: null, handCount: 0, events: [],
    sockets: new Set(), touched: Date.now(), botSeq: 0,
  };
  trucoRooms.set(code, r);
  return r;
}

export function trucoMessage(ws: Sock, m: any) {
  const error = (message: string) => sendTo(ws, { type: "error", message });

  if (m.action === "create" || m.action === "bot") {
    const size = m.size === 4 ? 4 : 2;
    const r = newRoom(m, size, m.action === "bot");
    attach(ws, r, 0);
    if (m.action === "bot") { deal(r); botTurn(r); }
    emit(r);
    return;
  }

  if (m.action === "join") {
    const r = trucoRooms.get(String(m.code ?? "").trim().toUpperCase());
    if (!r) return error("Esa sala no existe o ya venció. Creá una nueva.");
    let seat = r.tokens.indexOf(String(m.token));
    if (seat < 0) {
      seat = r.names.findIndex((n, i) => !n && !r.bots[i]);
      if (seat < 0 || r.started) return error("La sala ya está completa.");
      r.names[seat] = cleanName(m.name, "Jugador " + (seat + 1));
      r.tokens[seat] = String(m.token);
    }
    attach(ws, r, seat);
    emit(r);
    return;
  }

  const r = trucoRooms.get(ws.data.code ?? "");
  const i = ws.data.seat;
  if (!r || r.tokens[i] !== ws.data.token) return error("Sala no encontrada.");

  switch (m.action) {
    case "start": {
      if (i !== 0 || r.started) return;
      // Las sillas vacías se completan con la compu.
      for (let k = 1; k < r.size; k++) if (!r.names[k]) { r.bots[k] = true; r.names[k] = BOT_NAMES[(k - 1) % BOT_NAMES.length]; }
      deal(r);
      emit(r);
      botTurn(r);
      return;
    }
    case "next": {
      if (!r.hand?.ended || r.over) return;
      clearTimeout(r.nextTimer);
      deal(r);
      emit(r);
      botTurn(r);
      return;
    }
    case "newmatch": {
      if (!r.over) return;
      r.scores = [0, 0];
      r.over = false;
      r.winner = -1;
      deal(r);
      emit(r);
      botTurn(r);
      return;
    }
    case "sign": {
      // Señas: sólo las ve el compañero.
      if (r.size !== 4) return;
      for (const peer of r.sockets) if (peer.data.seat === (i + 2) % 4) sendTo(peer, { type: "trucoSign", from: i, kind: String(m.kind).slice(0, 12) });
      return;
    }
    case "chat": {
      const text = String(m.text ?? "").trim().slice(0, 80);
      if (!text) return;
      for (const peer of r.sockets) sendTo(peer, { type: "trucoChat", from: i, text });
      return;
    }
  }

  const problem = act(r, i, m);
  if (problem) return error(problem);
  emit(r);
  botTurn(r);
}

function attach(ws: Sock, r: TrucoRoom, seat: number) {
  ws.data = { ...ws.data, code: r.code, seat, token: r.tokens[seat]! };
  r.sockets.add(ws);
  sendTo(ws, { type: "trucoJoined", code: r.code, seat });
}

export function trucoClose(ws: Sock) {
  const r = trucoRooms.get(ws.data.code ?? "");
  if (!r) return;
  r.sockets.delete(ws);
  emit(r);
}
