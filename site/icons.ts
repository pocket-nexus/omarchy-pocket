// The icon family and the social card, rendered by headless Chrome from
// public/favicon.svg and og-card.html. Needs the preview running.
//
//   bun site/icons.ts [--port=4205]
const port = Number(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 4205);
const PUBLIC = new URL("public/", import.meta.url).pathname;
const dbg = 9800 + Math.floor(Math.random() * 100);
const chrome = Bun.spawn(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/cdp-${dbg}`, "--no-first-run", "--hide-scrollbars", "--ignore-gpu-blocklist", "--use-angle=metal", "about:blank"], { stdout: "ignore", stderr: "ignore" });
let target: any;
for (let i = 0; i < 60; i++) { try { target = await (await fetch(`http://127.0.0.1:${dbg}/json/new?about:blank`, { method: "PUT" })).json(); break; } catch { await Bun.sleep(200); } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id) { pending.get(m.id)?.(m.result ?? m.error); pending.delete(m.id); } };
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Runtime.enable");
const svg = await Bun.file(`${PUBLIC}favicon.svg`).text();
async function icon(size: number, { bg = "", inset = 0 } = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const html = `<!doctype html><style>*{margin:0}html,body{width:${size}px;height:${size}px;background:${bg || "transparent"}}div{position:absolute;inset:${inset * size}px}svg{width:100%;height:100%;display:block}</style><div>${svg}</div>`;
  await send("Page.navigate", { url: `data:text/html;base64,${btoa(html)}` });
  await Bun.sleep(150);
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  return Buffer.from(r.data, "base64");
}
const BG = "#180c30";
const OPAQUE = { bg: BG, inset: 0.11 };
for (const [file, size, opts] of [
  ["favicon-96.png", 96, {}], ["icon-192.png", 192, {}], ["icon-512.png", 512, {}], ["icon-512-maskable.png", 512, { bg: BG, inset: 0.18 }],
  ["apple-touch-icon.png", 180, OPAQUE], ["apple-touch-icon-precomposed.png", 180, OPAQUE],
  ["apple-touch-icon-167.png", 167, OPAQUE], ["apple-touch-icon-152.png", 152, OPAQUE], ["apple-touch-icon-120.png", 120, OPAQUE],
] as [string, number, any][]) await Bun.write(PUBLIC + file, await icon(size, opts));
// favicon.ico: PNG payloads in an ICO container
const parts: [number, Buffer][] = [];
for (const s of [16, 32, 48]) parts.push([s, await icon(s)]);
const head = Buffer.alloc(6 + 16 * parts.length);
head.writeUInt16LE(1, 2); head.writeUInt16LE(parts.length, 4);
let at = head.length;
parts.forEach(([s, png], i) => {
  const o = 6 + i * 16;
  head[o] = s; head[o + 1] = s; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(png.length, o + 8); head.writeUInt32LE(at, o + 12);
  at += png.length;
});
await Bun.write(`${PUBLIC}favicon.ico`, Buffer.concat([head, ...parts.map((p) => p[1])]));

await send("Emulation.setDefaultBackgroundColorOverride", {});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/og-card.html` });
for (let i = 0; i < 60; i++) { const r = await send("Runtime.evaluate", { expression: "document.title", returnByValue: true }); if (r.result?.value === "ready") break; await Bun.sleep(200); }
await Bun.sleep(500);
const card = await send("Page.captureScreenshot", { format: "png" });
await Bun.write(`${PUBLIC}og-image.png`, Buffer.from(card.data, "base64"));
ws.close(); chrome.kill();
console.log("icons and card written");
process.exit(0);
