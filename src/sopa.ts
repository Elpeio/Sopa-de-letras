import { MIXED, wordsFor } from "./words";
import { type Sock, newCode, sendTo } from "./rooms";

export type Cell = [number, number];
export interface Placement { word: string; cells: Cell[] }
export type Mode = "solo" | "turnos" | "carrera";

const ALL_DIRS: Cell[] = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
// Las direcciones se van habilitando con la dificultad: en Fácil sólo se lee
// hacia la derecha o hacia abajo; desde Difícil también al revés.
const DIRS_BY_SIZE: Record<number, Cell[]> = { 9: ALL_DIRS.slice(0, 2), 12: ALL_DIRS.slice(0, 4), 15: ALL_DIRS, 18: ALL_DIRS };
const WORDS_BY_SIZE: Record<number, number> = { 9: 7, 12: 11, 15: 15, 18: 19 };
export const SIZES = [9, 12, 15, 18];
export const TURN_SECONDS = [15, 30, 45, 60, 90];
const LETTERS = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
const HINT_PENALTY = 20;

export function generateBoard(size: number, category: string, rnd = Math.random) {
  const dirs = DIRS_BY_SIZE[size] ?? ALL_DIRS;
  const pool = wordsFor(category).filter((w) => w.length >= 3 && w.length <= size);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const target = WORDS_BY_SIZE[size] ?? 12;
  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(""));
  const placements: Placement[] = [];
  // Primero las largas: se ubican mejor con el tablero vacío.
  const chosen = pool.slice(0, Math.min(pool.length, target + 6)).sort((a, b) => b.length - a.length);
  for (const word of chosen) {
    if (placements.length >= target) break;
    // Evita palabras contenidas en otras ya puestas (SOL dentro de GIRASOL).
    if (placements.some((p) => p.word.includes(word) || word.includes(p.word))) continue;
    for (let attempt = 0; attempt < 400; attempt++) {
      const [dr, dc] = dirs[Math.floor(rnd() * dirs.length)];
      const r = Math.floor(rnd() * size), c = Math.floor(rnd() * size);
      const cells: Cell[] = Array.from({ length: word.length }, (_, i) => [r + dr * i, c + dc * i]);
      const fits = cells.every(([y, x], i) => y >= 0 && x >= 0 && y < size && x < size && (!grid[y][x] || grid[y][x] === word[i]));
      if (!fits) continue;
      cells.forEach(([y, x], i) => (grid[y][x] = word[i]));
      placements.push({ word, cells });
      break;
    }
  }
  for (const row of grid) row.forEach((x, i) => { if (!x) row[i] = LETTERS[Math.floor(rnd() * LETTERS.length)]; });
  placements.sort((a, b) => a.word.localeCompare(b.word));
  return { grid, placements };
}

/** Celdas en línea recta entre dos puntas (horizontal, vertical o diagonal). */
export function straightLine(cells: unknown): Cell[] | null {
  if (!Array.isArray(cells) || cells.length < 2 || cells.length > 18) return null;
  const ok = cells.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n)));
  if (!ok) return null;
  const list = cells as Cell[];
  const dr = Math.sign(list[1][0] - list[0][0]), dc = Math.sign(list[1][1] - list[0][1]);
  if (dr === 0 && dc === 0) return null;
  for (let i = 1; i < list.length; i++) {
    if (list[i][0] - list[i - 1][0] !== dr || list[i][1] - list[i - 1][1] !== dc) return null;
  }
  return list;
}

interface Player { name: string; token: string }
export interface SopaRoom {
  code: string;
  mode: Mode;
  size: number;
  category: string;
  turnLength: number;
  grid: string[][];
  placements: Placement[];
  players: (Player | null)[];
  scores: number[];
  wins: number[];
  found: Record<string, { seat: number; cells: Cell[] }>;
  status: "waiting" | "playing" | "ended";
  round: number;
  turn: number;
  deadline: number;
  startedAt: number;
  endedAt: number;
  penalty: number;
  hints: Cell[];
  sockets: Set<Sock>;
  timer?: ReturnType<typeof setTimeout>;
  touched: number;
}

export const sopaRooms = new Map<string, SopaRoom>();

function publicState(r: SopaRoom) {
  const online = [0, 1].map((i) => [...r.sockets].some((s) => s.data.seat === i));
  return {
    code: r.code, mode: r.mode, size: r.size, category: r.category, turnLength: r.turnLength,
    grid: r.grid,
    words: r.placements.map((p) => p.word),
    found: r.found,
    // Las posiciones de las palabras sin encontrar sólo se revelan al final.
    missing: r.status === "ended" ? r.placements.filter((p) => !r.found[p.word]) : [],
    players: r.players.map((p) => p?.name ?? null),
    online, scores: r.scores, wins: r.wins, status: r.status, round: r.round,
    turn: r.turn, deadline: r.deadline, startedAt: r.startedAt, endedAt: r.endedAt,
    penalty: r.penalty, hints: r.hints, now: Date.now(),
  };
}

function broadcast(r: SopaRoom) {
  r.touched = Date.now();
  const msg = JSON.stringify({ type: "state", room: publicState(r) });
  for (const ws of r.sockets) try { ws.send(msg); } catch {}
}

function schedule(r: SopaRoom) {
  clearTimeout(r.timer);
  if (r.status !== "playing" || r.mode !== "turnos") return;
  r.timer = setTimeout(() => {
    if (r.status !== "playing") return;
    nextTurn(r);
    broadcast(r);
  }, Math.max(0, r.deadline - Date.now()) + 30);
}

function nextTurn(r: SopaRoom) {
  r.turn = 1 - r.turn;
  r.deadline = Date.now() + r.turnLength * 1000;
  schedule(r);
}

