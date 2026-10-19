import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";

// Levanta el servidor real y juega con dos clientes WebSocket.
const PORT = 3999;
let proc: Subprocess;
beforeAll(async () => {
  proc = Bun.spawn(["bun", "src/server.ts"], { env: { ...process.env, PORT: String(PORT) }, stdout: "pipe" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) return; } catch {}
    await Bun.sleep(100);
  }
});
afterAll(() => proc.kill());

class Client {
  ws: WebSocket;
  inbox: any[] = [];
  waiters: ((m: any) => void)[] = [];
  constructor(path: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}${path}`);
    this.ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); this.inbox.push(m); this.waiters.splice(0).forEach((w) => w(m)); };
  }
  ready() { return new Promise((r) => (this.ws.onopen = r)); }
  send(o: any) { this.ws.send(JSON.stringify(o)); }
  async next(pred: (m: any) => boolean, ms = 3000): Promise<any> {
    const start = this.inbox.length;
    const deadline = Date.now() + ms;
    let seen = 0;
    while (Date.now() < deadline) {
      const hit = this.inbox.slice(seen).find(pred);
      if (hit) { this.inbox = []; return hit; }
      seen = this.inbox.length;
      await new Promise((r) => { this.waiters.push(r); setTimeout(r, 50); });
    }
    throw new Error("timeout esperando mensaje; recibidos: " + JSON.stringify(this.inbox.slice(start).map((m) => m.type)));
  }
}

describe("páginas", () => {
  test("la biblioteca se llama Sopa de Letras", async () => {
    const html = await (await fetch(`http://localhost:${PORT}/`)).text();
    expect(html).toContain("<title>Sopa de Letras");
    for (const p of ["/sopa", "/chinchon", "/assets/theme.css", "/assets/common.js", "/assets/sopa.js", "/assets/chinchon.js", "/icon.svg"]) {
      expect((await fetch(`http://localhost:${PORT}${p}`)).status).toBe(200);
    }
  });
});

describe("sopa por WebSocket", () => {
  test("duelo por turnos: unirse, empezar, marcar, pasar turno y revancha", async () => {
    const a = new Client("/ws"), b = new Client("/ws");
    await Promise.all([a.ready(), b.ready()]);
    a.send({ action: "create", name: "Ana", token: "ta", mode: "turnos", size: 9, category: "Colores", seconds: 15 });
    const joined = await a.next((m) => m.type === "joined");
    b.send({ action: "join", code: joined.code.toLowerCase(), name: "Beto", token: "tb" });
    let s = (await b.next((m) => m.type === "state")).room;
    expect(s.players).toEqual(["Ana", "Beto"]);
    expect(s.category).toBe("Colores");
    expect(s.missing).toEqual([]); // no se filtran las posiciones
    a.send({ action: "begin" });
    s = (await a.next((m) => m.type === "state" && m.room.status === "playing")).room;
    expect(s.turn).toBe(0);

    // Con las posiciones reales (sólo el servidor las conoce) marcamos una palabra.
    const word = s.words[0];
    const grid: string[][] = s.grid;
    const cells = findWord(grid, word)!;
    expect(cells).toBeTruthy();
    b.send({ action: "mark", cells });
    expect((await b.next((m) => m.type === "mark")).ok).toBe(false); // no es su turno
    a.send({ action: "mark", cells: [...cells].reverse() });
    expect((await a.next((m) => m.type === "mark")).ok).toBe(true);
    s = (await b.next((m) => m.type === "state" && Object.keys(m.room.found).length === 1)).room;
    expect(s.scores[0]).toBe(word.length);

    a.send({ action: "pass" });
    s = (await b.next((m) => m.type === "state" && m.room.turn === 1)).room;
    a.send({ action: "giveup" });
    s = (await b.next((m) => m.type === "state" && m.room.status === "ended")).room;
    expect(s.missing.length).toBe(s.words.length - 1);
    expect(s.wins).toEqual([1, 0]);
    b.send({ action: "rematch" });
    s = (await a.next((m) => m.type === "state" && m.room.round === 1)).room;
    expect(s.status).toBe("playing");
    expect(s.turn).toBe(1);
    expect(Object.keys(s.found).length).toBe(0);

    // Reconexión: el mismo token vuelve a su silla.
    a.ws.close();
    const a2 = new Client("/ws");
    await a2.ready();
    a2.send({ action: "join", code: joined.code, token: "ta" });
    expect((await a2.next((m) => m.type === "joined")).seat).toBe(0);
    b.ws.close(); a2.ws.close();
  });

  test("solo: pistas suman tiempo", async () => {
    const a = new Client("/ws");
    await a.ready();
    a.send({ action: "create", name: "Ana", token: "solo", mode: "solo", size: 12, category: "Mezclados" });
    let s = (await a.next((m) => m.type === "state")).room;
    expect(s.status).toBe("playing");
    a.send({ action: "hint" });
    s = (await a.next((m) => m.type === "state" && m.room.hints.length === 1)).room;
    expect(s.penalty).toBe(20);
    for (const w of s.words) a.send({ action: "mark", cells: findWord(s.grid, w) });
    s = (await a.next((m) => m.type === "state" && m.room.status === "ended")).room;
    expect(Object.keys(s.found).length).toBe(s.words.length);
    a.ws.close();
  });
});

describe("chinchón por WebSocket", () => {
  test("contra la compu: robar, tirar y que el bot juegue", async () => {
    const a = new Client("/cards");
    await a.ready();
    a.send({ action: "bot", name: "Ana", token: "c1", target: 50 });
    let st = (await a.next((m) => m.type === "cardState")).state;
    expect(st.started).toBe(true);
    expect(st.hand.length).toBe(7);
    expect(st.target).toBe(50);
    a.send({ action: "draw", from: "pile" });
    st = (await a.next((m) => m.type === "cardState" && m.state.phase === "discard")).state;
    expect(st.hand.length).toBe(8);
    const taken = st.taken;
    a.send({ action: "discard", id: taken });
    expect((await a.next((m) => m.type === "error")).message).toContain("pozo");
    const other = st.hand.find((c: any) => c.id !== taken);
    a.send({ action: "discard", id: other.id });
    st = (await a.next((m) => m.type === "cardState" && m.state.turn === 1)).state;
    expect(st.hand.length).toBe(7);
    st = (await a.next((m) => m.type === "cardState" && (m.state.turn === 0 || m.state.ended), 4000)).state;
    expect(st.oppCount === 7 || st.ended).toBe(true);
    a.ws.close();
  });

  test("de a dos: sala, unirse y repartir", async () => {
    const a = new Client("/cards"), b = new Client("/cards");
    await Promise.all([a.ready(), b.ready()]);
    a.send({ action: "create", name: "Ana", token: "d1" });
    const j = await a.next((m) => m.type === "cardJoined");
    b.send({ action: "join", code: j.code, name: "Beto", token: "d2" });
    await b.next((m) => m.type === "cardState");
    a.send({ action: "start" });
    const st = (await b.next((m) => m.type === "cardState" && m.state.started)).state;
    expect(st.names).toEqual(["Ana", "Beto"]);
    expect(st.hand.length).toBe(7);
    expect(st.oppCount).toBe(7);
    a.ws.close(); b.ws.close();
  });
});

const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
function findWord(grid: string[][], word: string): number[][] | null {
  const n = grid.length;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) for (const [dr, dc] of DIRS) {
    const cells = [...word].map((_, i) => [r + dr * i, c + dc * i]);
    if (cells.every(([y, x], i) => y >= 0 && x >= 0 && y < n && x < n && grid[y][x] === word[i])) return cells;
  }
  return null;
}
