import { type Sock, newCode, sendTo } from "./rooms";
import { cleanName } from "./sopa";

// Baraja española de 40 cartas. s: 0 Oros, 1 Copas, 2 Espadas, 3 Bastos.
export interface Card { id: number; n: number; s: number }
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
const rank = (c: Card) => RANKS.indexOf(c.n);
export const cardValue = (c: Card) => Math.min(c.n, 10);
export const TARGETS = [50, 100];
const CUT_LIMIT = 5;
const BOT_DELAY = 850;

export function newDeck(rnd = Math.random): Card[] {
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) for (const n of RANKS) deck.push({ id: s * 20 + n, n, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Pierna (3 o 4 del mismo número) o escalera (3+ seguidas del mismo palo; el 7 sigue con el 10). */
export function isMeld(cards: Card[]) {
  if (cards.length < 3) return false;
  if (cards.length <= 4 && cards.every((c) => c.n === cards[0].n)) return true;
  if (!cards.every((c) => c.s === cards[0].s)) return false;
  const r = cards.map(rank).sort((a, b) => a - b);
  return r.every((v, i) => i === 0 || v === r[i - 1] + 1);
}

export const isChinchon = (cards: Card[]) => cards.length === 7 && isMeld(cards) && cards.every((c) => c.s === cards[0].s);

/** Mejor forma de agrupar la mano: menor cantidad de puntos sueltos. */
export function arrange(hand: Card[]): { points: number; melds: Card[][]; loose: Card[] } {
  const n = hand.length;
  const combos: number[] = [];
  for (let m = 1; m < 1 << n; m++) {
    const cards = hand.filter((_, i) => m & (1 << i));
    if (cards.length >= 3 && isMeld(cards)) combos.push(m);
  }
  const memo = new Map<number, { points: number; picks: number[] }>();
  const best = (used: number): { points: number; picks: number[] } => {
    const hit = memo.get(used);
    if (hit) return hit;
    let result = { points: hand.reduce((sum, c, i) => sum + (used & (1 << i) ? 0 : cardValue(c)), 0), picks: [] as number[] };
    for (const m of combos) {
      if (m & used) continue;
      const sub = best(used | m);
      if (sub.points < result.points) result = { points: sub.points, picks: [m, ...sub.picks] };
    }
    memo.set(used, result);
    return result;
  };
  const { points, picks } = best(0);
  const melds = picks.map((m) => hand.filter((_, i) => m & (1 << i)).sort((a, b) => a.n - b.n || a.s - b.s));
  const inMeld = new Set(melds.flat().map((c) => c.id));
  return { points, melds, loose: hand.filter((c) => !inMeld.has(c.id)) };
}

export const deadwood = (hand: Card[]) => arrange(hand).points;

interface Round { closer: number; gains: number[]; chinchon: boolean; hands: Card[][]; arrangements: { melds: Card[][]; loose: Card[] }[] }
export interface ChinchonRoom {
  code: string;
  names: (string | null)[];
  tokens: (string | null)[];
  bot: boolean;
  target: number;
  scores: number[];
  wins: number[];
  round: number;
  started: boolean;
  ended: boolean;
  over: boolean;
  winner: number;
  hands: Card[][];
  deck: Card[];
  pile: Card[];
  turn: number;
  phase: "draw" | "discard";
  taken: number | null;
  result: Round | null;
  event: { kind: string; seat: number; from?: string; seq: number } | null;
  sockets: Set<Sock>;
  touched: number;
  botSeq: number;
  timer?: ReturnType<typeof setTimeout>;
}

export const chinchonRooms = new Map<string, ChinchonRoom>();

function deal(r: ChinchonRoom) {
  r.deck = newDeck();
  r.hands = [r.deck.splice(0, 7), r.deck.splice(0, 7)];
  r.pile = [r.deck.pop()!];
  r.turn = r.round % 2;
  r.phase = "draw";
  r.taken = null;
  r.started = true;
  r.ended = false;
  r.result = null;
  event(r, "deal", r.turn);
}

let eventSeq = 0;
function event(r: ChinchonRoom, kind: string, seat: number, from?: string) {
  r.event = { kind, seat, from, seq: ++eventSeq };
}

function emit(r: ChinchonRoom) {
  r.touched = Date.now();
  const online = [0, 1].map((i) => (r.bot && i === 1) || [...r.sockets].some((s) => s.data.seat === i));
  for (const ws of r.sockets) {
    const i = ws.data.seat;
    const hand = r.hands[i] ?? [];
    const mine = r.started && !r.ended && r.turn === i;
    // Para cada carta, cuántos puntos sueltos quedarían si se descarta: así la
    // interfaz puede avisar cuándo y con qué carta se puede cortar.
    const options = mine && r.phase === "discard"
      ? hand.map((c) => {
          const rest = hand.filter((x) => x.id !== c.id);
          return { id: c.id, points: deadwood(rest), chinchon: isChinchon(rest), blocked: c.id === r.taken };
        })
      : [];
    const a = r.started ? arrange(hand) : null;
    sendTo(ws, {
      type: "cardState",
      state: {
        code: r.code, names: r.names, online, bot: r.bot, target: r.target, scores: r.scores, wins: r.wins,
        round: r.round, turn: r.turn, phase: r.phase, started: r.started, ended: r.ended, over: r.over, winner: r.winner,
        hand, oppCount: r.hands[1 - i]?.length ?? 0, top: r.pile.at(-1) ?? null, deck: r.deck.length,
        melds: a ? a.melds.map((m) => m.map((c) => c.id)) : [], points: a?.points ?? 0,
        options, taken: r.taken, result: r.result, event: r.event,
      },
    });
  }
}

function draw(r: ChinchonRoom, i: number, from: "pile" | "deck") {
  let card: Card | undefined;
  if (from === "pile") card = r.pile.pop();
  else {
    if (!r.deck.length) {
      const top = r.pile.pop()!;
      r.deck = newDeckFrom(r.pile.splice(0));
      r.pile = [top];
    }
    card = r.deck.pop();
  }
  if (!card) return false;
  r.hands[i].push(card);
  r.taken = from === "pile" ? card.id : null;
  r.phase = "discard";
  event(r, "draw", i, from);
  return true;
}

function newDeckFrom(cards: Card[]) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function discard(r: ChinchonRoom, i: number, id: number, close: boolean): string | null {
  const k = r.hands[i].findIndex((c) => c.id === id);
  if (k < 0) return "Elegí una carta de tu mano.";
  if (id === r.taken) return "No podés descartar la carta que levantaste del pozo.";
  const rest = r.hands[i].filter((c) => c.id !== id);
  if (close && deadwood(rest) > CUT_LIMIT) return `Para cortar, las otras 7 cartas tienen que sumar ${CUT_LIMIT} puntos sueltos o menos.`;
  r.pile.push(r.hands[i].splice(k, 1)[0]);
  r.taken = null;
  if (close) closeRound(r, i);
  else {
    r.turn = 1 - i;
    r.phase = "draw";
    event(r, "discard", i);
  }
  return null;
}

function closeRound(r: ChinchonRoom, closer: number) {
  const chinchon = isChinchon(r.hands[closer]);
  const arrangements = r.hands.map((h) => arrange(h));
  const gains = arrangements.map((a) => a.points);
  if (gains[closer] === 0) gains[closer] = -10;
  r.ended = true;
  r.result = {
    closer, gains, chinchon, hands: r.hands.map((h) => [...h]),
    arrangements: arrangements.map(({ melds, loose }) => ({ melds, loose })),
  };
  if (chinchon) {
    r.over = true;
    r.winner = closer;
  } else {
    r.scores = r.scores.map((s, j) => s + gains[j]);
    if (r.scores.some((s) => s >= r.target)) {
      r.over = true;
      r.winner = r.scores[0] === r.scores[1] ? closer : r.scores[0] < r.scores[1] ? 0 : 1;
    }
  }
  if (r.over) r.wins[r.winner]++;
  event(r, chinchon ? "chinchon" : "cut", closer);
}

// --- Bot -------------------------------------------------------------------

/** Mejor descarte posible para una mano de 8 cartas. */
function bestDiscard(hand: Card[], forbidden: number | null) {
  // Orden de preferencia: chinchón, menos puntos sueltos, descartar la carta más alta.
  const score = (o: { points: number; chinchon: boolean; value: number }) => (o.chinchon ? -1000 : 0) + o.points * 20 - o.value;
  let best = { id: -1, points: Infinity, chinchon: false, value: 0 };
  for (const c of hand) {
    if (c.id === forbidden) continue;
    const rest = hand.filter((x) => x.id !== c.id);
    const option = { id: c.id, points: deadwood(rest), chinchon: isChinchon(rest), value: cardValue(c) };
    if (best.id < 0 || score(option) < score(best)) best = option;
  }
  return best;
}

function botTurn(r: ChinchonRoom) {
  if (!r.bot || r.ended || r.turn !== 1) return;
  const seq = ++r.botSeq;
  const later = (fn: () => void) => { r.timer = setTimeout(() => { if (seq === r.botSeq && !r.ended) fn(); }, BOT_DELAY); };
  later(() => {
    const hand = r.hands[1];
    const top = r.pile.at(-1);
    const now = deadwood(hand);
    // Levanta del pozo sólo si esa carta le mejora la mano.
    const withTop = top ? bestDiscard([...hand, top], top.id) : null;
    draw(r, 1, withTop && withTop.points < now ? "pile" : "deck");
    emit(r);
    later(() => {
      const pick = bestDiscard(r.hands[1], r.taken);
      const cut = pick.chinchon || pick.points <= 2 || (pick.points <= CUT_LIMIT && (r.deck.length < 14 || Math.random() < 0.5));
      discard(r, 1, pick.id, cut);
      emit(r);
    });
  });
}

// --- Mensajes ----------------------------------------------------------------

export function chinchonMessage(ws: Sock, m: any) {
  const error = (message: string) => sendTo(ws, { type: "error", message });

  if (m.action === "create" || m.action === "bot") {
    const code = newCode(chinchonRooms);
    const bot = m.action === "bot";
    const r: ChinchonRoom = {
      code, names: [cleanName(m.name, "Jugador 1"), bot ? "Compu 🤖" : null], tokens: [String(m.token), null], bot,
      target: TARGETS.includes(m.target) ? m.target : 100, scores: [0, 0], wins: [0, 0], round: 0,
      started: false, ended: false, over: false, winner: -1, hands: [[], []], deck: [], pile: [],
      turn: 0, phase: "draw", taken: null, result: null, event: null, sockets: new Set(), touched: Date.now(), botSeq: 0,
    };
    chinchonRooms.set(code, r);
    attach(ws, r, 0);
    if (bot) deal(r);
    emit(r);
    return;
  }

  if (m.action === "join") {
    const r = chinchonRooms.get(String(m.code ?? "").trim().toUpperCase());
    if (!r) return error("Esa sala no existe o ya venció. Creá una nueva.");
    let seat = r.tokens.indexOf(String(m.token));
    if (seat < 0) {
      if (r.bot || r.names[1]) return error("La sala ya está completa.");
      seat = 1;
      r.names[1] = cleanName(m.name, "Jugador 2");
      r.tokens[1] = String(m.token);
    }
    attach(ws, r, seat);
    emit(r);
    return;
  }

  const r = chinchonRooms.get(ws.data.code ?? "");
  const i = ws.data.seat;
  if (!r || r.tokens[i] !== ws.data.token) return error("Sala no encontrada.");

  switch (m.action) {
    case "arrange":
      for (const peer of r.sockets) if (peer.data.seat !== i) sendTo(peer, { type: "cardEvent", kind: "arrange" });
      return;
    case "start":
      if (i === 0 && r.names[1] && !r.started) { deal(r); emit(r); }
      return;
    case "next":
      if (!r.ended || r.over) return;
      r.round++;
      deal(r);
      emit(r);
      botTurn(r);
      return;
    case "newmatch":
      if (!r.over) return;
      r.scores = [0, 0];
      r.over = false;
      r.winner = -1;
      r.round = r.wins[0] + r.wins[1];
      deal(r);
      emit(r);
      botTurn(r);
      return;
  }

  if (!r.started || r.ended || r.turn !== i) return;
  if (m.action === "draw" && r.phase === "draw") {
    if (!draw(r, i, m.from === "pile" ? "pile" : "deck")) return error("No quedan cartas.");
    emit(r);
    return;
  }
  if ((m.action === "discard" || m.action === "close") && r.phase === "discard") {
    const problem = discard(r, i, Number(m.id), m.action === "close");
    if (problem) return error(problem);
    emit(r);
    botTurn(r);
  }
}

function attach(ws: Sock, r: ChinchonRoom, seat: number) {
  ws.data = { ...ws.data, code: r.code, seat, token: r.tokens[seat]! };
  r.sockets.add(ws);
  sendTo(ws, { type: "cardJoined", code: r.code, seat });
}

export function chinchonClose(ws: Sock) {
  const r = chinchonRooms.get(ws.data.code ?? "");
  if (!r) return;
  r.sockets.delete(ws);
  emit(r);
}
