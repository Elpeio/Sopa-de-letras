import { describe, expect, test } from "bun:test";
import {
  act, actionsFor, deal, envidoOf, envidoPoints, envidoRaises, florOf, handWinner, hasFlor, isParaguayana, power,
  type Card, type TrucoRoom,
} from "../src/truco";

const c = (n: number, s: number): Card => ({ id: s * 20 + n, n, s });
const O = 0, C = 1, E = 2, B = 3;

describe("truco: cartas", () => {
  test("el ancho de espadas le gana a todas y el cuatro a ninguna", () => {
    const order = [c(1, E), c(1, B), c(7, E), c(7, O), c(3, C), c(2, C), c(1, O), c(12, O), c(11, O), c(10, O), c(7, C), c(6, O), c(5, O), c(4, O)];
    for (let i = 1; i < order.length; i++) expect(power(order[i - 1])).toBeGreaterThan(power(order[i]));
    expect(power(c(3, O))).toBe(power(c(3, E)));
    expect(power(c(1, C))).toBe(power(c(1, O)));
  });
  test("envido: dos del mismo palo suman 20, las figuras valen 0", () => {
    expect(envidoOf([c(7, O), c(6, O), c(4, E)])).toBe(33);
    expect(envidoOf([c(12, O), c(11, O), c(4, E)])).toBe(20);
    expect(envidoOf([c(12, O), c(5, C), c(4, E)])).toBe(5);
    expect(envidoOf([c(7, O), c(6, O), c(5, O)])).toBe(33); // las dos más altas
  });
  test("flor y paraguayana", () => {
    expect(hasFlor([c(7, O), c(6, O), c(5, O)])).toBe(true);
    expect(florOf([c(7, O), c(6, O), c(5, O)])).toBe(38);
    expect(hasFlor([c(7, O), c(6, O), c(5, C)])).toBe(false);
    expect(isParaguayana([c(4, O), c(5, C), c(6, E)])).toBe(true);
    expect(isParaguayana([c(4, O), c(5, C), c(7, B)])).toBe(true);
    expect(isParaguayana([c(4, O), c(5, C), c(7, E)])).toBe(false); // el 7 de espadas es bravo
    expect(isParaguayana([c(4, O), c(5, O), c(6, E)])).toBe(false); // tiene envido
    expect(isParaguayana([c(4, O), c(5, C), c(10, E)])).toBe(false);
  });
});

describe("truco: cantos", () => {
  test("puntos del envido querido y no querido", () => {
    const s = [10, 20], t = 30;
    expect(envidoPoints(["E"], true, s, t)).toBe(2);
    expect(envidoPoints(["E"], false, s, t)).toBe(1);
    expect(envidoPoints(["E", "E"], true, s, t)).toBe(4);
    expect(envidoPoints(["E", "E"], false, s, t)).toBe(2);
    expect(envidoPoints(["E", "R"], true, s, t)).toBe(5);
    expect(envidoPoints(["R"], false, s, t)).toBe(1);
    expect(envidoPoints(["E", "E", "R", "F"], true, s, t)).toBe(7 + 10);
    expect(envidoPoints(["E", "E", "R", "F"], false, s, t)).toBe(7);
    expect(envidoPoints(["F"], true, s, t)).toBe(10);
    expect(envidoPoints(["F"], false, s, t)).toBe(1);
  });
  test("cadena de envido permitida", () => {
    expect(envidoRaises([])).toEqual(["E", "R", "F"]);
    expect(envidoRaises(["E"])).toEqual(["E", "R", "F"]);
    expect(envidoRaises(["E", "E"])).toEqual(["R", "F"]);
    expect(envidoRaises(["R"])).toEqual(["F"]);
    expect(envidoRaises(["E", "R", "F"])).toEqual([]);
  });
  test("quién gana la mano según las bazas", () => {
    expect(handWinner([0, 0], 0)).toBe(0);
    expect(handWinner([0, 1], 0)).toBe(-1);
    expect(handWinner([0, 1, 1], 0)).toBe(1);
    expect(handWinner([0, 1, -1], 0)).toBe(0); // tercera parda: gana el de la primera
    expect(handWinner([-1, 1], 0)).toBe(1); // primera parda: gana el de la segunda
    expect(handWinner([0, -1], 0)).toBe(0);
    expect(handWinner([-1, -1, 1], 0)).toBe(1);
    expect(handWinner([-1, -1, -1], 1)).toBe(1); // todas pardas: gana el mano
  });
});