function start(r: SopaRoom) {
  r.status = "playing";
  r.startedAt = Date.now();
  r.turn = r.round % 2;
  r.deadline = r.mode === "turnos" ? Date.now() + r.turnLength * 1000 : 0;
  schedule(r);
}

function finish(r: SopaRoom) {
  r.status = "ended";
  r.endedAt = Date.now();
  clearTimeout(r.timer);
  if (r.mode !== "solo" && r.scores[0] !== r.scores[1]) r.wins[r.scores[0] > r.scores[1] ? 0 : 1]++;
}

function deal(r: SopaRoom) {
  Object.assign(r, generateBoard(r.size, r.category));
  r.found = {};
  r.scores = [0, 0];
  r.penalty = 0;
  r.hints = [];
  r.endedAt = 0;
}

export function sopaMessage(ws: Sock, m: any) {
  const error = (message: string) => sendTo(ws, { type: "error", message });

  if (m.action === "create") {
    const mode: Mode = ["solo", "turnos", "carrera"].includes(m.mode) ? m.mode : "turnos";
    const size = SIZES.includes(m.size) ? m.size : 12;
    const category = typeof m.category === "string" ? m.category : MIXED;
    const code = newCode(sopaRooms);
    const r: SopaRoom = {
      code, mode, size, category,
      turnLength: TURN_SECONDS.includes(m.seconds) ? m.seconds : 30,
      grid: [], placements: [],
      players: [{ name: cleanName(m.name, "Jugador 1"), token: String(m.token) }, null],
      scores: [0, 0], wins: [0, 0], found: {}, status: "waiting", round: 0,
      turn: 0, deadline: 0, startedAt: 0, endedAt: 0, penalty: 0, hints: [],
      sockets: new Set(), touched: Date.now(),
    };
    deal(r);
    sopaRooms.set(code, r);
    attach(ws, r, 0);
    if (mode === "solo") start(r);
    broadcast(r);
    return;
  }

  if (m.action === "join") {
    const r = sopaRooms.get(String(m.code ?? "").trim().toUpperCase());
    if (!r) return error("Esa sala no existe o ya venció. Creá una nueva.");
    let seat = r.players.findIndex((p) => p?.token === String(m.token));
    if (seat < 0) {
      if (r.mode === "solo" || r.players[1]) return error("La sala ya está completa.");
      seat = 1;
      r.players[1] = { name: cleanName(m.name, "Jugador 2"), token: String(m.token) };
    }
    attach(ws, r, seat);
    broadcast(r);
    return;
  }

  const r = sopaRooms.get(ws.data.code ?? "");
  if (!r) return error("Sala no encontrada.");
  const seat = ws.data.seat;
  if (r.players[seat]?.token !== ws.data.token) return;

  switch (m.action) {
    case "begin":
      if (seat === 0 && r.players[1] && r.status === "waiting") { start(r); broadcast(r); }
      return;
    case "pass":
      if (r.status === "playing" && r.mode === "turnos" && r.turn === seat) { nextTurn(r); broadcast(r); }
      return;
    case "hint": {
      if (r.status !== "playing" || r.mode !== "solo") return;
      const left = r.placements.filter((p) => !r.found[p.word]);
      const fresh = left.filter((p) => !r.hints.some(([y, x]) => y === p.cells[0][0] && x === p.cells[0][1]));
      const pick = (fresh.length ? fresh : left)[Math.floor(Math.random() * (fresh.length || left.length))];
      if (!pick) return;
      r.hints.push(pick.cells[0]);
      r.penalty += HINT_PENALTY;
      broadcast(r);
      return;
    }
    case "mark": {
      if (r.status !== "playing") return;
      if (r.mode === "turnos" && r.turn !== seat) return sendTo(ws, { type: "mark", ok: false, reason: "turn" });
      const cells = straightLine(m.cells);
      if (!cells || cells.some(([y, x]) => y < 0 || x < 0 || y >= r.size || x >= r.size)) return sendTo(ws, { type: "mark", ok: false });
      const text = cells.map(([y, x]) => r.grid[y][x]).join("");
      const reversed = [...text].reverse().join("");
      // Se acepta cualquier aparición de la palabra, aunque no sea la que se escondió.
      const hit = r.placements.find((p) => !r.found[p.word] && (p.word === text || p.word === reversed));
      if (!hit) return sendTo(ws, { type: "mark", ok: false });
      r.found[hit.word] = { seat, cells: hit.word === text ? cells : [...cells].reverse() };
      r.scores[seat] += hit.word.length;
      sendTo(ws, { type: "mark", ok: true, word: hit.word });
      if (Object.keys(r.found).length === r.placements.length) finish(r);
      broadcast(r);
      return;
    }
    case "giveup":
      if (r.status === "playing" && (r.mode === "solo" || seat === 0)) { finish(r); broadcast(r); }
      return;
    case "rematch":
      if (r.status !== "ended") return;
      if (m.size && SIZES.includes(m.size)) r.size = m.size;
      if (typeof m.category === "string") r.category = m.category;
      r.round++;
      deal(r);
      if (r.mode === "solo" || r.players[1]) start(r); else r.status = "waiting";
      broadcast(r);
      return;
  }
}

function attach(ws: Sock, r: SopaRoom, seat: number) {
  ws.data = { ...ws.data, code: r.code, seat, token: r.players[seat]!.token };
  r.sockets.add(ws);
  sendTo(ws, { type: "joined", code: r.code, seat });
}

export function sopaClose(ws: Sock) {
  const r = sopaRooms.get(ws.data.code ?? "");
  if (!r) return;
  r.sockets.delete(ws);
  broadcast(r);
}

export function cleanName(v: unknown, fallback: string) {
  const s = String(v ?? "").replace(/[<>]/g, "").trim().slice(0, 18);
  return s || fallback;
}
