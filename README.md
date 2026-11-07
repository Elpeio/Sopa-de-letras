# Sopa de Letras · biblioteca de juegos

Juegos para jugar solo o de a dos desde el celular, sin instalar nada. Se llama
como el primer juego que tuvo: la **Sopa de Letras**.

| Juego | Solo | De a dos |
|---|---|---|
| 🔎 **Sopa de Letras** | Contrarreloj con pistas y récords | Por turnos (con reloj) o carrera simultánea, con revancha y serie |
| 🃏 **Chinchón** | Contra la compu | Sala por enlace, partidas a 50 o 100 |
| 🎴 **Truco** | Contra la compu, 1 vs 1 o 2 vs 2 | Sala por enlace (los lugares vacíos los ocupa la compu), a 15 o 30, con flor y paraguayana opcionales, señas en pareja |

## Estructura

```
src/
  server.ts        servidor Bun (HTTP + WebSocket)
  sopa.ts          lógica y salas de la Sopa de Letras
  chinchon.ts      lógica, salas y bot del Chinchón
  truco.ts         reglas, salas y bot del Truco (envido, truco, flor, paraguayana)
  words.ts         categorías y palabras
  rooms.ts         códigos de sala, limpieza de salas viejas
  client/          páginas, estilos y scripts del navegador
test/              pruebas de lógica y de partidas por WebSocket
scripts/build.ts   genera dist/function.ts (un solo archivo)
scripts/build-artifact.ts   genera dist/truco.html (el Truco contra la compu, sin servidor)
legacy/            código original de la Railway Function, por si hace falta volver
```

## Desarrollo

```sh
bun install
bun run dev     # http://localhost:3000
bun test
bun run build   # dist/function.ts
bun run build:artifact   # dist/truco.html: el Truco en una sola página, sin servidor (sólo contra la compu)
```

## Despliegue en Railway

El servicio `sopa-duelo` del proyecto *Sopa de Letras Online* es una Railway
Function: corre un único archivo TypeScript. `bun run build` genera ese archivo
en `dist/function.ts` con todas las páginas incrustadas; es lo que se pega como
código de la función.

Las salas viven en memoria: si el servicio se reinicia, las partidas en curso se
pierden (las estadísticas y récords quedan guardados en cada celular).
