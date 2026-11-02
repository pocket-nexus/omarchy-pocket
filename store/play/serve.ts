// An applet in a browser on its sample data, before it is published: the store
// website's player (store/site/play) framed by a page that posts it a package
// built here and the applet's mock/ packed again on every load, so an edit to
// the sample data shows on a reload. Each request the applet makes is listed
// under the surface, with what answered it.
//
//   bun store/play/serve.ts <package.pocket> <applet dir> [port]
//   pocket-applet web <name>            (the SDK's way to the same page)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packMock } from "../../sdk/mock.ts";

const PLAY = resolve(import.meta.dir, "..", "site", "play");
/** The frame's policy, as store/site/_headers gives it on oma.pocket.nexus. */
export const PLAYER_POLICY = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'self'";

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Applet on sample data</title>
<style>
  body { margin: 0; padding: 20px; background: #101014; color: #d8d8e0; font: 13px/1.4 ui-monospace, Menlo, monospace; }
  .frame { width: min(100%, 1024px); aspect-ratio: 4 / 3; border: 1px solid #2c2c36; border-radius: 10px; overflow: hidden; }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  .bar { display: flex; gap: 10px; align-items: center; margin: 12px 0; }
  button { font: inherit; color: inherit; background: #23232c; border: 1px solid #34343f; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  ol { padding-left: 22px; max-width: 1024px; }
  li { overflow-wrap: anywhere; }
  .miss { color: #ff8f8f; }
</style></head><body>
<div class="frame"><iframe id="player" sandbox="allow-scripts" src="/play/"></iframe></div>
<div class="bar"><button id="back" type="button">Back</button><span id="state">Loading</span></div>
<ol id="requests"></ol>
<script>
const frame = document.getElementById("player"), list = document.getElementById("requests"), state = document.getElementById("state");
document.getElementById("back").onclick = () => frame.contentWindow.postMessage({ type: "button", name: "back" }, "*");
addEventListener("message", async (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m.type === "ready") {
    const [pkg, wasm, mock] = await Promise.all([fetch("/local/package").then((r) => r.arrayBuffer()), fetch("/play/pocketjs.wasm").then((r) => r.arrayBuffer()), fetch("/local/mock").then((r) => r.json())]);
    if (mock.errors) state.textContent = "mock/mock.json: " + mock.errors.join("; ");
    frame.contentWindow.postMessage({ type: "boot", package: pkg, wasm, mock: mock.errors ? null : mock, size: [512, 384] }, "*", [pkg, wasm]);
  } else if (m.type === "running") state.textContent = m.title + ", on its sample data";
  else if (m.type === "error") state.textContent = "stopped: " + m.message;
  else if (m.type === "request") {
    const li = document.createElement("li");
    li.textContent = m.method + " " + m.url + " → " + (m.answer ? m.status + " (" + m.answer + ")" : "no sample data");
    if (!m.answer) li.className = "miss";
    list.append(li);
  }
});
</script></body></html>`;

export function servePlayer(options: { package: string; applet: string; port: number; hostname?: string }) {
  if (!existsSync(join(PLAY, "player.js"))) throw new Error("no player: bun store/build-player.ts");
  return Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (path === "/local/package") return new Response(readFileSync(options.package));
      if (path === "/local/mock") {
        const packed = packMock(options.applet);
        if (Array.isArray(packed)) return Response.json({ errors: packed });
        return new Response(packed ? packed.bytes : JSON.stringify({ mock: 1, routes: [] }), { headers: { "content-type": "application/json" } });
      }
      if (path.startsWith("/play/")) {
        const file = Bun.file(join(PLAY, path === "/play/" ? "index.html" : path.slice("/play/".length)));
        if (!(await file.exists())) return new Response("not found", { status: 404 });
        return new Response(file, { headers: { "content-security-policy": PLAYER_POLICY, ...(path.endsWith(".wasm") ? { "content-type": "application/wasm" } : {}) } });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const [pkg, applet, port = "4310"] = process.argv.slice(2);
  if (!pkg || !applet) throw new Error("usage: bun store/play/serve.ts <package.pocket> <applet dir> [port]");
  servePlayer({ package: pkg, applet, port: Number(port) });
  console.log(`http://127.0.0.1:${port}/`);
}
