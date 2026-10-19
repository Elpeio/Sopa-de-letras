import { describe, expect, test } from "bun:test";
import { arrange, deadwood, isChinchon, isMeld, type Card } from "../src/chinchon";
import { generateBoard, straightLine, SIZES } from "../src/sopa";
import { CATEGORIES, categoryList, wordsFor } from "../src/words";

const c = (n: number, s: number): Card => ({ id: s * 20 + n, n, s });

describe("chinchón", () => {
  test("el 7 sigue con la sota en una escalera", () => {
    expect(isMeld([c(6, 1), c(7, 1), c(10, 1)])).toBe(true);
    expect(isMeld([c(5, 1), c(7, 1), c(10, 1)])).toBe(false);
  });
  test("piernas de 3 y 4, no de palos mezclados en escalera", () => {
    expect(isMeld([c(4, 0), c(4, 1), c(4, 2)])).toBe(true);
    expect(isMeld([c(4, 0), c(4, 1), c(4, 2), c(4, 3)])).toBe(true);
    expect(isMeld([c(1, 0), c(2, 1), c(3, 2)])).toBe(false);
  });
  test("puntos sueltos con la mejor combinación", () => {
    const hand = [c(1, 0), c(2, 0), c(3, 0), c(5, 1), c(5, 2), c(5, 3), c(12, 2)];
    expect(deadwood(hand)).toBe(10);
    const a = arrange(hand);
    expect(a.melds.length).toBe(2);
    expect(a.loose.map((x) => x.n)).toEqual([12]);
  });
  test("una carta no se usa en dos juegos a la vez", () => {
    // El 3 de oros sirve para la escalera o para la pierna de treses, no para ambas:
    // conviene la pierna y quedan sueltos el 1 y el 2.
    const hand = [c(1, 0), c(2, 0), c(3, 0), c(3, 1), c(3, 2)];
    expect(deadwood(hand)).toBe(3);
    expect(arrange(hand).melds).toHaveLength(1);
  });
  test("chinchón: siete seguidas del mismo palo", () => {
    expect(isChinchon([1, 2, 3, 4, 5, 6, 7].map((n) => c(n, 3)))).toBe(true);
    expect(isChinchon([4, 5, 6, 7, 10, 11, 12].map((n) => c(n, 2)))).toBe(true);
    expect(isChinchon([1, 2, 3, 4, 5, 6].map((n) => c(n, 3)).concat(c(7, 2)))).toBe(false);
  });
});

describe("sopa de letras", () => {
  test("todas las categorías tienen palabras válidas para el tablero", () => {
    for (const [key, cat] of Object.entries(CATEGORIES)) {
      for (const w of cat.words) expect(w, key).toMatch(/^[A-ZÑ]+$/);
    }
    expect(categoryList().length).toBe(Object.keys(CATEGORIES).length + 1);
  });
  test("las palabras quedan escritas en el tablero", () => {
    for (const size of SIZES) for (const cat of ["Mezclados", ...Object.keys(CATEGORIES)]) {
      const { grid, placements } = generateBoard(size, cat);
      expect(grid.length).toBe(size);
      expect(placements.length).toBeGreaterThanOrEqual(Math.min(6, wordsFor(cat).filter((w) => w.length <= size).length));
      for (const p of placements) {
        expect(p.cells.map(([r, col]) => grid[r][col]).join("")).toBe(p.word);
        expect(straightLine(p.cells)).not.toBeNull();
      }
    }
  });
  test("cada categoría elegida se respeta (antes caía en Animales)", () => {
    const { placements } = generateBoard(12, "Colores");
    for (const p of placements) expect(CATEGORIES.Colores.words).toContain(p.word);
  });
  test("en Fácil sólo hay palabras hacia la derecha o hacia abajo", () => {
    for (let i = 0; i < 30; i++) {
      for (const p of generateBoard(9, "Mezclados").placements) {
        const [a, b] = p.cells;
        expect([[0, 1], [1, 0]]).toContainEqual([b[0] - a[0], b[1] - a[1]]);
      }
    }
  });
  test("straightLine rechaza selecciones torcidas", () => {
    expect(straightLine([[0, 0], [1, 1], [2, 2]])).not.toBeNull();
    expect(straightLine([[0, 0], [1, 1], [2, 3]])).toBeNull();
    expect(straightLine([[0, 0], [0, 0]])).toBeNull();
    expect(straightLine("hola")).toBeNull();
  });
});
