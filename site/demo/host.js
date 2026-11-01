// The browser's omarchy-pocket-host: the shell's real bundle on PocketJS's core
// in WebAssembly, on two canvases, with createDaemon in place of omarchy-pocketd.
import { createWasmUi } from "../../vendor/pocketjs/platforms/web/wasm-ops.js";
import { canvasRasterizer, installRuntimeGlyphs } from "../../vendor/pocketjs/platforms/web/runtime-glyphs.js";
import { createDaemon } from "./daemon.js";

export const BTN = { SELECT: 0x0001, START: 0x0008, UP: 0x0010, RIGHT: 0x0020, DOWN: 0x0040, LEFT: 0x0080, L1: 0x0100, R1: 0x0200, L2: 0x0400, R2: 0x0800, X: 0x1000, A: 0x2000, B: 0x4000, Y: 0x8000 };
const W = 1024, H = 768, TICK = 1000 / 60;

async function gunzip(response) {
  if (!response.ok) throw new Error(`${response.url}: ${response.status}`);
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

export async function boot({ stage, deck, base = ".", onProgress = () => {}, onPaint = () => {} }) {
  onProgress("Loading the shell");
  const [wasmBytes, source, pak, themes, screensaver] = await Promise.all([
    fetch(`${base}/pocketjs.wasm`).then((r) => r.arrayBuffer()),
    fetch(`${base}/shell.js`).then((r) => r.text()),
    fetch(`${base}/shell.pak.gz`).then(gunzip),
    fetch(`${base}/themes.json`).then((r) => r.json()),
    fetch(`${base}/screensaver.txt`).then((r) => r.text()),
  ]);
  onProgress("Starting");

  const stageContext = stage.getContext("2d", { alpha: false });
  const deckContext = deck.getContext("2d", { alpha: false });
  stage.width = deck.width = W; stage.height = deck.height = H;
  const stageImage = stageContext.createImageData(W, H), deckImage = deckContext.createImageData(W, H);

  const inbox = [];
  const daemon = createDaemon({ emit: (m) => inbox.push(JSON.stringify(m)), themes, wallBase: `${base}/walls`, screensaver });
  let ops, repaint = 4, glyphs;
  globalThis.__simHz = 60;
  globalThis.__pocketApp = "dev.pocket-nexus.omarchy-pocket";
  globalThis.omarchyBridge = {
    send: (line) => void daemon.request(line),
    loadTexture(file, w, h) {
      const data = daemon.texture(file);
      if (!data) return -1;
      repaint = 4;
      return ops.uploadTexture(data, w, h, 3);
    },
    loadFontAtlas: () => false,
    powerProfile: () => true,
    openApp: () => -1, closeApp() {}, showApp() {}, appInput() {}, appText() {},
  };

  const wasm = await createWasmUi(wasmBytes, { width: 512, height: 384, rasterDensity: 2, auxiliary: [512, 384] });
  wasm.boot(source, {
    pak, sourceName: "omarchy-pocket.js", host: "rg-ds-plus", renderScale: 2,
    beforeEvaluate(next) {
      ops = next;
      glyphs = installRuntimeGlyphs(next, { rasterize: canvasRasterizer({}) });
    },
    afterFrame() { glyphs?.flush(); },
  });
  daemon.start();

  const input = { buttons: 0, contacts: new Map() };
  let lastTop = null, lastBottom = null, last = performance.now(), acc = 0, running = true, frames = 0, ticks = 0, costs = 0;

  function tick() {
    if (inbox.length) globalThis.__omarchyBridgeReceive?.(inbox.splice(0));
    const contacts = [...input.contacts.entries()].map(([id, c]) => ({ surface: 1, id, x: c.x, y: c.y }));
    wasm.advance({ buttons: input.buttons, contacts });
    ticks++;
  }
  function paint() {
    const top = wasm.drawHash(), bottom = wasm.drawHashAuxiliary();
    const changedTop = top !== lastTop || repaint > 0, changedBottom = bottom !== lastBottom || repaint > 0;
    if (changedTop) {
      stageImage.data.set(wasm.present());
      stageContext.putImageData(stageImage, 0, 0);
      lastTop = top; frames++;
    }
    if (changedBottom) {
      deckImage.data.set(wasm.renderAuxiliary(2));
      deckContext.putImageData(deckImage, 0, 0);
      lastBottom = bottom; frames++;
    }
    if (repaint > 0) repaint--;
    if (changedTop || changedBottom) onPaint(changedTop, changedBottom);
  }
  function loop(now) {
    if (!running) return;
    const started = performance.now();
    acc += Math.min(100, now - last); last = now;
    let did = false;
    while (acc >= TICK) { tick(); acc -= TICK; did = true; }
    if (did) paint();
    costs += performance.now() - started;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    wasm, daemon, input, BTN,
    press(mask, down) { input.buttons = down ? input.buttons | mask : input.buttons & ~mask; },
    touch(id, x, y) { input.contacts.set(id, { x, y }); },
    lift(id) { input.contacts.delete(id); },
    /** `omarchy-shell <target> <method> <args>`, as Omarchy's CLI reaches the shell */
    call: (target, method, ...args) => daemon.shell(target, method, ...args),
    stats: () => ({ ticks, frames, costs }),
    stop() { running = false; },
    /** Stopped, advances `n` ticks and paints: for recording. */
    step(n = 1) { for (let i = 0; i < n; i++) tick(); paint(); },
  };
}
