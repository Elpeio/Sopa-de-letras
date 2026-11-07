// Truco: mesa, cantos, bazas y marcador de fósforos.
(() => {
  const { $, el, store, session, toast, sound, buzz } = SDL;
  const SUITS = ["oros", "copas", "espadas", "bastos"];
  const ICONS = ["🪙", "🍷", "🗡️", "🪵"];
  const FIG = { 10: "Sota", 11: "Caballo", 12: "Rey" };
  const cardName = (c) => (FIG[c.n] ? FIG[c.n].toLowerCase() : c.n) + " de " + SUITS[c.s];
  const power = (c) => (c.n === 1 && c.s === 2 ? 14 : c.n === 1 && c.s === 3 ? 13 : c.n === 7 && c.s === 2 ? 12 : c.n === 7 && c.s === 0 ? 11
    : { 3: 10, 2: 9, 1: 8, 12: 7, 11: 6, 10: 5, 7: 4, 6: 3, 5: 2, 4: 1 }[c.n]);
  const LABEL = {
    E: "Envido", R: "Real envido", F: "Falta envido", truco: "¡Truco!", retruco: "¡Retruco!", vale4: "¡Vale cuatro!", flor: "🌸 Flor",
    quiero: "¡Quiero!", noquiero: "No quiero", florquiero: "Con flor quiero", florachico: "Con flor me achico", contraflor: "Contraflor al resto",
    mazo: "Me voy al mazo", paraguayana: "🇵🇾 ¡Paraguayana!",
  };
  const SIGNS = [["😉", "Ancho de espadas"], ["😜", "Ancho de bastos"], ["😏", "7 de espadas"], ["🙃", "7 de oros"], ["😬", "Un 3"], ["😘", "Un 2"], ["🤨", "Ancho falso"], ["🙌", "Tengo envido (28 o más)"], ["👍", "Tengo algo de envido"], ["😑", "No tengo nada"], ["❓", "¿Tenés algo?"], ["👌", "Entendido"]];
  const FACES = ["🙂", "🧔", "👩", "🧑"];

  $("name").value = store.get("name", "");
  $("name").addEventListener("input", () => store.set("name", $("name").value.trim()));
  SDL.soundToggle($("sound"));
  const prefs = store.get("trucoPrefs", { size: "2", mode: "bot", target: "30", flor: true, paraguayana: false });
  const savePrefs = () => store.set("trucoPrefs", { size: sizeC.value, mode: mode.value, target: target.value, flor: opt("optFlor"), paraguayana: opt("optPara") });
  const sizeC = SDL.choiceGroup($("sizeChoices"), prefs.size, savePrefs);
  const mode = SDL.choiceGroup($("modeChoices"), prefs.mode, () => { paintSetup(); savePrefs(); });
  const target = SDL.choiceGroup($("targetChoices"), prefs.target, savePrefs);
  const opt = (id) => $(id).getAttribute("aria-pressed") === "true";
  for (const [id, v] of [["optFlor", prefs.flor], ["optPara", prefs.paraguayana]]) {
    $(id).setAttribute("aria-pressed", String(!!v));
    $(id).onclick = () => { $(id).setAttribute("aria-pressed", String(!opt(id))); sound("tick"); savePrefs(); };
  }
  function paintSetup() { $("go").textContent = mode.value === "bot" ? "▶ Jugar contra la compu" : "✨ Crear sala e invitar"; }
  paintSetup();
  const playerName = () => $("name").value.trim() || store.get("name", "");

  // ---------- Conexión ----------
  let st = null, seat = -1, pending = null, chosen = null;
  // En la versión empaquetada (artifact) el servidor corre dentro de la página: sólo contra la compu.
  const local = !!window.TrucoLocal;
  if (local) {
    session.set("trucoRoom", null);
    document.body.classList.add("local");
    mode.set("bot");
    $("modeChoices").previousElementSibling.classList.add("hide");
    document.querySelectorAll("#setup .step:not(.hide) b").forEach((b, i) => (b.textContent = i + 1));
  }
  const rejoin = session.get("trucoRoom");
  const net = (local ? window.TrucoLocal : SDL).connect("/mesa", {
    onOpen() {
      if (pending) { net.send(pending); pending = null; }
      else if (session.get("trucoRoom")) net.send({ action: "join", code: session.get("trucoRoom"), token: SDL.token, name: playerName() });
    },
    onMessage(m) {
      if (m.type === "error") {
        toast(m.message, "bad");
        sound("bad");
        if (!st) { session.set("trucoRoom", null); show("setup"); }
      } else if (m.type === "trucoJoined") {
        seat = m.seat;
        session.set("trucoRoom", m.code);
        if (!local) history.replaceState(null, "", "/truco?sala=" + m.code);
      } else if (m.type === "trucoSign") {
        const s = SIGNS.find((x) => x[0] === m.kind);
        if (s) { bubble(m.from, s[0], "sign"); sound("tick"); if (m.kind === "❓") toast("Tu compañero te pide seña 🤫"); }
      } else if (m.type === "trucoState") {
        const old = st;
        st = m.state;
        react(old);
        render();
        afterRender();
      }
    },
  });
  const request = (msg) => { if (!net.send(msg)) pending = msg; };

  $("go").onclick = () => {
    if (!playerName()) { toast("Primero escribí tu nombre ✍️", "bad"); $("name").focus(); return; }
    request({ action: mode.value, name: playerName(), token: SDL.token, size: +sizeC.value, target: +target.value, flor: opt("optFlor"), paraguayana: opt("optPara") });
  };
  $("join").onclick = () => {
    const code = $("code").value.trim().toUpperCase();
    if (!code) { toast("Escribí el código de la sala", "bad"); return; }
    if (!playerName()) { toast("Primero escribí tu nombre ✍️", "bad"); $("name").focus(); return; }
    request({ action: "join", code, name: playerName(), token: SDL.token });
  };
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("join").click(); });
  const incoming = new URLSearchParams(location.search).get("sala");
  if (incoming && incoming.toUpperCase() !== rejoin) {
    $("code").value = incoming.toUpperCase();
    setTimeout(() => toast("Te invitaron a un truco 🎴 Tocá «Unirme»"), 300);
  }
  if (rejoin) show("game");

  function show(view) {
    const was = $(view).classList.contains("hide");
    for (const v of ["setup", "lobby", "game"]) $(v).classList.toggle("hide", v !== view);
    if (was) scrollTo(0, 0);
  }
  const inviteUrl = () => location.origin + "/truco?sala=" + st.code;
  const inviteText = "¿Un truquito? 🎴 Entrá acá:";
  $("copy").onclick = () => SDL.copy(inviteUrl());
  $("shareBtn").onclick = () => SDL.share(inviteUrl(), inviteText);
  $("start").onclick = () => net.send({ action: "start" });
  $("newmatch").onclick = () => { $("result").classList.add("hide"); net.send({ action: "newmatch" }); };
  $("closeRes").onclick = () => $("result").classList.add("hide");

  // ---------- Geometría de la mesa ----------
  const myTeam = () => seat % 2;
  const rel = (s) => (s - seat + st.size) % st.size;
  // La mano va hacia la derecha: el que sigue se sienta a mi derecha.
  const POS = { 2: ["bottom", "top"], 4: ["bottom", "right", "top", "left"] };
  const posOf = (s) => POS[st.size][rel(s)];
  const isUs = (s) => s % 2 === myTeam();
  const nameOf = (s) => (s === seat ? "Vos" : st.names[s] || "Jugador " + (s + 1));
  const teamName = (t) => (t === myTeam() ? "Nosotros" : "Ellos");
  let layoutKey = "";
  function buildTable() {
    const key = st.code + ":" + st.size + ":" + seat;
    if (layoutKey === key) return;
    layoutKey = key;
    const t = $("table");
    t.querySelectorAll(".seatbox, .played, .bubble").forEach((x) => x.remove());
    t.classList.toggle("two", st.size === 2);
    t.classList.toggle("four", st.size === 4);
    for (let s = 0; s < st.size; s++) {
      const pos = posOf(s);
      t.append(
        el("div", { className: "seatbox pos-" + pos, id: "seat" + s },
          el("div", { className: "avatar", id: "av" + s }),
          el("div", { className: "pname", id: "nm" + s }),
          s === seat ? null : el("div", { className: "backs", id: "bk" + s })),
        el("div", { className: "played pos-" + pos, id: "stack" + s }),
        el("div", { className: "bubble pos-" + pos, id: "bb" + s }),
      );
    }
    t.append(el("div", { className: "bubble pos-center", id: "bbcenter" }));
    stackState.clear();
  }

  // ---------- Reacciones ----------
  let lastSeq = 0, flyFrom = new Map(), dealing = false, bannerTimer, resultShown = null, lobbyChimed = false;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function react(old) {
    if (!st.hand) return;
    const fresh = lastSeq === 0 || !old || old.code !== st.code;
    const events = st.events.filter((e) => e.seq > lastSeq);
    if (events.length) lastSeq = events[events.length - 1].seq;
    if (fresh) { buildTable(); return; }
    buildTable();
    let delay = 0;
    for (const e of events) {
      if (e.kind === "deal") {
        dealing = true;
        timers.splice(0).forEach(clearTimeout);
        hideBanner();
        chosen = null;
        for (let s = 0; s < st.size; s++) hideBubble(s);
        sound("card");
      } else if (e.kind === "play") {
        const src = e.seat === seat ? $("hand").querySelector(`[data-id="${e.card.id}"]`) : $("bk" + e.seat)?.lastElementChild;
        if (src) flyFrom.set(e.card.id, src.getBoundingClientRect());
        sound("card");
      } else if (e.kind === "call") {
        const mine = e.seat === seat;
        const big = /truco|retruco|vale|envido|flor|contraflor/i.test(e.text || "");
        later(() => { bubble(e.seat, e.text, big ? "big" : /quiero!/i.test(e.text) ? "big ok" : ""); if (!mine) { sound(big ? "turn" : "tick"); buzz(big ? 40 : 0); } }, delay);
        delay += 350;
      } else if (e.kind === "trick") {
        later(() => {
          if (e.team < 0) { bubble("center", "¡Parda!"); sound("tick"); }
          else { sound(isUs(e.seat) ? "ok" : "bad"); }
        }, delay + 350);
        delay += 700;
      } else if (e.kind === "envido") {
        const r = st.hand.envidoResult;
        if (r?.accepted) {
          for (const s of r.says) {
            later(() => { bubble(s.seat, s.value === null ? "Son buenas" : String(s.value), s.value === null ? "" : "big ok"); sound("tick"); }, delay + 500);
            delay += 900;
          }
        }
        later(() => { bubble("center", `Envido: ${teamName(e.team)} +${e.points}`); sound(isUs(e.team) ? "ok" : "bad"); }, delay + 400);
        delay += 900;
      } else if (e.kind === "flor") {
        later(() => { bubble("center", `🌸 Flor: ${teamName(e.team)} +${e.points}`); sound(isUs(e.team) ? "ok" : "bad"); }, delay + 500);
        delay += 900;
      } else if (e.kind === "say") {
        later(() => bubble(e.seat, e.text, "say"), delay);
        delay += 300;
      } else if (e.kind === "paraguayana") {
        later(() => { bubble(e.seat, e.text, "big"); toast("Cartas malas: se reparte de nuevo 🔁"); sound("bad"); }, delay);
        delay += 600;
      } else if (e.kind === "hand") {
        const us = isUs(e.team);
        later(() => { showBanner(us, e.points, e.text); sound(us ? "win" : "bad"); buzz(us ? 60 : 20); }, delay + 500);
      } else if (e.kind === "over") {
        later(() => openResult(), delay + 900);
      }
    }
    // Es mi turno o me están esperando: avisá.
    const h = st.hand, oh = old?.hand;
    const waitingMe = h.actions.some((a) => a !== "paraguayana") && !(oh && oh.actions.some((a) => a !== "paraguayana"));
    if (waitingMe && !h.ended) later(() => { sound("turn"); buzz(25); }, delay);
  }

  function bubble(who, text, cls = "") {
    const b = $(who === "center" ? "bbcenter" : "bb" + who);
    if (!b) return;
    b.textContent = text;
    b.className = "bubble pos-" + (who === "center" ? "center" : posOf(who)) + " " + cls;
    void b.offsetWidth;
    b.classList.add("show");
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove("show"), cls.includes("sign") ? 4000 : 2600);
  }
  function hideBubble(s) { const b = $("bb" + s); if (b) { clearTimeout(b._t); b.classList.remove("show"); } }
  function showBanner(us, points, reason) {
    const b = $("banner");
    const why = { tricks: "Ganaron las bazas", noquiero: "No quisieron el truco", mazo: "Se fueron al mazo", over: "" }[reason] || "";
    b.className = "banner " + (us ? "good" : "bad");
    b.replaceChildren(
      el("h3", { textContent: (us ? "¡Mano para nosotros! " : "Mano para ellos ") + "+" + points }),
      el("p", { textContent: us ? why.replace("Ganaron", "Ganamos").replace("quisieron", "quisieron (ellos)").replace("Se fueron", "Se fueron (ellos)") : why }),
      st.over ? null : el("button", { className: "btn sm", type: "button", textContent: "Seguir →", onclick: () => { hideBanner(); net.send({ action: "next" }); } }),
    );
    b.classList.add("show");
  }
  function hideBanner() { $("banner").classList.remove("show"); }

  // ---------- Dibujo ----------
  const BRAVA = (c) => power(c) >= 11;
  function cardEl(c) {
    const node = el("div", { className: "card s" + c.s + (BRAVA(c) ? " brava" : "") });
    node.dataset.id = c.id;
    node.setAttribute("aria-label", cardName(c));
    node.append(el("span", { className: "n", textContent: c.n }), el("span", { className: "s", textContent: ICONS[c.s] }), el("span", { className: "n2", textContent: c.n }));
    if (FIG[c.n]) node.append(el("span", { className: "f", textContent: FIG[c.n] }));
    return node;
  }
  /** Mantiene los hijos con el mismo data-id y agrega/quita el resto, para no cortar animaciones. */
  function reconcile(container, items, make) {
    const keep = new Map([...container.children].map((x) => [x.dataset.id, x]));
    const out = items.map((it) => { const k = String(it.id); let node = keep.get(k); if (!node) { node = make(it); node.dataset.id = k; } keep.delete(k); return node; });
    for (const x of keep.values()) x.remove();
    out.forEach((node, i) => { if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null); });
    return out;
  }

  function render() {
    if (!st) return;
    if (!st.started) { renderLobby(); show("lobby"); return; }
    show("game");
    buildTable();
    const h = st.hand;
    renderScore();
    for (let s = 0; s < st.size; s++) renderSeat(s);
    renderStacks();
    renderStatus();
    renderHand();
    renderActions();
    if (st.over) openResult();
  }

  let prevScores = [0, 0];
  function renderScore() {
    for (const t of [0, 1]) {
      const team = (myTeam() + t) % 2;
      const box = $("team" + t);
      const who = st.size === 4 ? [team, team + 2].map(nameOf).join(" y ") : nameOf(team);
      box.classList.toggle("win", st.over && st.winner === team);
      box.replaceChildren(
        el("div", { className: "tname", textContent: t === 0 ? "Nosotros" : "Ellos" }),
        el("b", { className: "pts", textContent: st.scores[team] }),
        el("div", { className: "tnames", textContent: who }),
        tally(st.scores[team], st.target, prevScores[team]),
      );
    }
    prevScores = [...st.scores];
  }
  function tally(points, target, prev) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const squares = target / 5, w = squares * 24 + (squares > 3 ? 10 : 0) + 4;
    svg.setAttribute("viewBox", `0 0 ${w} 30`);
    svg.setAttribute("class", "tally");
    svg.setAttribute("preserveAspectRatio", "xMinYMid meet");
    const line = (x1, y1, x2, y2, cls) => { const l = document.createElementNS(svg.namespaceURI, "line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); l.setAttribute("class", cls); svg.append(l); };
    const head = (x, y, cls) => { const c = document.createElementNS(svg.namespaceURI, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 2.2); c.setAttribute("class", cls); svg.append(c); };
    const text = (x, t) => { const n = document.createElementNS(svg.namespaceURI, "text"); n.setAttribute("x", x); n.setAttribute("y", 29); n.setAttribute("class", "lbl"); n.textContent = t; svg.append(n); };
    for (let q = 0; q < squares; q++) {
      const x = 2 + q * 24 + (q >= 3 ? 10 : 0), y = 2, S = 18;
      const segs = [[x, y + S, x, y], [x, y, x + S, y], [x + S, y, x + S, y + S], [x + S, y + S, x, y + S], [x, y + S, x + S, y]];
      segs.forEach(([x1, y1, x2, y2], k) => {
        const idx = q * 5 + k;
        if (idx >= points) return;
        const cls = idx >= prev ? "new" : "";
        line(x1, y1, x2, y2, "m " + cls);
        head(x2, y2, "h " + cls);
      });
    }
    if (target === 30) { text(2, "MALAS"); text(2 + 3 * 24 + 10, "BUENAS"); }
    return svg;
  }

  function renderSeat(s) {
    const h = st.hand;
    const box = $("seat" + s);
    const waiting = h && !h.ended && (h.pending ? h.pending.team === s % 2 : h.turn === s);
    box.classList.toggle("turn", !!waiting);
    box.classList.toggle("mano", !!h && h.mano === s);
    const av = $("av" + s);
    av.textContent = st.bots[s] ? "🤖" : s === seat ? FACES[0] : FACES[s % FACES.length];
    av.classList.toggle("off", !st.online[s]);
    $("nm" + s).replaceChildren(el("span", { className: "dot" + (st.online[s] ? " on" : "") }), (s === seat ? "Vos" : st.names[s]) + (isUs(s) ? "" : ""));
    if (s === seat || !h) return;
    const bk = $("bk" + s);
    if (h.ended && h.reveal) {
      const left = h.reveal[s].filter((c) => !h.tricks.flat().some((p) => p.card.id === c.id));
      reconcile(bk, left, cardEl);
    } else {
      const n = h.counts[s];
      reconcile(bk, Array.from({ length: n }, (_, i) => ({ id: "b" + i })), () => el("div", { className: "cback" + (dealing ? " deal" : "") }));
      [...bk.children].forEach((x, i) => x.style.setProperty("--r", (i - (n - 1) / 2) * 7 + "deg"));
    }
  }

  const stackState = new Map();
  function renderStacks() {
    const h = st.hand;
    const perSeat = Array.from({ length: st.size }, () => []);
    const winners = new Set(), losers = new Set();
    h.tricks.forEach((plays, k) => {
      plays.forEach((p) => perSeat[p.seat].push({ ...p.card, k }));
      if (plays.length === st.size && k < h.trickWinner.length) {
        const top = Math.max(...plays.map((p) => power(p.card)));
        plays.forEach((p) => (power(p.card) === top && h.trickWinner[k] >= 0 && p.seat % 2 === h.trickWinner[k] ? winners : losers).add(p.card.id));
      }
    });
    for (let s = 0; s < st.size; s++) {
      const box = $("stack" + s);
      const nodes = reconcile(box, perSeat[s], (c) => {
        const node = cardEl(c);
        const from = flyFrom.get(c.id);
        if (from) { node.classList.add("fly"); node._from = from; flyFrom.delete(c.id); }
        return node;
      });
      nodes.forEach((node, i) => {
        node.style.setProperty("--k", perSeat[s][i].k);
        node.classList.toggle("win", winners.has(perSeat[s][i].id));
        node.classList.toggle("lose", losers.has(perSeat[s][i].id));
        node.classList.toggle("old", perSeat[s][i].k < h.trick - (h.tricks[h.trick]?.length ? 0 : 1) && !h.ended);
      });
    }
  }
  /** Las cartas recién jugadas vuelan desde la mano (o desde el abanico del rival) hasta la mesa. */
  function afterRender() {
    for (const node of document.querySelectorAll(".played .card.fly")) {
      const from = node._from, to = node.getBoundingClientRect();
      const base = getComputedStyle(node).transform;
      node.style.transform = `translate(${from.left - to.left + (from.width - to.width) / 2}px, ${from.top - to.top + (from.height - to.height) / 2}px) scale(${from.width / to.width})`;
      void node.offsetWidth;
      node.classList.remove("fly");
      node.style.transform = "";
      node._from = null;
      void base;
    }
    dealing = false;
  }

  function renderStatus() {
    const h = st.hand, box = $("status");
    let text = "", mine = false;
    if (st.over) text = st.winner === myTeam() ? "🏆 ¡Ganamos!" : "Ganaron ellos";
    else if (h.ended) text = "";
    else if (h.pending) {
      const me = h.pending.team === myTeam();
      const what = h.pending.kind === "truco" ? ["", "el truco", "el retruco", "el vale cuatro"][h.truco.level] : h.pending.kind === "envido" ? "el envido" : "la flor";
      mine = me;
      text = me ? (h.actions.length ? `Te cantaron ${what}. ¿Qué hacés?` : `Tu compañero decide ${what}…`) : `Esperando que contesten ${what}…`;
    } else if (h.turn === seat) { mine = true; text = h.trick === 0 && h.actions.some((a) => "ERF".includes(a) || a === "flor") ? "Tu turno: cantá o jugá" : "Tu turno: jugá una carta"; }
    else text = `Juega ${nameOf(h.turn)}…`;
    box.textContent = text;
    box.classList.toggle("mine", mine);
    $("handNum").textContent = h ? `Mano ${h.num + 1} · es mano ${nameOf(h.mano).toLowerCase() === "vos" ? "vos" : nameOf(h.mano)}` : "";
    const info = $("myEnvido");
    if (h && !h.ended) {
      info.innerHTML = h.myFlor ? `🌸 Tu flor: <b>${h.myFlor}</b>` : `Tu envido: <b>${h.myEnvido}</b>`;
    } else info.textContent = "";
  }

  function renderHand() {
    const h = st.hand, hand = $("hand");
    const canPlay = h.actions.includes("play");
    hand.classList.toggle("locked", !canPlay);
    if (chosen !== null && !h.mine.some((c) => c.id === chosen)) chosen = null;
    const nodes = reconcile(hand, h.mine, (c) => { const b = cardEl(c); if (dealing) b.classList.add("deal"); bindDrag(b, c); return b; });
    nodes.forEach((b, i) => {
      b.style.setProperty("--r", (i - (nodes.length - 1) / 2) * 5 + "deg");
      b.classList.toggle("sel", chosen === b.dataset.id * 1);
    });
  }

  const KIND = { quiero: "mint", noquiero: "", truco: "primary", retruco: "primary", vale4: "primary", E: "gold", R: "gold", F: "gold", flor: "violet", florquiero: "violet", florachico: "", contraflor: "violet", paraguayana: "violet", mazo: "ghost mazo" };
  const ORDER = ["quiero", "noquiero", "E", "R", "F", "flor", "florquiero", "contraflor", "florachico", "truco", "retruco", "vale4", "paraguayana", "mazo"];
  let lastActionsKey = "";
  function renderActions() {
    const h = st.hand, box = $("actions");
    const acts = ORDER.filter((a) => h.actions.includes(a));
    const key = acts.join() + ":" + chosen + ":" + h.actions.includes("play");
    if (key === lastActionsKey) return;
    lastActionsKey = key;
    const buttons = acts.map((a) => el("button", { className: "btn " + (KIND[a] || "") + (lastActionsKey && ["quiero", "noquiero"].includes(a) ? " shout" : ""), type: "button", textContent: LABEL[a], onclick: () => { sound("tick"); net.send({ action: a }); } }));
    if (h.actions.includes("play") && chosen !== null) buttons.unshift(el("button", { className: "btn primary", type: "button", textContent: "🃏 Jugar " + cardName(h.mine.find((c) => c.id === chosen)), onclick: () => play(chosen) }));
    box.replaceChildren(...buttons);
    const hasPartner = st.size === 4;
    $("signs").classList.toggle("hide", !hasPartner || h.ended);
    if (hasPartner && !$("signs").children.length) {
      $("signs").append(...SIGNS.filter(([e]) => e !== "👌").map(([e, t]) => el("button", { type: "button", textContent: e, ariaLabel: "Seña: " + t, onclick: () => { net.send({ action: "sign", kind: e }); toast("Seña enviada " + e); sound("tick"); } })));
    }
    const tip = $("ticker");
    if (h.ended) tip.textContent = st.over ? "" : "Enseguida se reparte la próxima mano…";
    else if (h.actions.includes("play")) tip.innerHTML = chosen !== null ? "Tocá de nuevo la carta (o arrastrala a la mesa) para jugarla." : "Tocá una carta para elegirla." + (h.actions.includes("truco") ? " También podés cantar." : "");
    else if (h.actions.includes("paraguayana")) tip.innerHTML = "🇵🇾 <b>Tenés paraguayana</b>: tres cartas malas de distinto palo. Podés pedir que se reparta de nuevo.";
    else tip.textContent = "";
  }

  // ---------- Acciones ----------
  function play(id) {
    if (!st.hand.actions.includes("play")) return toast(st.hand.pending ? "Primero hay que contestar el canto" : "Esperá tu turno");
    chosen = null;
    net.send({ action: "play", id });
  }
  let drag = null, lastDrag = 0;
  function bindDrag(b, c) {
    b.onclick = () => {
      if (Date.now() - lastDrag < 300) return;
      if (chosen === c.id && st.hand.actions.includes("play")) { play(c.id); return; }
      chosen = chosen === c.id ? null : c.id;
      sound("tick");
      renderHand();
      renderActions();
    };
    b.onpointerdown = (e) => { drag = { id: c.id, x: e.clientX, y: e.clientY, moved: false }; b.setPointerCapture(e.pointerId); };
    b.onpointermove = (e) => {
      if (!drag || drag.id !== c.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
      drag.moved = true;
      b.classList.add("dragging");
      b.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    };
    b.onpointerup = (e) => {
      if (!drag || drag.id !== c.id) return;
      const moved = drag.moved, dy = e.clientY - drag.y;
      drag = null;
      b.classList.remove("dragging");
      b.style.transform = "";
      if (!moved) return;
      lastDrag = Date.now();
      if (dy < -70) { if (st.hand.actions.includes("play")) play(c.id); else toast(st.hand.pending ? "Primero hay que contestar el canto" : "Esperá tu turno"); }
    };
    b.onpointercancel = () => { drag = null; b.classList.remove("dragging"); b.style.transform = ""; };
  }

  // ---------- Sala y final ----------
  function renderLobby() {
    $("lobbyCode").textContent = st.code;
    const seatEl = (s) => {
      const n = st.names[s];
      return el("div", { className: "seat" + (n ? " filled" : "") + (st.bots[s] ? " bot" : ""), textContent: n ? (s === seat ? "🙋 " + n + " (vos)" : (st.bots[s] ? "" : "👤 ") + n) : "⏳ Lugar libre" });
    };
    const us = [], them = [];
    for (let s = 0; s < st.size; s++) (isUs(s) ? us : them).push(seatEl(s));
    $("teamUs").replaceChildren(...us);
    $("teamThem").replaceChildren(...them);
    $("wa").href = SDL.whatsapp(inviteUrl(), inviteText);
    const missing = st.names.filter((n) => !n).length;
    $("start").disabled = seat !== 0;
    $("start").classList.toggle("hide", seat !== 0);
    $("start").textContent = missing ? `Empezar (la compu ocupa ${missing === 1 ? "el lugar libre" : "los " + missing + " lugares libres"})` : "Empezar partida";
    const rules = `A ${st.target}${st.opts.flor ? ", con flor" : ", sin flor"}${st.opts.paraguayana ? ", con paraguayana" : ""}.`;
    $("startHint").textContent = seat !== 0 ? `${rules} Esperando a que ${st.names[0]} reparta…` : missing ? `${rules} Mandá el enlace; si falta gente, la compu completa.` : `${rules} ¡Están todos! Repartí cuando quieras.`;
    const humans = st.names.filter((n, i) => n && !st.bots[i]).length;
    if (humans > 1 && seat === 0 && !lobbyChimed) { lobbyChimed = true; sound("win"); toast("Llegó gente a la mesa 🎉", "good"); }
  }

  function openResult() {
    const key = st.code + ":" + st.wins.join(",");
    if (resultShown === key) return;
    resultShown = key;
    const won = st.winner === myTeam();
    $("resEmoji").textContent = won ? "🏆" : "💪";
    $("resTitle").textContent = won ? "¡Ganamos la partida!" : "Ganaron ellos";
    $("resSub").textContent = `${st.scores[myTeam()]} a ${st.scores[1 - myTeam()]}.` + (st.wins[0] + st.wins[1] > 1 ? ` Serie: nosotros ${st.wins[myTeam()]} – ${st.wins[1 - myTeam()]} ellos.` : "");
    $("series").replaceChildren(
      el("div", {}, el("b", { textContent: st.scores[myTeam()] }), "Nosotros"),
      el("div", {}, el("b", { textContent: st.scores[1 - myTeam()] }), "Ellos"),
    );
    $("newmatch").classList.toggle("hide", seat !== 0 && st.names.every((n, i) => !st.bots[i] || i === 0) && false);
    $("result").classList.remove("hide");
    SDL.bump("truco.played", "tr:" + key);
    if (won) { SDL.bump("truco.won"); SDL.confetti(); sound("win"); }
  }
})();
