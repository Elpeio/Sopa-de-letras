// Empaqueta el Truco en una sola página HTML que corre sin servidor (sólo contra
// la compu): la lógica de src/truco.ts viaja dentro de la página. Pensado para
// publicarlo como artifact o abrirlo como archivo local.
const read = (p: string) => Bun.file(p).text();

const bundle = await Bun.build({ entrypoints: ["src/client/local-truco.ts"], target: "browser", minify: true });
if (!bundle.success) { for (const l of bundle.logs) console.error(l); process.exit(1); }
const localJs = await bundle.outputs[0].text();

let html = await read("src/client/truco.html");
const theme = await read("src/client/theme.css");
const common = await read("src/client/common.js");
const truco = await read("src/client/truco.js");

// Sin esqueleto propio: la página se incrusta en el del visor.
html = html.replace(/^[\s\S]*?<title>[^<]*<\/title>/, `<title>Truco</title>\n<meta name="claude:viewport-fit-sides" content="cover">`);
html = html.replace(/<link rel="icon"[^>]*>\s*/, "");
html = html.replace(`<link rel="stylesheet" href="/assets/theme.css">`, `<style>${theme}</style>`);
html = html.replace(/<\/head>\s*<body>/, "");
html = html.replace(/<\/body>\s*<\/html>\s*$/, "");
html = html.replace(`<script src="/assets/common.js"></script>`, `<script>${common}</script>`);
html = html.replace(`<script src="/assets/truco.js"></script>`, `<script>${localJs}</script>\n<script>${truco}</script>`);
// Ajustes de la versión local: sin biblioteca ni salas, y margen seguro en los costados.
html = html.replace("</style>", `
    html, body { color-scheme: dark; }
    main.wrap { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 18px 48px; }
    @media (max-width: 560px) { main.wrap { padding-left: max(8px, env(safe-area-inset-left, 0px)); padding-right: max(8px, env(safe-area-inset-right, 0px)); padding-block: 10px 30px; } }
    body.local .back, body.local #modeChoices, body.local .divider, body.local .divider + .row, body.local #result a.btn{ display: none !important; }
    body.local .topbar::before { content: "Sopa de Letras · biblioteca"; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--gold); font-weight: 900; }
  </style>`);
await Bun.write("dist/truco.html", html);
console.log(`dist/truco.html: ${(html.length / 1024).toFixed(1)} KB`);
