// Renders the RG DS Plus model (public/kit/rgds.js) with two panel captures to
// a PNG with a transparent background, through Google Chrome's DevTools
// protocol (its --screenshot flag writes nothing for a WebGL page here).
//
//   bun site/render.ts <top.png> <bottom.png> <out.png> [--size=1600x1724] [--pose=yaw,pitch,lid] [--color=black]
//
// The panels take 1024 × 768 captures (site/shots.ts splits a readback into
// them). The default pose is the device open flat, face on: the drawing on
// /vs/iphone-duo/. `--pose=-18,-48,118` is the landing page's three-quarter
// view.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PUBLIC = new URL("public/", import.meta.url).pathname;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const [top, bottom, out] = args.filter((a) => !a.startsWith("--")).map((p) => resolve(p));
if (!top || !bottom || !out) throw new Error("usage: bun site/render.ts <top.png> <bottom.png> <out.png> [--size=WxH] [--pose=yaw,pitch,lid] [--color=black]");
const [width, height] = flag("size", "1600x1724").split("x").map(Number) as [number, number];
const [yaw, pitch, lid] = flag("pose", "0,0,180").split(",").map(Number) as [number, number, number];
const color = flag("color", "black");

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#host{width:${width}px;height:${height}px}</style></head>
<body><div id="host"></div><script type="module">
import { createDevice } from "/kit/rgds.js";
const device = createDevice(document.getElementById("host"), { color: ${JSON.stringify(color)}, drag: false, press: false, tilt: 0 });
await device.preload(["/input/top", "/input/bottom"]);
device.pose({ yaw: ${yaw}, pitch: ${pitch}, lid: ${lid} }, { ms: 0 });
device.show("/input/top", "/input/bottom", { ms: 0 });
// a few frames for the textures to upload and the frame to draw
let frames = 0;
const tick = () => (++frames < 30 ? requestAnimationFrame(tick) : (document.title = "ready"));
requestAnimationFrame(tick);
</script></body></html>`;

const port = 4300 + Math.floor(Math.random() * 200);
const server = Bun.serve({
  port, hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response(page, { headers: { "content-type": "text/html" } });
    if (path === "/input/top") return new Response(Bun.file(top));
    if (path === "/input/bottom") return new Response(Bun.file(bottom));
    if (path.startsWith("/kit/") && !path.includes("..")) return new Response(Bun.file(PUBLIC + path.slice(1)));
    return new Response("not found", { status: 404 });
  },
});

const profile = `${dirname(out)}/.chrome-${port}`;
const chrome = Bun.spawn([CHROME, "--headless=new", `--remote-debugging-port=${port + 1}`, `--user-data-dir=${profile}`, "--no-first-run", "--enable-gpu", "about:blank"], { stdout: "ignore", stderr: "ignore" });
try {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 50 && !targets.length; i++) {
    await Bun.sleep(200);
    targets = await fetch(`http://127.0.0.1:${port + 1}/json`).then((r) => r.json(), () => []);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((done) => (ws.onopen = done));
  let next = 0;
  const waiting = new Map<number, (value: any) => void>();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) waiting.get(message.id)?.(message.result ?? message.error);
    if (message.method === "Runtime.exceptionThrown") console.error(message.params.exceptionDetails?.exception?.description);
  };
  const send = (method: string, params: object = {}) => new Promise<any>((done) => {
    const id = ++next;
    waiting.set(id, done);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  let title = "";
  for (let i = 0; i < 150 && title !== "ready"; i++) {
    await Bun.sleep(100);
    title = (await send("Runtime.evaluate", { expression: "document.title", returnByValue: true })).result?.value ?? "";
  }
  if (title !== "ready") throw new Error("the model did not draw");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(shot.data, "base64"));
  console.log(out);
  ws.close();
} finally {
  chrome.kill();
  server.stop(true);
  await Bun.sleep(200);
  await Bun.$`rm -rf ${profile}`.quiet().nothrow();
}
