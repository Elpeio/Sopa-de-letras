import type { ServerWebSocket } from "bun";

export interface SockData { game: "sopa" | "chinchon"; code?: string; seat: number; token?: string }
export type Sock = ServerWebSocket<SockData>;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_IDLE = 6 * 60 * 60 * 1000;

export function newCode(rooms: Map<string, { sockets: Set<unknown>; touched: number }>) {
  sweep(rooms);
  let code = "";
  do code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
  while (rooms.has(code));
  return code;
}

/** Borra salas sin nadie conectado que llevan horas sin actividad. */
export function sweep(rooms: Map<string, { sockets: Set<unknown>; touched: number; timer?: unknown }>) {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.sockets.size === 0 && now - r.touched > MAX_IDLE) {
      clearTimeout(r.timer as any);
      rooms.delete(code);
    }
  }
}

export function sendTo(ws: Sock, msg: unknown) {
  try { ws.send(JSON.stringify(msg)); } catch {}
}
