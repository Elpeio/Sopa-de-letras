// Empaqueta el servidor y todos los archivos del navegador en un único archivo,
// listo para pegar como código de la Railway Function (dist/function.ts).
import type { BunPlugin } from "bun";

const js = new Bun.Transpiler({ loader: "js", minifyWhitespace: true });
const minify: Record<string, (s: string) => string> = {
  js: (s) => js.transformSync(s),
  css: (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{}:;,>])\s*/g, "$1").replace(/;}/g, "}").trim(),
  html: (s) => s
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${minify.css(css)}</style>`)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\n\s*/g, " ")
    .trim(),
};

const inlineAssets: BunPlugin = {
  name: "inline-assets",
  setup(build) {
    build.onLoad({ filter: /src\/client\/.*\.(html|css|js)$/ }, async ({ path }) => {
      const ext = path.split(".").pop()!;
      return { contents: `export default ${JSON.stringify(minify[ext](await Bun.file(path).text()))};`, loader: "js" };
    });
  },
};

const result = await Bun.build({
  entrypoints: ["src/server.ts"],
  target: "bun",
  minify: { whitespace: true, syntax: true },
  plugins: [inlineAssets],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const code = `// Generado con \`bun run build\` desde github.com/Elpeio/Sopa-de-letras. No editar a mano.\n${await result.outputs[0].text()}`;
await Bun.write("dist/function.ts", code);
console.log(`dist/function.ts: ${(code.length / 1024).toFixed(1)} KB`);
