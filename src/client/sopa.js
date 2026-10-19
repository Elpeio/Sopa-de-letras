// Sopa de Letras: configuración, sala de espera y tablero.
(() => {
  const { $, el, store, session, toast, sound, buzz } = SDL;
  const CATS = window.CATEGORIES;
  const catLabel = (key) => { const c = CATS.find((x) => x.key === key); return c ? c.emoji + " " + c.label : key; };

  // ---------- Configuración ----------
  const prefs = store.get("sopaPrefs", { mode: "turnos", size: "12", category: "Mezclados", seconds: "30" });
  $("name").value = store.get("name", "");
  $("name").addEventListener("input", () => store.set("name", $("name").value.trim()));
  SDL.soundToggle($("sound"));

  $("catChoices").append(...CATS.map((c) => el("button", { type: "button", className: "choice", innerHTML: `<span>${c.emoji} ${c.label}</span>` , dataset: { value: c.key } })));
  const savePrefs = () => store.set("sopaPrefs", { mode: mode.value, size: size.value, category: cat.value, seconds: secs.value });
  const mode = SDL.choiceGroup($("modeChoices"), prefs.mode, () => { paintSetup(); savePrefs(); });
  const size = SDL.choiceGroup($("sizeChoices"), prefs.size, savePrefs);
  const cat = SDL.choiceGroup($("catChoices"), prefs.category, savePrefs);
  const secs = SDL.choiceGroup($("timeChoices"), prefs.seconds, savePrefs);
  function paintSetup() {
    $("timeBlock").classList.toggle("hide", mode.value !== "turnos");
    $("create").textContent = mode.value === "solo" ? "▶ Empezar a jugar" : "✨ Crear sala e invitar";
  }
  paintSetup();

  const playerName = () => $("name").value.trim() || store.get("name", "") || "";
  function needName() {
    if (playerName()) return false;
    toast("Primero escribí tu nombre ✍️", "bad");
    $("name").focus();
    return true;
  }

  // ---------- Conexión ----------
  let room = null, seat = -1, offset = 0, pending = null;
  const rejoinCode = session.get("sopaRoom");
  const net = SDL.connect("/ws", {
    onOpen() {
      if (pending) { net.send(pending); pending = null; }
      else if (session.get("sopaRoom")) net.send({ action: "join", code: session.get("sopaRoom"), token: SDL.token, name: playerName() });
    },
    onMessage(m) {
      if (m.type === "error") {
        toast(m.message, "bad");
        if (!room) { session.set("sopaRoom", null); show("setup"); }
      } else if (m.type === "joined") {
        seat = m.seat;
        session.set("sopaRoom", m.code);
        history.replaceState(null, "", "/sopa?sala=" + m.code);
      } else if (m.type === "state") {
        room = m.room;
        offset = room.now - Date.now();
        render();
      } else if (m.type === "mark") {
        if (m.ok) { sound("ok"); buzz(25); }
        else {
          sound("bad"); buzz([20, 40, 20]);
          $("board").classList.remove("shake"); void $("board").offsetWidth; $("board").classList.add("shake");
          if (m.reason === "turn") toast("Ahora no es tu turno");
        }
      }
    },
  });
  function request(msg) { if (!net.send(msg)) pending = msg; }

  $("create").onclick = () => {
    if (needName()) return;
    request({ action: "create", name: playerName(), token: SDL.token, mode: mode.value, size: +size.value, category: cat.value, seconds: +secs.value });
  };
  $("join").onclick = () => {
    const code = $("code").value.trim().toUpperCase();
    if (!code) { toast("Escribí el código de la sala", "bad"); $("code").focus(); return; }
    if (needName()) return;
    request({ action: "join", code, name: playerName(), token: SDL.token });
  };
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("join").click(); });

  const incoming = new URLSearchParams(location.search).get("sala");
  if (incoming && incoming.toUpperCase() !== rejoinCode) {
    $("code").value = incoming.toUpperCase();
    setTimeout(() => toast(playerName() ? "Te invitaron 💌 Tocá «Unirme»" : "Te invitaron 💌 Escribí tu nombre y tocá «Unirme»"), 300);
    if (!playerName()) $("name").focus();
  }
  if (rejoinCode) show("game");

  // ---------- Vistas ----------
  function show(view) {
    for (const v of ["setup", "lobby", "game"]) $(v).classList.toggle("hide", v !== view);
    $("shareTop").classList.toggle("hide", view !== "game" || !room || room.mode === "solo");
  }
  const inviteUrl = () => location.origin + "/sopa?sala=" + room.code;
  const inviteText = () => "¡Te desafío a una Sopa de Letras! 🔎 Entrá acá:";
  $("copy").onclick = () => SDL.copy(inviteUrl());
  $("shareBtn").onclick = $("shareTop").onclick = () => SDL.share(inviteUrl(), inviteText());
  $("begin").onclick = () => net.send({ action: "begin" });
  $("pass").onclick = () => net.send({ action: "pass" });
  $("hint").onclick = () => net.send({ action: "hint" });
  $("giveup").onclick = () => {
    if (confirm(room.mode === "solo" ? "¿Terminar y ver dónde estaban las palabras?" : "¿Terminar la partida ahora?")) net.send({ action: "giveup" });
  };
  $("rematch").onclick = () => { closeEnding(); net.send({ action: "rematch" }); };
  $("seeBoard").onclick = closeEnding;
  $("newSetup").onclick = () => { session.set("sopaRoom", null); };

  // Botones que aparecen al terminar, debajo del tablero.
  const again = el("button", { className: "btn primary", type: "button", textContent: "🔁 Revancha", onclick: () => net.send({ action: "rematch" }) });
  const results = el("button", { className: "btn", type: "button", textContent: "📊 Resultado", onclick: () => openEnding(true) });
  $("gameActions").append(again, results);

  let shownEndFor = null, lastFound = {}, lastTurnKey = "", sig = "";

  function render() {
    if (!room) return;
    const duo = room.mode !== "solo";
    if (room.status === "waiting") { renderLobby(); show("lobby"); return; }
    show("game");
    buildBoard();
    renderLines();
    renderWords();

    for (const i of [0, 1]) {
      $("nm" + i).textContent = room.players[i] || (i ? "Esperando…" : "");
      $("pt" + i).textContent = room.scores[i];
      $("on" + i).classList.toggle("on", !!room.online[i]);
      $("w" + i).textContent = duo && room.wins[0] + room.wins[1] > 0 ? "🏆 " + room.wins[i] : "";
    }
    $("sc1").classList.toggle("hide", !duo);
    document.querySelector(".hud").classList.toggle("solo", !duo);
    $("pt0").textContent = duo ? room.scores[0] : Object.keys(room.found).length + "/" + room.words.length;
    $("catName").textContent = catLabel(room.category);
    const playing = room.status === "playing";
    $("pass").classList.toggle("hide", !(playing && room.mode === "turnos"));
    $("pass").disabled = room.turn !== seat;
    $("hint").classList.toggle("hide", !(playing && room.mode === "solo"));
    $("giveup").classList.toggle("hide", !(playing && (room.mode === "solo" || seat === 0)));
    again.classList.toggle("hide", playing);
    results.classList.toggle("hide", playing);

    // Avisos de lo que hizo la otra persona.
    for (const [word, f] of Object.entries(room.found)) {
      if (!lastFound[word] && f.seat !== seat) {
        toast(`${room.players[f.seat]} encontró ${word}`);
        sound("tick");
      }
    }
    lastFound = { ...room.found };
    tick();

    if (room.status === "ended") openEnding(false);
  }

  function renderLobby() {
    $("lobbyCode").textContent = room.code;
    $("lobbyInfo").textContent = (room.mode === "turnos" ? `Por turnos de ${room.turnLength} s` : "Carrera simultánea") + " · " + catLabel(room.category) + " · " + room.size + "×" + room.size;
    for (const i of [0, 1]) {
      const name = room.players[i];
      $("seat" + i).classList.toggle("filled", !!name);
      $("seat" + i).textContent = name ? (i === seat ? "🙋 " : "👤 ") + name + (i === seat ? " (vos)" : "") : "⏳ Esperando…";
    }
    $("wa").href = SDL.whatsapp(inviteUrl(), inviteText());
    $("begin").disabled = seat !== 0 || !room.players[1];
    $("begin").classList.toggle("hide", seat !== 0);
    $("beginHint").textContent = seat !== 0 ? `Esperando a que ${room.players[0]} empiece la partida…` : room.players[1] ? "¡Ya están los dos! Cuando quieras, empezá." : "Mandale el enlace a tu pareja. Apenas entre, vas a poder empezar.";
    if (room.players[1] && seat === 0 && !renderLobby.chimed) { renderLobby.chimed = true; sound("win"); toast(room.players[1] + " entró a la sala 🎉", "good"); }
  }

  // ---------- Tablero ----------
  const sigOf = () => room.code + room.round + room.grid.map((r) => r.join("")).join("");
  function buildBoard() {
    const s = sigOf();
    if (s === sig) return;
    const fresh = sig !== "";
    sig = s;
    lastFound = { ...room.found };
    const b = $("board");
    b.innerHTML = "";
    b.style.gridTemplateColumns = `repeat(${room.size}, 1fr)`;
    room.grid.forEach((row, r) => row.forEach((letter, c) => b.append(el("div", { className: "cell", textContent: letter, dataset: { r, c } }))));
    $("lines").setAttribute("viewBox", `0 0 ${room.size} ${room.size}`);
    fitFont();
    if (fresh) { shownEndFor = null; sound("turn"); }
  }
  function fitFont() {
    if (!room) return;
    const w = $("board").clientWidth;
    $("board").style.setProperty("--fs", Math.max(11, (w / room.size) * 0.56) + "px");
  }
  new ResizeObserver(fitFont).observe($("board"));

  const svgNS = "http://www.w3.org/2000/svg";
  function line(cells, cls, width = 0.78) {
    const [a, b] = [cells[0], cells.at(-1)];
    const l = document.createElementNS(svgNS, "line");
    l.setAttribute("x1", a[1] + 0.5); l.setAttribute("y1", a[0] + 0.5);
    l.setAttribute("x2", b[1] + 0.5); l.setAttribute("y2", b[0] + 0.5);
    l.setAttribute("stroke-width", width);
    l.setAttribute("class", cls);
    return l;
  }
  function renderLines() {
    const svg = $("lines");
    svg.replaceChildren();
    for (const [word, f] of Object.entries(room.found)) svg.append(line(f.cells, "l" + f.seat + (lastFound[word] ? "" : " lnew")));
    for (const p of room.missing) svg.append(line(p.cells, "lmiss"));
    if (selection.length) svg.append(line(selection, "lsel", 0.86));
    $("board").querySelectorAll(".hint").forEach((x) => x.classList.remove("hint"));
    for (const [r, c] of room.status === "playing" ? room.hints : []) {
      const stillHidden = !Object.values(room.found).some((f) => f.cells.some(([y, x]) => y === r && x === c));
      if (stillHidden) cellAt(r, c)?.classList.add("hint");
    }
    $("board").querySelectorAll(".anchor").forEach((x) => x.classList.remove("anchor"));
    if (anchor) cellAt(...anchor)?.classList.add("anchor");
  }
  const cellAt = (r, c) => $("board").children[r * room.size + c];

  function renderWords() {
    const box = $("words");
    box.replaceChildren(...room.words.map((w) => {
      const f = room.found[w];
      const miss = room.missing.some((p) => p.word === w);
      return el("span", { className: "word" + (f ? " f" + f.seat : "") + (miss ? " miss" : "") + (f && !lastFound[w] ? " pop" : ""), textContent: w });
    }));
    $("progress").textContent = Object.keys(room.found).length + " / " + room.words.length;
  }

  // ---------- Reloj ----------
  const now = () => Date.now() + offset;
  function tick() {
    if (!room || room.status === "waiting") return;
    const clock = $("clock"), bar = $("bar");
    clock.classList.remove("low");
    const foundPct = Object.keys(room.found).length / Math.max(1, room.words.length) * 100;
    if (room.mode === "turnos" && room.status === "playing") {
      const left = Math.max(0, Math.ceil((room.deadline - now()) / 1000));
      clock.textContent = left + " s";
      clock.classList.toggle("low", left <= 5);
      $("clockLbl").textContent = "del turno";
      bar.style.width = (left / room.turnLength) * 100 + "%";
      const mine = room.turn === seat;
      $("turnMsg").textContent = mine ? "🟢 ¡Tu turno! Encontrá todas las que puedas" : "⏳ Turno de " + room.players[room.turn];
      $("turnMsg").classList.toggle("mine", mine);
      $("board").classList.toggle("waiting", !mine);
      for (const i of [0, 1]) $("sc" + i).classList.toggle("current", room.turn === i);
      const key = room.round + ":" + room.deadline;
      if (key !== lastTurnKey) { lastTurnKey = key; if (mine) { sound("turn"); buzz(40); } }
    } else {
      const end = room.status === "ended" ? room.endedAt : now();
      clock.textContent = SDL.fmtTime(end - room.startedAt + room.penalty * 1000);
      $("clockLbl").textContent = room.penalty ? `incluye +${room.penalty} s de pistas` : "tiempo";
      bar.style.width = foundPct + "%";
      const best = store.get("sopaBest", {})[room.size];
      $("turnMsg").textContent = room.status === "ended" ? "Partida terminada" : room.mode === "carrera" ? "⚡ ¡A buscar los dos a la vez! Suma quien la marca primero" : best ? `Tu récord en ${room.size}×${room.size}: ${SDL.fmtTime(best)}` : "¡A buscar!";
      $("turnMsg").classList.remove("mine");
      $("board").classList.remove("waiting");
      for (const i of [0, 1]) $("sc" + i).classList.remove("current");
    }
    if (room.status === "ended") $("turnMsg").textContent = "Partida terminada";
  }
  setInterval(tick, 250);

  // ---------- Selección con el dedo / mouse ----------
  let selection = [], start = null, moved = false, anchor = null, warned = 0;
  const canPlay = () => room && room.status === "playing" && (room.mode !== "turnos" || room.turn === seat);
  function cellFromEvent(e) {
    const b = $("board"), rect = b.getBoundingClientRect(), pad = parseFloat(getComputedStyle(b).paddingLeft) || 0;
    const step = (rect.width - pad * 2) / room.size;
    const clamp = (v) => Math.max(0, Math.min(room.size - 1, v));
    return [clamp(Math.floor((e.clientY - rect.top - pad) / step)), clamp(Math.floor((e.clientX - rect.left - pad) / step))];
  }
  /** Línea recta desde a hacia b, ajustada a la dirección más cercana (8 posibles). */
  function snap(a, b) {
    const dr = b[0] - a[0], dc = b[1] - a[1];
    if (!dr && !dc) return [a];
    const ang = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
    const sr = Math.round(Math.sin(ang * Math.PI / 4)), sc = Math.round(Math.cos(ang * Math.PI / 4));
    let len = Math.round((dr * sr + dc * sc) / (sr * sr + sc * sc));
    const cells = [];
    for (let i = 0; i <= len; i++) {
      const r = a[0] + sr * i, c = a[1] + sc * i;
      if (r < 0 || c < 0 || r >= room.size || c >= room.size) break;
      cells.push([r, c]);
    }
    return cells;
  }
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  function setSelection(cells) {
    selection = cells;
    $("board").querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
    cells.forEach(([r, c]) => cellAt(r, c)?.classList.add("sel"));
    renderLines();
  }
  function submit(cells) {
    setSelection([]);
    if (cells.length >= 2) net.send({ action: "mark", cells });
  }
  const board = $("board");
  board.addEventListener("pointerdown", (e) => {
    if (!room) return;
    if (!canPlay()) {
      if (room.status === "playing" && Date.now() - warned > 2000) { warned = Date.now(); toast("Esperá tu turno ⏳"); }
      return;
    }
    e.preventDefault();
    board.setPointerCapture(e.pointerId);
    start = cellFromEvent(e);
    moved = false;
    setSelection(anchor ? snap(anchor, start) : [start]);
  });
  board.addEventListener("pointermove", (e) => {
    if (!start) return;
    const p = cellFromEvent(e);
    if (!same(p, start)) moved = true;
    if (moved) setSelection(snap(start, p));
  });
  board.addEventListener("pointerup", (e) => {
    if (!start) return;
    const p = cellFromEvent(e);
    if (moved) { anchor = null; submit(snap(start, p)); }
    else if (anchor && !same(anchor, p)) { const a = anchor; anchor = null; submit(snap(a, p)); }
    else if (same(anchor, p)) { anchor = null; setSelection([]); }
    else { anchor = p; setSelection([]); }
    start = null;
  });
  board.addEventListener("pointercancel", () => { start = null; setSelection([]); });

  // ---------- Final ----------
  function openEnding(force) {
    const key = room.code + ":" + room.round;
    if (!force && shownEndFor === key) return;
    const first = shownEndFor !== key;
    shownEndFor = key;
    const total = room.words.length, found = Object.keys(room.found).length;
    let emoji = "🏆", title = "", sub = "";
    const scores = $("endScores");
    scores.replaceChildren();
    if (room.mode === "solo") {
      const ms = room.endedAt - room.startedAt + room.penalty * 1000;
      const complete = found === total;
      const bests = store.get("sopaBest", {});
      const record = complete && (!bests[room.size] || ms < bests[room.size]);
      if (first && record) { bests[room.size] = ms; store.set("sopaBest", bests); }
      if (first) SDL.bump("sopa.solo", "sopa:" + key);
      emoji = complete ? (record ? "🥇" : "🎉") : "🧩";
      title = complete ? (record ? "¡Nuevo récord!" : "¡Completaste la sopa!") : `Encontraste ${found} de ${total}`;
      sub = complete ? `Tiempo: ${SDL.fmtTime(ms)}` + (room.hints.length ? ` (con ${room.hints.length} pista${room.hints.length > 1 ? "s" : ""})` : "") : "Las que faltaban quedaron marcadas en rojo.";
      scores.append(el("div", {}, el("b", { textContent: SDL.fmtTime(ms) }), "tiempo"), el("div", {}, el("b", { textContent: found + "/" + total }), "palabras"));
      if (first && complete) { SDL.confetti(); sound("win"); }
    } else {
      const [a, b] = room.scores;
      const tie = a === b, winner = a > b ? 0 : 1;
      emoji = tie ? "🤝" : winner === seat ? "🏆" : "💪";
      title = tie ? "¡Empate!" : winner === seat ? "¡Ganaste!" : `Ganó ${room.players[winner]}`;
      sub = room.wins[0] + room.wins[1] > 0 ? `Serie: ${room.players[0]} ${room.wins[0]} – ${room.wins[1]} ${room.players[1]}` : "";
      for (const i of [0, 1]) scores.append(el("div", { style: `border:2px solid var(--p${i})` }, el("b", { textContent: room.scores[i] }), room.players[i]));
      if (first) {
        SDL.bump("sopa.duel", "sopa:" + key);
        if (!tie && winner === seat) { SDL.bump("sopa.won"); SDL.confetti(); sound("win"); }
      }
    }
    $("endEmoji").textContent = emoji;
    $("endTitle").textContent = title;
    $("endSub").textContent = sub;
    $("ending").classList.remove("hide");
    $("rematch").focus();
  }
  function closeEnding() { $("ending").classList.add("hide"); }
})();
