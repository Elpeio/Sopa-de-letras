// Las páginas, estilos y scripts del navegador se incrustan como texto: así el
// servidor entero cabe en un único archivo para la Railway Function.
import homeHtml from "./client/home.html" with { type: "text" };
import sopaHtml from "./client/sopa.html" with { type: "text" };
import chinchonHtml from "./client/chinchon.html" with { type: "text" };
import themeCss from "./client/theme.css" with { type: "text" };
// @ts-ignore: texto plano, no un módulo
import commonJs from "./client/common.js" with { type: "text" };
// @ts-ignore: texto plano, no un módulo
import sopaJs from "./client/sopa.js" with { type: "text" };
// @ts-ignore: texto plano, no un módulo
import chinchonJs from "./client/chinchon.js" with { type: "text" };
import { type SockData } from "./rooms";
import { sopaClose, sopaMessage } from "./sopa";
import { chinchonClose, chinchonMessage } from "./chinchon";
import { categoryList } from "./words";

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
const asset = (body: string, type: string) => new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "public, max-age=300" } });

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#f4ead5"/><text x="32" y="45" font-family="Arial,sans-serif" font-size="38" font-weight="900" text-anchor="middle" fill="#e2603f">S</text></svg>`;

const text = (x: unknown) => x as string;
const pages: Record<string, string> = {
  "/": text(homeHtml),
  "/sopa": text(sopaHtml).replace("__CATEGORIES__", JSON.stringify(categoryList())),
  "/chinchon": text(chinchonHtml),
};

const server = Bun.serve<SockData>({
  port: Number(Bun.env.PORT || 3000),
  fetch(req, server) {
    const { pathname } = new URL(req.url);
    if (pathname === "/ws" || pathname === "/cards") {
      const game = pathname === "/cards" ? "chinchon" : "sopa";
      if (server.upgrade(req, { data: { game, seat: -1 } })) return;
      return new Response("Se necesita WebSocket", { status: 400 });
    }
    switch (pathname) {
      case "/assets/theme.css": return asset(themeCss, "text/css");
      case "/assets/common.js": return asset(commonJs, "text/javascript");
      case "/assets/sopa.js": return asset(sopaJs, "text/javascript");
      case "/assets/chinchon.js": return asset(chinchonJs, "text/javascript");
      case "/icon.svg": return asset(icon, "image/svg+xml");
      case "/health": return new Response("ok");
    }
    return html(pages[pathname.replace(/\/+$/, "") || "/"] ?? pages["/"]);
  },
  websocket: {
    idleTimeout: 120,
    message(ws, raw) {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== "object") return;
      if (m.action === "ping") return;
      if (ws.data.game === "chinchon") chinchonMessage(ws, m);
      else sopaMessage(ws, m);
    },
    close(ws) {
      if (ws.data.game === "chinchon") chinchonClose(ws);
      else sopaClose(ws);
    },
  },
});

console.log(`Sopa de Letras escuchando en el puerto ${server.port}`);
