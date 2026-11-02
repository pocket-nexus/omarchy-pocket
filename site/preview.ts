// Serves site/public for review: bun site/preview.ts [--port=4205]
const port = Number(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 4205);
const root = new URL("public/", import.meta.url).pathname;
Bun.serve({
  port, hostname: "127.0.0.1",
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
    if (path.includes("..")) return new Response("no", { status: 400 });
    if (path === "" || path.endsWith("/")) path += "index.html";
    if (path === "og-card.html") return new Response(Bun.file(new URL("og-card.html", import.meta.url).pathname), { headers: { "content-type": "text/html" } });
    let file = Bun.file(root + path);
    if (!(await file.exists())) file = Bun.file(`${root}${path}/index.html`);
    return (await file.exists()) ? new Response(file, { headers: { "cache-control": "no-store" } }) : new Response("not found", { status: 404 });
  },
});
console.log(`http://127.0.0.1:${port}/`);
