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

## Dónde jugarlo

### Contra la compu, sin servidor: GitHub Pages

`bun run build:artifact` genera `dist/truco.html`, el Truco completo (reglas y
bot) en una sola página. El workflow `.github/workflows/pages.yml` lo publica en
GitHub Pages en cada push; la primera vez hay que habilitar Pages en el repo
(Settings → Pages → Source: *GitHub Actions*) si el workflow no lo logra solo.

### Con gente: un servidor Bun

El multijugador (salas por enlace, WebSocket) necesita el servidor de
`src/server.ts` corriendo en algún lado. Hay un `Dockerfile` y un
`render.yaml` para desplegarlo gratis en Render desde el repo
(render.com → New → Blueprint → este repo). El plan gratuito se duerme tras
unos minutos sin uso y tarda medio minuto en despertar.

Las salas viven en memoria: si el servicio se reinicia, las partidas en curso se
pierden (las estadísticas y récords quedan guardados en cada celular).

`bun run build` sigue generando `dist/function.ts`, el servidor en un único
archivo, por si se vuelve a usar una Railway Function u otro host de ese estilo.