function room(size: 2 | 4, opts = { flor: true, paraguayana: true }): TrucoRoom {
  const r: TrucoRoom = {
    code: "TEST1", size, names: Array.from({ length: size }, (_, i) => "J" + i), tokens: [], bots: Array(size).fill(false),
    opts, target: 30, scores: [0, 0], wins: [0, 0], started: false, over: false, winner: -1, hand: null, handCount: 0, events: [],
    sockets: new Set(), touched: 0, botSeq: 0, hints: {}, asked: {}, waited: {}, lastSign: {}, signTimers: [],
  };
  deal(r);
  return r;
}
function rig(r: TrucoRoom, hands: Card[][]) {
  r.hand!.dealt = hands.map((h) => [...h]);
  r.hand!.cards = hands.map((h) => [...h]);
}

describe("truco: una mano", () => {
  test("envido querido, truco, bazas y puntos", () => {
    const r = room(2, { flor: false, paraguayana: false });
    rig(r, [[c(7, O), c(6, O), c(4, E)], [c(1, E), c(5, C), c(4, B)]]);
    expect(actionsFor(r, 0)).toEqual(["play", "E", "R", "F", "truco", "mazo"]);
    expect(actionsFor(r, 1)).toEqual([]);
    expect(act(r, 0, { action: "E" })).toBeNull();
    expect(actionsFor(r, 1)).toEqual(["quiero", "noquiero", "E", "R", "F", "mazo"]);
    expect(act(r, 1, { action: "R" })).toBeNull(); // envido + real envido
    expect(act(r, 0, { action: "quiero" })).toBeNull();
    expect(r.scores).toEqual([5, 0]); // 33 contra 5
    expect(r.hand!.envidoResult!.says).toEqual([{ seat: 0, value: 33 }, { seat: 1, value: null }]);
    expect(actionsFor(r, 0)).toEqual(["play", "truco", "mazo"]); // ya no hay envido
    act(r, 0, { action: "play", id: c(4, E).id });
    expect(actionsFor(r, 1)).toEqual(["play", "truco", "mazo"]);
    act(r, 1, { action: "truco" });
    expect(actionsFor(r, 0)).toEqual(["quiero", "noquiero", "retruco", "mazo"]);
    act(r, 0, { action: "quiero" });
    expect(r.hand!.truco).toMatchObject({ level: 1, state: "accepted", owner: 0 });
    act(r, 1, { action: "play", id: c(4, B).id }); // parda de cuatros
    expect(r.hand!.trickWinner).toEqual([-1]);
    expect(r.hand!.turn).toBe(0); // parda: arranca el mano
    act(r, 0, { action: "play", id: c(7, O).id });
    expect(actionsFor(r, 1)).not.toContain("retruco"); // el retruco lo tiene el otro equipo
    act(r, 1, { action: "play", id: c(1, E).id });
    expect(r.hand!.ended).toBe(true);
    expect(r.hand!.result).toMatchObject({ team: 1, points: 2, reason: "tricks" });
    expect(r.scores).toEqual([5, 2]);
    clearTimeout(r.nextTimer);
  });

  test("el envido está primero: responde al truco con envido y luego sigue el truco", () => {
    const r = room(2, { flor: false, paraguayana: false });
    rig(r, [[c(7, O), c(6, O), c(4, E)], [c(1, E), c(5, C), c(4, B)]]);
    act(r, 0, { action: "truco" });
    expect(actionsFor(r, 1)).toContain("E");
    act(r, 1, { action: "E" });
    expect(r.hand!.pending).toEqual({ kind: "envido", team: 0 });
    act(r, 0, { action: "noquiero" });
    expect(r.scores).toEqual([0, 1]);
    expect(r.hand!.pending).toEqual({ kind: "truco", team: 1 });
    act(r, 1, { action: "noquiero" });
    expect(r.hand!.result).toMatchObject({ team: 0, points: 1, reason: "noquiero" });
    clearTimeout(r.nextTimer);
  });

  test("flor: cancela el envido y vale 3; con dos flores se puede querer", () => {
    const r = room(2);
    rig(r, [[c(7, O), c(6, O), c(4, O)], [c(1, E), c(5, C), c(4, B)]]);
    expect(actionsFor(r, 0)).toEqual(["play", "flor", "truco", "mazo"]);
    act(r, 0, { action: "flor" });
    expect(r.scores).toEqual([3, 0]);
    expect(r.hand!.pending).toBeNull();
    const r2 = room(2);
    rig(r2, [[c(7, O), c(6, O), c(4, O)], [c(1, E), c(5, E), c(4, E)]]);
    act(r2, 0, { action: "play", id: c(4, O).id }); // el mano se guarda la flor
    expect(actionsFor(r2, 1)).toContain("flor");
    act(r2, 1, { action: "flor" });
    expect(r2.hand!.pending).toBeNull(); // el mano ya jugó carta: perdió su flor
    expect(r2.scores).toEqual([0, 3]);
    clearTimeout(r2.nextTimer);
    const r3 = room(2);
    rig(r3, [[c(7, O), c(6, O), c(4, O)], [c(1, E), c(5, E), c(4, E)]]);
    act(r3, 0, { action: "flor" });
    expect(actionsFor(r3, 1)).toEqual(["florquiero", "florachico", "contraflor", "mazo"]);
    act(r3, 1, { action: "florquiero" });
    expect(r3.scores).toEqual([6, 0]); // 37 contra 30
    clearTimeout(r3.nextTimer);
  });

  test("paraguayana: se vuelve a repartir con el mismo mano", () => {
    const r = room(2);
    rig(r, [[c(1, E), c(5, E), c(4, E)], [c(4, O), c(5, C), c(6, E)]]);
    expect(actionsFor(r, 1)).toEqual(["paraguayana"]); // aunque no sea su turno
    expect(actionsFor(r, 0)).not.toContain("paraguayana");
    act(r, 1, { action: "paraguayana" });
    expect(r.hand!.num).toBe(0);
    expect(r.hand!.cards.every((h) => h.length === 3)).toBe(true);
  });

  test("irse al mazo en la primera sin envido regala 2", () => {
    const r = room(2, { flor: false, paraguayana: false });
    act(r, 0, { action: "mazo" });
    expect(r.scores).toEqual([0, 2]);
    clearTimeout(r.nextTimer);
  });

  test("2 vs 2: empate entre compañeros no es parda y el mano gana el envido empatado", () => {
    const r = room(4, { flor: false, paraguayana: false });
    rig(r, [[c(3, O), c(4, C), c(4, E)], [c(2, O), c(5, C), c(4, B)], [c(3, C), c(5, B), c(6, O)], [c(2, C), c(6, C), c(5, E)]]);
    expect(envidoOf(r.hand!.dealt[1])).toBe(5);
    expect(envidoOf(r.hand!.dealt[3])).toBe(28);
    expect(actionsFor(r, 0)).not.toContain("E"); // el mano no canta el envido: lo canta su pie
    act(r, 0, { action: "play", id: c(3, O).id });
    expect(actionsFor(r, 1)).not.toContain("E");
    act(r, 1, { action: "play", id: c(2, O).id });
    expect(actionsFor(r, 2)).toContain("E"); // el pie del equipo del mano
    act(r, 2, { action: "E" });
    expect(actionsFor(r, 3)).toContain("quiero");
    act(r, 3, { action: "quiero" });
    expect(r.scores).toEqual([0, 2]); // 28 del 3 contra 6 del 2
    expect(r.hand!.envidoResult!.says.map((s) => s.value)).toEqual([4, 5, 6, 28]);
    act(r, 2, { action: "play", id: c(3, C).id });
    act(r, 3, { action: "play", id: c(2, C).id });
    expect(r.hand!.trickWinner).toEqual([0]); // dos treses del mismo equipo
    expect(r.hand!.turn).toBe(0);
    clearTimeout(r.nextTimer);
  });
});
