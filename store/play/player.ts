// The applet player: a store package's own bundle and pak on PocketJS's core in
// WebAssembly, drawing its touch surface on a canvas, with every request it
// makes answered from the version's sample data (applets/lib/mock.ts). It runs
// in a sandboxed frame with no origin and no network (store/site/_headers):
// the page that frames it posts the package, the sample data and the core, and
// hears back what the applet asked for.
//
//   parent → frame   {type: "boot", package, wasm, mock, size: [w, h], target}
//                    {type: "button", name: "back"}
//   frame → parent   {type: "ready"} {type: "running", id, title}
//                    {type: "request", method, url, answer, status} {type: "error", message}
import { createWasmUi } from "../../vendor/pocketjs/platforms/web/wasm-ops.js";
import { canvasRasterizer, installRuntimeGlyphs } from "../../vendor/pocketjs/platforms/web/runtime-glyphs.js";
import { decodePocketPackage, findSection, POCKET_SECTION } from "../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import { createMockNet, type MockData } from "../../applets/lib/mock.ts";

const BTN = { SELECT: 0x0001, START: 0x0008, UP: 0x0010, RIGHT: 0x0020, DOWN: 0x0040, LEFT: 0x0080, TRIANGLE: 0x1000, CIRCLE: 0x2000, CROSS: 0x4000, SQUARE: 0x8000 };
/** keys of a computer's keyboard as the gamepad's buttons */
const KEYS: Record<string, number> = { ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT, Enter: BTN.CIRCLE, Escape: BTN.CROSS };
const TICK = 1000 / 60;
/** frames a Back press holds Cross, as the deck's Back does (shell/src/packages.ts) */
const BACK_FRAMES = 3;

const tell = (message: Record<string, unknown>) => parent.postMessage(message, "*");
const canvas = document.getElementById("surface") as HTMLCanvasElement;

/** An IMG entry (framework/compiler/pak.ts) from a picture: scaled to cover w x h, cropped at the
 *  centre, a soft circle when `round`. */
async function picture(source: Uint8Array, type: string, w: number, h: number, round: boolean): Promise<Uint8Array | null> {
  if (![8, 16, 32, 64, 128, 256, 512].includes(w) || ![8, 16, 32, 64, 128, 256, 512].includes(h)) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([source as BlobPart], { type }));
    const scale = Math.max(w / bitmap.width, h / bitmap.height);
    const sw = w / scale, sh = h / scale;
    const surface = new OffscreenCanvas(w, h);
    const context = surface.getContext("2d")!;
    context.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, h);
    const rgba = context.getImageData(0, 0, w, h).data;
    if (round) {
      const r = w / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
        const a = Math.max(0, Math.min(1, r - d));
        rgba[(y * w + x) * 4 + 3] = Math.round(rgba[(y * w + x) * 4 + 3]! * a);
      }
    }
    const entry = new Uint8Array(8 + w * h * 4);
    const view = new DataView(entry.buffer);
    view.setUint16(0, w, true);
    view.setUint16(2, h, true);
    entry[4] = 3; // PSM_8888: RGBA bytes
    entry[5] = 1; // IMG_FLAG_LINEAR
    entry.set(rgba, 8);
    return entry;
  } catch {
    return null;
  }
}

interface Boot {
  package: ArrayBuffer;
  wasm: ArrayBuffer;
  mock: MockData | null;
  size?: [number, number];
  target?: string;
}

