// Ten-line dev server. `bun run serve` then open http://localhost:3300
Bun.serve({
  port: 3300,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file("./src" + (path === "/" ? "/index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log("frontrunner dev server → http://localhost:3300");
