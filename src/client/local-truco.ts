// Servidor del truco dentro del navegador: la misma lógica que en Bun, sin red.
// Sirve para la versión empaquetada en una sola página (artifact), sólo contra la compu.
import { trucoClose, trucoMessage } from "../truco";

type Handlers = { onOpen?: () => void; onMessage: (m: any) => void };

function connect(_path: string, { onOpen, onMessage }: Handlers) {
  const ws: any = {
    data: { game: "truco", seat: -1 },
    send(raw: string) { const m = JSON.parse(raw); setTimeout(() => onMessage(m), 0); },
  };
  setTimeout(() => onOpen?.(), 0);
  return {
    send(o: any) { if (o?.action !== "ping") trucoMessage(ws, o); return true; },
    close() { trucoClose(ws); },
  };
}

(window as any).TrucoLocal = { connect };