async function boot(message: Boot) {
  const pkg = decodePocketPackage(new Uint8Array(message.package));
  const variant = pkg.variants.find((v) => v.target === (message.target ?? "rg-ds-plus")) ?? pkg.variants[0];
  if (!variant) throw new Error("the package has no build");
  const js = findSection(variant, POCKET_SECTION.js);
  const pak = findSection(variant, POCKET_SECTION.pak);
  if (!js) throw new Error("the package has no bundle");
  // the bundle is NUL-terminated for QuickJS
  const source = new TextDecoder().decode(js[js.length - 1] === 0 ? js.subarray(0, -1) : js);
  const manifest = JSON.parse(new TextDecoder().decode(pkg.manifest)) as { id?: string; title?: string };
  const [w, h] = message.size ?? [512, 384];

  const net = createMockNet(message.mock ?? { mock: 1, routes: [] }, {
    request: (note) => tell({ type: "request", ...note }),
    picture: (bytes, type, pw, ph, round) => picture(bytes, type, pw, ph, round),
  });
  const g = globalThis as Record<string, unknown>;
  g.__simHz = 60;
  g.__pocketApp = manifest.id ?? "applet";
  g.net = net.ns;

  canvas.width = w * 2;
  canvas.height = h * 2;
  const context = canvas.getContext("2d", { alpha: false })!;
  const image = context.createImageData(w * 2, h * 2);
  let glyphs: { flush(): void } | undefined;
  const wasm = await createWasmUi(message.wasm, { width: w, height: h, rasterDensity: 2, auxiliary: [w, h] });
  wasm.boot(source, {
    pak: pak ?? new Uint8Array(0),
    sourceName: `${manifest.id ?? "applet"}.js`,
    host: message.target ?? "rg-ds-plus",
    renderScale: 2,
    beforeEvaluate(ops: Record<string, unknown> & { uploadTexture(data: Uint8Array, w: number, h: number, psm: number): number }) {
      glyphs = installRuntimeGlyphs(ops, { rasterize: canvasRasterizer({}) });
      // the images service's pictures, as the device host uploads them
      ops.uploadImgEntry = (blob: Uint8Array) => {
        const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        return ops.uploadTexture(blob.subarray(8), view.getUint16(0, true), view.getUint16(2, true), blob[4]!);
      };
    },
    afterFrame() {
      glyphs?.flush();
    },
  });
  tell({ type: "running", id: manifest.id, title: manifest.title });

  const contacts = new Map<number, { x: number; y: number }>();
  let buttons = 0;
  let back = 0;
  const at = (event: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(w - 1, ((event.clientX - r.left) / r.width) * w)), y: Math.max(0, Math.min(h - 1, ((event.clientY - r.top) / r.height) * h)) };
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    contacts.set(e.pointerId, at(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (contacts.has(e.pointerId)) contacts.set(e.pointerId, at(e));
  });
  for (const end of ["pointerup", "pointercancel"] as const) canvas.addEventListener(end, (e) => contacts.delete(e.pointerId));
  // a wheel scrolls as a finger drag does
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const start = at(e as unknown as PointerEvent);
    const id = 900 + (Date.now() % 50);
    const steps = 6;
    for (let i = 0; i <= steps; i++) setTimeout(() => {
      if (i === steps) return contacts.delete(id);
      contacts.set(id, { x: start.x, y: Math.max(0, Math.min(h - 1, start.y - (e.deltaY * i) / steps / 2)) });
    }, i * TICK);
  }, { passive: false });
  addEventListener("keydown", (e) => {
    const button = KEYS[e.key];
    if (!button) return;
    e.preventDefault();
    buttons |= button;
  });
  addEventListener("keyup", (e) => {
    const button = KEYS[e.key];
    if (button) buttons &= ~button;
  });
  addEventListener("message", (e) => {
    if (e.data?.type === "button" && e.data.name === "back") back = BACK_FRAMES;
  });

  let last = performance.now();
  let owed = 0;
  let painted: number | null = null;
  const frame = (now: number) => {
    owed = Math.min(owed + (now - last), TICK * 4);
    last = now;
    while (owed >= TICK) {
      owed -= TICK;
      net.beginFrame();
      const pressed = buttons | (back > 0 ? BTN.CROSS : 0);
      if (back > 0) back--;
      wasm.advance({ buttons: pressed, contacts: [...contacts.entries()].map(([id, c]) => ({ surface: 1, id: id & 0xff, x: c.x, y: c.y })) });
    }
    const drawn = wasm.drawHashAuxiliary();
    if (drawn !== painted) {
      image.data.set(wasm.renderAuxiliary(2));
      context.putImageData(image, 0, 0);
      painted = drawn;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

addEventListener("message", (e) => {
  if (e.data?.type !== "boot") return;
  boot(e.data as Boot).catch((error) => tell({ type: "error", message: error instanceof Error ? error.message : String(error) }));
});
addEventListener("error", (e) => tell({ type: "error", message: e.message }));
addEventListener("unhandledrejection", (e) => tell({ type: "error", message: String(e.reason?.message ?? e.reason) }));
tell({ type: "ready" });
