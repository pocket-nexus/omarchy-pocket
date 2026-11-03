// Records the page's stills (the legends under L1 and R1, the Tailscale and
// proxy panels, a theme) and the chord video from the real shell in the
// browser demo, tick by tick, with the clock stopped. Needs the preview running.
//
//   bun site/record.ts [--port=4205]
import { $ } from "bun";
import { mkdirSync, rmSync } from "node:fs";
import { LENGTH, held } from "./public/kit/chords.js";

const port = Number(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 4205);
const OUT = new URL("public/shots/", import.meta.url).pathname;
const FRAMES = `${process.env.TMPDIR ?? "/tmp"}/omapocket-frames`;
const dbg = 9500 + Math.floor(Math.random() * 300);
const chrome = Bun.spawn(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/cdp-${dbg}`, "--no-first-run", "about:blank"], { stdout: "ignore", stderr: "ignore" });
let target: any;
for (let i = 0; i < 60; i++) { try { target = await (await fetch(`http://127.0.0.1:${dbg}/json/new?about:blank`, { method: "PUT" })).json(); break; } catch { await Bun.sleep(200); } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.id) { pending.get(m.id)?.(m.result ?? m.error); pending.delete(m.id); } };
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description}`);
  return r.result?.value;
};
await send("Page.enable"); await send("Runtime.enable");
// a stopped clock: Monday 10:24 in every frame, so the video loops without a seam
await send("Page.addScriptToEvaluateOnNewDocument", { source: `{const T=new Date(2026,10,2,10,24,0).getTime();const D=Date;globalThis.Date=class extends D{constructor(...a){a.length?super(...a):super(T)}static now(){return T}};globalThis.__recording=true;}` });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/demo/?record` });
for (let i = 0; i < 100 && !(await js("!!window.sim")); i++) await Bun.sleep(200);
await js("sim.stop()");
const step = (n: number) => js(`sim.step(${n})`);
// the clock is stopped: a call's answer comes with the steps after it, so it is not awaited
const call = async (...a: string[]) => { await js(`void sim.call(${a.map((x) => JSON.stringify(x)).join(",")})`); await step(30); };
const png = async (expr: string, file: string) => { const data: string = await js(`${expr}.toDataURL("image/png")`); await Bun.write(file, Buffer.from(data.split(",")[1]!, "base64")); };
const still = async (name: string) => {
  // a panel's data arrives through the bridge's promises, between evaluations
  await step(10); await Bun.sleep(200); await step(30); await Bun.sleep(100); await step(30);
  await png("document.querySelector('#stage')", `/tmp/op-${name}-top.png`);
  await png("document.querySelector('#deck')", `/tmp/op-${name}-bottom.png`);
  for (const side of ["top", "bottom"]) await $`magick /tmp/op-${name}-${side}.png -quality 88 -define webp:method=6 ${OUT}${name}-${side}.webp`.quiet();
  console.log("still", name);
};
const typed = async (text: string) => { await call("pocket.input", "type", text); await call("pocket.input", "key", "Enter"); await step(20); };
const hold = async (mask: string, down: boolean) => { await js(`sim.press(sim.BTN.${mask},${down})`); };

// three windows, the way a person would have them
await call("pocket.window", "open", "terminal"); await step(60);
await call("pocket.window", "open", "notes"); await step(40);
await call("pocket.window", "open", "terminal"); await step(40);
await typed("clear");
await typed("uname -a");
await typed("cd Work/omarchy-pocket");
await typed("ls");
for (let i = 0; i < 2; i++) { await hold("L1", true); await step(4); await hold("LEFT", true); await step(6); await hold("LEFT", false); await step(6); await hold("L1", false); await step(30); }
await typed("clear");
await typed("fastfetch");
await step(60);

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
await js(`window.__joined=document.createElement('canvas');__joined.width=1024;__joined.height=1536;window.__ctx=__joined.getContext('2d')`);
let now = { shoulder: null as string | null, direction: null as string | null };
for (let tick = 0; tick < LENGTH; tick++) {
  const h = held(tick);
  if (h.shoulder !== now.shoulder) { if (now.shoulder) await hold(now.shoulder, false); if (h.shoulder) await hold(h.shoulder, true); }
  if (h.direction !== now.direction) { if (now.direction) await hold(now.direction, false); if (h.direction) await hold(h.direction, true); }
  now = h;
  await step(1);
  await js(`__ctx.drawImage(document.querySelector('#stage'),0,0);__ctx.drawImage(document.querySelector('#deck'),0,768)`);
  await png("__joined", `${FRAMES}/${String(tick).padStart(4, "0")}.png`);
}
await $`ffmpeg -nostdin -y -loglevel error -framerate 60 -i ${FRAMES}/%04d.png -c:v libx264 -preset veryslow -crf 21 -pix_fmt yuv420p -movflags +faststart -an ${OUT}chords.mp4`;
await $`magick ${FRAMES}/0000.png -crop 1024x768+0+0 +repage -quality 88 ${OUT}chords-top.webp`.quiet();
await $`magick ${FRAMES}/0000.png -crop 1024x768+0+768 +repage -quality 88 ${OUT}chords-bottom.webp`.quiet();
console.log("video", (await Bun.file(`${OUT}chords.mp4`).size) >> 10, "KiB");

// a held shoulder's legend on the deck, over the three windows (kit/scenes.js)
for (const [mask, name] of [["L1", "legend"], ["R1", "legend-move"]] as const) {
  await hold(mask, true); await step(24); await still(name);
  await hold(mask, false); await step(30);
}

// the shell's own panels and states, for the page's stills
await call("shell", "summon", "omarchy.tailscale"); await still("ts");
await call("pocket.input", "key", "Escape");
await call("shell", "summon", "omarchy.proxy"); await still("proxy");
await call("pocket.input", "key", "Escape");
await js(`sim.daemon.setTheme("lupine")`); await step(60); await still("lupine-tile");
ws.close(); chrome.kill(); rmSync(FRAMES, { recursive: true, force: true }); process.exit(0);
