// Chinchón: mesa, mano y resultado de cada ronda.
(() => {
  const { $, el, store, session, toast, sound, buzz } = SDL;
  const SUITS = ["Oros", "Copas", "Espadas", "Bastos"];
  const ICONS = ["🪙", "🍷", "🗡️", "🪵"];
  const FIG = { 10: "Sota", 11: "Caballo", 12: "Rey" };
  const cardName = (c) => (FIG[c.n] ? FIG[c.n].toLowerCase() : c.n) + " de " + SUITS[c.s].toLowerCase();

  $("name").value = store.get("name", "");
  $("name").addEventListener("input", () => store.set("name", $("name").value.trim()));
  SDL.soundToggle($("sound"));
  const prefs = store.get("chinchonPrefs", { mode: "bot", target: "100" });
  const savePrefs = () => store.set("chinchonPrefs", { mode: mode.value, target: target.value });
  const mode = SDL.choiceGroup($("modeChoices"), prefs.mode, () => { paintSetup(); savePrefs(); });
  const target = SDL.choiceGroup($("targetChoices"), prefs.target, savePrefs);
  function paintSetup() { $("go").textContent = mode.value === "bot" ? "▶ Jugar contra la compu" : "✨ Crear sala e invitar"; }
  paintSetup();
  const playerName = () => $("name").value.trim() || store.get("name", "");

  // ---------- Conexión ----------
  let st = null, seat = -1, pending = null, order = [], chosen = null, sortMode = store.get("chinchonSort", "jugadas");
  const rejoin = session.get("chinchonRoom");
  const net = SDL.connect("/cards", {
    onOpen() {
      if (pending) { net.send(pending); pending = null; }
      else if (session.get("chinchonRoom")) net.send({ action: "join", code: session.get("chinchonRoom"), token: SDL.token, name: playerName() });
    },
    onMessage(m) {
      if (m.type === "error") {
        toast(m.message, "bad");
        sound("bad");
        if (!st) { session.set("chinchonRoom", null); show("setup"); }
      } else if (m.type === "cardJoined") {
        seat = m.seat;
        session.set("chinchonRoom", m.code);
        history.replaceState(null, "", "/chinchon?sala=" + m.code);
      } else if (m.type === "cardEvent" && m.kind === "arrange") {
        const o = $("opp");
        o.classList.remove("sorting"); void o.offsetWidth; o.classList.add("sorting");
      } else if (m.type === "cardState") {
        const old = st;
        st = m.state;
        syncOrder(old);
        react(old);
        render();
      }
    },
  });
  const request = (msg) => { if (!net.send(msg)) pending = msg; };

  $("go").onclick = () => {
    if (!playerName()) { toast("Primero escribí tu nombre ✍️", "bad"); $("name").focus(); return; }
    request({ action: mode.value, name: playerName(), token: SDL.token, target: +target.value });
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
    setTimeout(() => toast("Te invitaron a un chinchón 💌 Tocá «Unirme»"), 300);
  }
  if (rejoin) show("game");

  function show(view) { for (const v of ["setup", "lobby", "game"]) $(v).classList.toggle("hide", v !== view); }
  const inviteUrl = () => location.origin + "/chinchon?sala=" + st.code;
  const inviteText = "¿Un chinchón? 🃏 Entrá acá:";
  $("copy").onclick = () => SDL.copy(inviteUrl());
  $("shareBtn").onclick = () => SDL.share(inviteUrl(), inviteText);
  $("start").onclick = () => net.send({ action: "start" });
  $("next").onclick = () => { closeResult(); net.send({ action: "next" }); };
  $("newmatch").onclick = () => { closeResult(); net.send({ action: "newmatch" }); };
  $("closeRes").onclick = closeResult;

  // ---------- Orden de la mano ----------
  const byId = (id) => st.hand.find((c) => c.id === id);
  function syncOrder(old) {
    const ids = st.hand.map((c) => c.id);
    const fresh = !old || old.round !== st.round || old.code !== st.code;
    order = fresh ? [] : order.filter((id) => ids.includes(id));
    for (const id of ids) if (!order.includes(id)) order.push(id);
    if (fresh) applySort(false);
    if (chosen !== null && !ids.includes(chosen)) chosen = null;
  }
  function applySort(notify = true) {
    const cards = order.map(byId);
    if (sortMode === "palo") cards.sort((a, b) => a.s - b.s || a.n - b.n);
    else if (sortMode === "numero") cards.sort((a, b) => a.n - b.n || a.s - b.s);
    else {
      const meldOf = new Map();
      st.melds.forEach((m, i) => m.forEach((id) => meldOf.set(id, i)));
      cards.sort((a, b) => (meldOf.get(a.id) ?? 99) - (meldOf.get(b.id) ?? 99) || a.s - b.s || a.n - b.n);
    }
    order = cards.map((c) => c.id);
    if (notify) net.send({ action: "arrange" });
  }
  const SORT_LABEL = { jugadas: "jugadas", palo: "palo", numero: "número" };
  $("sort").onclick = () => {
    sortMode = { jugadas: "palo", palo: "numero", numero: "jugadas" }[sortMode];
    store.set("chinchonSort", sortMode);
    applySort();
    toast("Ordenadas por " + SORT_LABEL[sortMode]);
    render();
  };

  // ---------- Reacciones a lo que pasa en la mesa ----------
  let lastSeq = 0, shownResult = null;
  function react(old) {
    const ev = st.event;
    if (!ev || ev.seq === lastSeq) return;
    const firstState = lastSeq === 0;
    lastSeq = ev.seq;
    if (firstState) return;
    const opp = st.names[1 - seat];
    if (ev.kind === "deal") { animate("dealing"); sound("card"); }
    if (ev.kind === "draw") {
      sound("card");
      if (ev.seat !== seat) note(ev.from === "pile" && old?.top ? `${opp} levantó el ${cardName(old.top)} del pozo` : `${opp} robó del mazo`);
    }
    if (ev.kind === "discard") {
      sound("card");
      if (ev.seat !== seat && st.top) note(`${opp} tiró el ${cardName(st.top)}`);
      if (st.turn === seat && !st.ended) { sound("turn"); buzz(30); }
    }
    if (ev.kind === "cut" || ev.kind === "chinchon") { sound(ev.kind === "chinchon" ? "win" : "ok"); buzz(60); }
  }
  let noteTimer;
  function note(text) { $("note").textContent = text; clearTimeout(noteTimer); noteTimer = setTimeout(() => ($("note").textContent = ""), 3500); }
  function animate(cls) { const t = $("table"); t.classList.remove(cls); void t.offsetWidth; t.classList.add(cls); setTimeout(() => t.classList.remove(cls), 900); }

  // ---------- Dibujo ----------
  function cardEl(c, tag = "div") {
    const node = el(tag, { className: "card s" + c.s });
    if (tag === "button") node.type = "button";
    node.setAttribute("aria-label", cardName(c));
    node.append(el("span", { className: "n", textContent: c.n }), el("span", { className: "s", textContent: ICONS[c.s] }), el("span", { className: "n2", textContent: c.n }));
    if (FIG[c.n]) node.append(el("span", { className: "f", textContent: FIG[c.n] }));
    return node;
  }

  function render() {
    if (!st) return;
    if (!st.started) { renderLobby(); show("lobby"); return; }
    show("game");
    const mine = st.turn === seat && !st.ended;
    const opp = 1 - seat;

    // Marcador
    for (const i of [0, 1]) {
      const box = $("ps" + i), who = i === 0 ? seat : opp;
      box.className = "ps" + (st.turn === who && !st.ended ? " turn" : "");
      const pct = Math.min(100, Math.max(0, st.scores[who] / st.target * 100));
      box.replaceChildren(
        el("div", { className: "who" }, el("span", { className: "dot" + (st.online[who] ? " on" : "") }), (who === seat ? "Vos" : st.names[who] || "Rival") + (st.wins[who] ? "  🏆" + st.wins[who] : "")),
        el("div", { className: "pts" }, el("strong", { textContent: st.scores[who] }), el("span", { className: "muted small", textContent: "de " + st.target })),
        el("div", { className: "meter" }, el("div", { style: `width:${pct}%;background-position:${pct}% 0` })),
      );
    }

    // Rival
    $("oppName").textContent = st.names[opp] || "Rival";
    $("oppDot").classList.toggle("on", !!st.online[opp]);
    const backs = $("oppHand");
    backs.replaceChildren(...Array.from({ length: st.oppCount }, (_, i) => el("div", { className: "cback", style: `--r:${(i - (st.oppCount - 1) / 2) * 6}deg` })));

    // Mazo y pozo
    const canDraw = mine && st.phase === "draw";
    $("deckCount").textContent = st.deck;
    $("deck").disabled = $("pile").disabled = !canDraw;
    $("deck").classList.toggle("glow", canDraw);
    const pile = $("pile");
    const top = st.top ? cardEl(st.top) : el("div", { className: "card empty" });
    if (lastTop !== st.top?.id) { top.classList.add("drop"); lastTop = st.top?.id; }
    pile.replaceChildren(top);
    pile.classList.toggle("glow", canDraw);

    $("status").textContent = st.ended ? "Ronda terminada" : mine ? (st.phase === "draw" ? "🟢 Tu turno: robá del mazo o del pozo" : "🟢 Tirá una carta (o cortá)") : "⏳ Juega " + (st.names[st.turn] || "el rival") + "…";
    $("status").classList.toggle("mine", mine);

    renderHand(mine);
    renderControls(mine);
    if (st.ended) openResult(false);
  }
  let lastTop = null;

  function renderLobby() {
    $("lobbyCode").textContent = st.code;
    for (const i of [0, 1]) {
      const n = st.names[i];
      $("seat" + i).classList.toggle("filled", !!n);
      $("seat" + i).textContent = n ? (i === seat ? "🙋 " + n + " (vos)" : "👤 " + n) : "⏳ Esperando…";
    }
    $("wa").href = SDL.whatsapp(inviteUrl(), inviteText);
    $("start").disabled = seat !== 0 || !st.names[1];
    $("start").classList.toggle("hide", seat !== 0);
    $("startHint").textContent = seat !== 0 ? `Esperando a que ${st.names[0]} reparta…` : st.names[1] ? "¡Ya están los dos! Repartí cuando quieras." : `Partida a ${st.target} puntos. Mandale el enlace a tu pareja.`;
    if (st.names[1] && seat === 0 && !renderLobby.chimed) { renderLobby.chimed = true; sound("win"); toast(st.names[1] + " llegó a la mesa 🎉", "good"); }
  }

  const optionFor = (id) => st.options.find((o) => o.id === id);
  function renderHand(mine) {
    const meldOf = new Map();
    st.melds.forEach((m, i) => m.forEach((id) => meldOf.set(id, i % 3)));
    const hand = $("hand");
    const cards = order.map(byId).filter(Boolean);
    const prevIds = new Set([...hand.children].map((x) => +x.dataset.id));
    hand.replaceChildren(...cards.map((c, ix) => {
      const b = cardEl(c, "button");
      b.dataset.id = c.id;
      b.style.setProperty("--r", (ix - (cards.length - 1) / 2) * 3.2 + "deg");
      if (chosen === c.id) b.classList.add("sel");
      if (meldOf.has(c.id)) b.classList.add("m" + meldOf.get(c.id));
      if (prevIds.size && !prevIds.has(c.id)) b.classList.add("new");
      const o = optionFor(c.id);
      if (o?.blocked) { b.classList.add("blocked"); b.append(el("span", { className: "tag pozo", textContent: "del pozo" })); }
      else if (o && (o.chinchon || o.points <= 5)) b.append(el("span", { className: "tag", textContent: o.chinchon ? "¡Chinchón!" : "✂️ " + (o.points === 0 ? "−10" : o.points) }));
      bindDrag(b, c);
      return b;
    }));
  }

  function bestCut() {
    return st.options.filter((o) => !o.blocked && (o.chinchon || o.points <= 5)).sort((a, b) => (b.chinchon - a.chinchon) || a.points - b.points)[0];
  }
  function renderControls(mine) {
    const discarding = mine && st.phase === "discard";
    const sel = chosen !== null ? optionFor(chosen) : null;
    $("discard").disabled = !discarding || !sel || sel.blocked;
    const cut = discarding ? bestCut() : null;
    $("cut").disabled = !cut;
    $("cut").classList.toggle("glow", !!cut);
    $("sort").textContent = "↕️ Por " + SORT_LABEL[sortMode];
    const tip = $("tip");
    if (st.ended) tip.replaceChildren(el("button", { className: "btn sm", type: "button", textContent: "📊 Ver resultado", onclick: () => openResult(true) }));
    else if (cut) tip.innerHTML = cut.chinchon ? "🤩 <b>¡Tenés chinchón!</b> Tirá la carta marcada y cortá." : `✂️ <b>¡Podés cortar!</b> Tirando el ${cardName(byId(cut.id))} te quedan ${cut.points === 0 ? "todas ligadas (−10)" : cut.points + " sueltos"}.`;
    else if (discarding) tip.innerHTML = sel ? `Tirar el <b>${cardName(byId(chosen))}</b>: arrastralo al pozo o tocá «Tirar».` : "Tocá una carta para elegirla, o arrastrala al pozo.";
    else tip.innerHTML = `Puntos sueltos en tu mano: <b>${st.points}</b>`;
  }

  // ---------- Acciones ----------
  $("deck").onclick = () => net.send({ action: "draw", from: "deck" });
  $("pile").onclick = () => net.send({ action: "draw", from: "pile" });
  function discard(id) {
    const o = optionFor(id);
    if (!o) return toast("Primero robá una carta", "bad");
    if (o.blocked) return toast("No podés tirar la carta que levantaste del pozo", "bad");
    chosen = null;
    net.send({ action: "discard", id });
  }
  $("discard").onclick = () => chosen !== null && discard(chosen);
  $("cut").onclick = () => {
    const sel = chosen !== null ? optionFor(chosen) : null;
    const pick = sel && !sel.blocked && (sel.chinchon || sel.points <= 5) ? sel : bestCut();
    if (!pick) return;
    chosen = null;
    net.send({ action: "close", id: pick.id });
  };

  // Tocar para elegir, arrastrar para reordenar o tirar al pozo.
  let drag = null, lastDrag = 0;
  function overPile(x, y) {
    const r = $("pile").getBoundingClientRect();
    return x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 20 && y <= r.bottom + 20;
  }
  function bindDrag(b, c) {
    b.onclick = () => {
      if (Date.now() - lastDrag < 300) return;
      chosen = chosen === c.id ? null : c.id;
      sound("tick");
      render();
    };
    b.onpointerdown = (e) => {
      drag = { id: c.id, x: e.clientX, y: e.clientY, moved: false };
      b.setPointerCapture(e.pointerId);
    };
    b.onpointermove = (e) => {
      if (!drag || drag.id !== c.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
      drag.moved = true;
      b.classList.add("dragging");
      b.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
      const over = overPile(e.clientX, e.clientY);
      const ok = st.turn === seat && st.phase === "discard" && !st.ended && !optionFor(c.id)?.blocked;
      $("pile").classList.toggle("drop-ready", over && ok);
      $("pile").classList.toggle("drop-blocked", over && !ok);
    };
    b.onpointerup = (e) => {
      if (!drag || drag.id !== c.id) return;
      const moved = drag.moved;
      drag = null;
      $("pile").classList.remove("drop-ready", "drop-blocked");
      if (!moved) return;
      lastDrag = Date.now();
      if (overPile(e.clientX, e.clientY)) {
        if (st.turn === seat && st.phase === "discard" && !st.ended) discard(c.id);
        else toast(st.turn === seat ? "Primero robá una carta" : "Esperá tu turno");
        render();
        return;
      }
      const others = [...$("hand").children].filter((x) => x !== b);
      let to = others.findIndex((x) => { const r = x.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
      if (to < 0) to = others.length;
      order.splice(order.indexOf(c.id), 1);
      order.splice(to, 0, c.id);
      net.send({ action: "arrange" });
      render();
    };
    b.onpointercancel = () => { drag = null; render(); };
  }

  // ---------- Resultado de la ronda ----------
  function openResult(force) {
    const key = st.code + ":" + st.round + ":" + st.scores.join(",");
    if (!force && shownResult === key) return;
    const first = shownResult !== key;
    shownResult = key;
    const r = st.result, closer = r.closer, me = closer === seat;
    $("resEmoji").textContent = r.chinchon ? "🤩" : st.over ? (st.winner === seat ? "🏆" : "💪") : "✂️";
    $("resTitle").textContent = r.chinchon ? `¡CHINCHÓN de ${me ? "vos" : st.names[closer]}!` : st.over ? (st.winner === seat ? "¡Ganaste la partida!" : `Ganó ${st.names[st.winner]}`) : (me ? "Cortaste" : `${st.names[closer]} cortó`);
    $("resSub").textContent = r.chinchon ? "Siete cartas seguidas del mismo palo: partida ganada." : st.over ? `Alguien llegó a ${st.target} puntos.` + (st.wins[0] + st.wins[1] ? ` Serie: ${st.names[0]} ${st.wins[0]} – ${st.wins[1]} ${st.names[1]}` : "") : r.gains[closer] < 0 ? "¡Con todas ligadas: menos diez!" : "";
    const reveal = $("reveal");
    reveal.replaceChildren(...[seat, 1 - seat].map((i) => {
      const a = r.arrangements[i];
      const g = r.gains[i];
      return el("div", {},
        el("div", { className: "who" }, el("span", { textContent: (i === seat ? "Vos" : st.names[i]) + (i === closer ? " ✂️" : "") }), el("span", { textContent: (g > 0 ? "+" : "") + g + " pts" })),
        el("div", { className: "groups" },
          ...a.melds.map((m) => el("div", { className: "group" }, ...m.map((c) => cardEl(c)))),
          ...(a.loose.length ? [el("div", { className: "group loose" }, ...a.loose.map((c) => cardEl(c)))] : []),
        ));
    }));
    $("totals").replaceChildren(...[seat, 1 - seat].map((i) => el("div", {}, el("b", { textContent: st.scores[i] }), i === seat ? "Vos" : st.names[i])));
    $("next").classList.toggle("hide", st.over);
    $("newmatch").classList.toggle("hide", !st.over);
    $("result").classList.remove("hide");
    if (first && st.over) {
      SDL.bump("chinchon.played", "ch:" + key);
      if (st.winner === seat) { SDL.bump("chinchon.won"); SDL.confetti(); sound("win"); }
    }
  }
  function closeResult() { $("result").classList.add("hide"); }
})();
