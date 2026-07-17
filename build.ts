// frontrunner — build.ts
// Produces dist/index.html: one file, zero external requests.
// Bun.build bundles the ES modules; string surgery inlines JS + CSS into the shell.

import { mkdir } from "node:fs/promises";

const result = await Bun.build({
  entrypoints: ["./src/app.js"],
  minify: true,
  target: "browser",
});

if (!result.success) {
  console.error("Bundle failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const js = await result.outputs[0].text();

// Guard: any literal "</script" inside the bundle would terminate the inline
// <script> tag when the HTML parser reads dist/index.html. Fail the build.
if (/<\/script/i.test(js)) {
  console.error('Bundle contains a literal "</script" sequence — this would truncate the inline script. Assemble the string at runtime instead (e.g. "<" + "/script>").');
  process.exit(1);
}

const css = await Bun.file("./src/styles.css").text();
let html = await Bun.file("./src/index.html").text();

html = html.replace(
  /<link rel="stylesheet" href="\.\/styles\.css" \/>/,
  () => `<style>\n${css}\n</style>`
);
html = html.replace(
  /<script type="module" src="\.\/app\.js"><\/script>/,
  () => `<script type="module">\n${js}\n</script>`
);

if (html.includes('src="./') || html.includes('href="./')) {
  console.error("dist still references external files — inlining incomplete.");
  process.exit(1);
}

await mkdir("./dist", { recursive: true });
await Bun.write("./dist/index.html", html);

const kb = (html.length / 1024).toFixed(1);
console.log(`dist/index.html written — ${kb} KB, zero external requests.`);
