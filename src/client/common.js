// Utilidades compartidas por todas las páginas de la biblioteca.
(() => {
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("sdl:" + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem("sdl:" + key, JSON.stringify(value)); } catch {} },
  };
  const session = {
    get(key) { try { return sessionStorage.getItem("sdl:" + key); } catch { return null; } },
    set(key, value) { try { value === null ? sessionStorage.removeItem("sdl:" + key) : sessionStorage.setItem("sdl:" + key, value); } catch {} },
  };

  // Un token por pestaña: permite volver a la misma silla al recargar.
  let token = session.get("token");
  if (!token) { token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); session.set("token", token); }

  const $ = (id) => document.getElementById(id);
  const el = (tag, { dataset, style, ...props } = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    if (dataset) Object.assign(node.dataset, dataset);
    if (style) node.style.cssText = style;
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  function toast(text, kind = "") {
    let box = $("toasts");
    if (!box) { box = el("div", { id: "toasts", role: "status", ariaLive: "polite" }); document.body.append(box); }
    const t = el("div", { className: "toast " + kind, textContent: text });
    box.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  /** WebSocket con reconexión automática. onOpen se vuelve a llamar al reconectar. */
  function connect(path, { onOpen, onMessage }) {
    let ws, retry = 0, closedByUser = false, ping;
    const banner = el("div", { className: "conn hide", textContent: "Reconectando…" });
    document.addEventListener("DOMContentLoaded", () => document.body.append(banner));
    if (document.body) document.body.append(banner);
    function open() {
      ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + path);
      ws.onopen = () => {
        retry = 0;
        banner.classList.add("hide");
        clearInterval(ping);
        ping = setInterval(() => api.send({ action: "ping" }), 25000);
        onOpen?.();
      };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
      ws.onclose = () => {
        clearInterval(ping);
        if (closedByUser) return;
        banner.classList.remove("hide");
        setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
      };
    }
    const api = {
      send(o) { if (ws?.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; },
      close() { closedByUser = true; ws?.close(); },
    };
    open();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ws && ws.readyState > 1) { retry = 0; open(); }
    });
    return api;
  }

  async function share(url, text) {
    if (navigator.share) {
      try { await navigator.share({ title: "Sopa de Letras", text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    copy(url);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Enlace copiado 📋", "good"); }
    catch { prompt("Copiá el enlace:", text); }
  }
  const whatsapp = (url, text) => "https://wa.me/?text=" + encodeURIComponent(text + " " + url);

  // Sonidos cortitos generados en el momento (sin archivos).
  let audio;
  function sound(kind) {
    if (!store.get("sound", true)) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      const notes = { ok: [660, 880], bad: [220, 180], turn: [520], win: [523, 659, 784, 1047], tick: [900], card: [300] }[kind] || [440];
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.09;
        o.type = kind === "bad" ? "sawtooth" : "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(kind === "tick" ? 0.03 : 0.12, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "card" ? 0.08 : 0.18));
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + 0.2);
      });
    } catch {}
  }
  function soundToggle(button) {
    const paint = () => { const on = store.get("sound", true); button.textContent = on ? "🔊" : "🔇"; button.setAttribute("aria-label", on ? "Silenciar sonido" : "Activar sonido"); };
    button.onclick = () => { store.set("sound", !store.get("sound", true)); paint(); sound("tick"); };
    paint();
  }
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };

  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = el("canvas", { className: "confetti" });
    document.body.append(c);
    const ctx = c.getContext("2d"), dpr = devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const colors = ["#ff7b5c", "#4fd1a5", "#ffcd5e", "#f5ecd9", "#b58cff"];
    const bits = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore();
      }
      if (t - t0 < 3200) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /** Grupo de botones que se comporta como un selector. */
  function choiceGroup(container, value, onChange) {
    const buttons = [...container.querySelectorAll("[data-value]")];
    const api = {
      value,
      set(v) {
        api.value = v;
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === String(v))));
      },
    };
    buttons.forEach((b) => b.addEventListener("click", () => { api.set(b.dataset.value); onChange?.(api.value); }));
    api.set(value);
    return api;
  }

  // Estadísticas locales (en este dispositivo).
  function bump(path, key) {
    const s = store.get("stats", {});
    const once = store.get("counted", []);
    if (key && once.includes(key)) return false;
    let node = s;
    const parts = path.split(".");
    parts.slice(0, -1).forEach((p) => (node = node[p] ??= {}));
    node[parts.at(-1)] = (node[parts.at(-1)] || 0) + 1;
    store.set("stats", s);
    if (key) store.set("counted", [...once.slice(-60), key]);
    return true;
  }

  const fmtTime = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  window.SDL = { store, session, token, $, el, toast, connect, share, copy, whatsapp, sound, soundToggle, buzz, confetti, choiceGroup, bump, fmtTime };
})();
