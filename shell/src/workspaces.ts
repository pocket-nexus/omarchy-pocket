// The stage's windows as signals, and their motion. wm.ts holds the trees;
// every change goes through `act`, which bumps one revision signal that every
// reader tracks and then moves the windows on the core's animation tracks
// (FLIP): a window is laid out at its new placement, its translate and scale
// put it back where it was drawn, and the core eases them home, so no frame
// of a transition relayouts the tree or runs script. `act` compares the
// current workspace before and after the change:
//
//   a window that stays    eases from where it is drawn to its new place
//                          (200 ms, the core's `out` curve; a resizing
//                          window stretches its last frame until it lands)
//   a window that arrives  pops in from 87 % while it fades up (Omarchy's
//                          windowsIn popin 87%)
//   a window that leaves   leaves an outline that shrinks and fades in
//                          170 ms (windowsOut)
//   another workspace      its windows slide 48 points in from the side it
//                          lies on and fade up
//
// An interrupted transition starts again from where the core has the window
// drawn: the store replays the `out` curve (1 - (1 - t)^3) to find it.
import { createSignal } from "solid-js";
import { animate } from "@pocketjs/framework/animation";
import { after } from "@pocketjs/framework/clock";
import { flip, setSlowMotion, slowed, TOP_LEFT } from "./motion.ts";
import type { NodeMirror } from "@pocketjs/framework/components";
import { WindowManager, WORKSPACES, sameRect, type Content, type Dir, type Layout, type Placement, type Rect, type Win } from "./wm.ts";

export { WORKSPACES };
export type { Content, Dir, Layout, Placement, Rect, Win };

const MOTION_MS = 200;
const GHOST_MS = 170;
const POP = 0.87;
const SLIDE = 48;

export { setSlowMotion };
/** A window's transform origin: its top-left corner. */
export const WINDOW_ORIGIN = TOP_LEFT;

const wm = new WindowManager();
const [rev, setRev] = createSignal(0);

interface Motion {
  from: Rect;
  fromAlpha: number;
  to: Rect;
  toAlpha: number;
  start: number;
}

const motions = new Map<number, Motion>();
const nodes = new Map<number, NodeMirror>();

export interface Ghost {
  key: number;
  rect: Rect;
}
const [ghosts, setGhosts] = createSignal<readonly Ghost[]>([]);
let ghostKey = 0;
export { ghosts };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function drawnAt(m: Motion, now: number) {
  const e = easeOut(Math.min(1, Math.max(0, (now - m.start) / slowed(MOTION_MS))));
  return {
    rect: { x: mix(m.from.x, m.to.x, e), y: mix(m.from.y, m.to.y, e), w: mix(m.from.w, m.to.w, e), h: mix(m.from.h, m.to.h, e) },
    alpha: mix(m.fromAlpha, m.toAlpha, e),
  };
}

/** Puts `node` (laid out at `m.to`) where `m` starts, then lets the core carry it home. */
function play(node: NodeMirror, m: Motion) {
  flip(node, m.from, m.to, m.fromAlpha, m.toAlpha, MOTION_MS);
}

function startMotion(id: number, m: Motion) {
  motions.set(id, m);
  const node = nodes.get(id);
  if (node) play(node, m);
}

const drawn = (id: number, now: number, fallback: Placement) => {
  const m = motions.get(id);
  return m ? drawnAt(m, now) : { rect: fallback.rect, alpha: fallback.hidden ? 0 : 1 };
};

const shrink = (r: Rect, scale: number): Rect => ({ x: r.x + (r.w * (1 - scale)) / 2, y: r.y + (r.h * (1 - scale)) / 2, w: r.w * scale, h: r.h * scale });

/** A stage window registers its node while it is mounted; one that mounts
 *  mid-transition (every new window does) plays from where it is drawn now.
 *  Returns the unregister. */
export function bindWindow(id: number, node: NodeMirror): () => void {
  nodes.set(id, node);
  const m = motions.get(id);
  if (m) {
    const now = Date.now();
    const at = drawnAt(m, now);
    startMotion(id, { ...m, from: at.rect, fromAlpha: at.alpha, start: now });
  }
  return () => {
    if (nodes.get(id) === node) nodes.delete(id);
  };
}

/** A closed window's outline shrinks and fades where it was drawn. */
export function bindGhost(node: NodeMirror) {
  const opts = { dur: slowed(GHOST_MS), easing: "linear" } as const;
  animate(node, "scaleX", POP, opts);
  animate(node, "scaleY", POP, opts);
  animate(node, "opacity", 0, opts);
}

/** Runs a change to the windows, lets the readers know and moves the windows. */
export function act<T>(change: (manager: WindowManager) => T): T {
  const now = Date.now();
  const ws = wm.active;
  const before = new Map(wm.placements().map((p) => [p.id, drawn(p.id, now, p)]));
  const out = change(wm);
  setRev((r) => r + 1);
  const placed = wm.placements();
  if (wm.active !== ws) {
    // the side the new workspace lies on, the short way round
    let delta = wm.active - ws;
    if (delta > WORKSPACES / 2) delta -= WORKSPACES;
    if (delta < -WORKSPACES / 2) delta += WORKSPACES;
    const dx = delta > 0 ? SLIDE : -SLIDE;
    for (const p of placed) {
      const from = before.get(p.id)?.rect ?? { ...p.rect, x: p.rect.x + dx };
      startMotion(p.id, { from, fromAlpha: before.has(p.id) ? 1 : 0, to: p.rect, toAlpha: p.hidden ? 0 : 1, start: now });
    }
  } else {
    for (const p of placed) {
      const toAlpha = p.hidden ? 0 : 1;
      const was = before.get(p.id);
      const m = motions.get(p.id);
      if (!was) startMotion(p.id, { from: shrink(p.rect, POP), fromAlpha: 0, to: p.rect, toAlpha, start: now });
      else if (!m || !sameRect(m.to, p.rect) || m.toAlpha !== toAlpha) startMotion(p.id, { from: was.rect, fromAlpha: was.alpha, to: p.rect, toAlpha, start: now });
    }
    const live = new Set(placed.map((p) => p.id));
    const gone: Ghost[] = [];
    for (const [id, was] of before) if (!live.has(id) && was.alpha > 0.05) gone.push({ key: ++ghostKey, rect: was.rect });
    if (gone.length) {
      setGhosts((g) => [...g, ...gone]);
      after(slowed(GHOST_MS) / 1000 + 0.05, () => setGhosts((g) => g.filter((x) => !gone.includes(x))));
    }
  }
  for (const id of [...motions.keys()]) if (!wm.windows.has(id)) motions.delete(id);
  return out;
}

const read = <T>(get: (manager: WindowManager) => T) => () => {
  rev();
  return get(wm);
};

/** Tracks every change to the windows. */
export const revision = rev;
/** The current workspace, 0 to 4. */
export const current = read((m) => m.active);
/** The focused window on the current workspace. */
export const focused = read((m) => m.focused());
export const placements = read((m) => m.placements());
export const layout = read((m) => m.layout());
export const occupied = (ws: number) => read((m) => m.occupied(ws))();
export const fullscreen = read((m) => m.fullscreen());
/** Every window on the current workspace. */
export const visibleWindows = read((m) => m.order().map((id) => m.windows.get(id)!));
export const windowById = (id: number) => wm.windows.get(id) ?? null;
/** The windows of workspace `ws`, in layout order. */
export const windowsOn = (ws: number) => read((m) => m.order(ws).map((id) => m.windows.get(id)!))();
export const windowAt = (x: number, y: number) => wm.windowAt(x, y);
export const splitAt = (x: number, y: number, tolerance: number) => wm.splitAt(x, y, tolerance);
export const takeClosed = () => wm.closed.pop() ?? null;
export const barPosition = read((m) => m.bar);

export function find(match: (w: Win) => boolean): Win | null {
  return wm.find(match);
}

export function open(content: Content): number {
  return act((m) => m.open(content));
}

export function closeWindow(id: number) {
  act((m) => m.close(id));
}

export function focusWindow(id: number) {
  act((m) => m.focusWin(id));
}

export function focus(ws: number) {
  act((m) => m.switchWs(ws));
}

export function step(delta: number) {
  act((m) => m.stepWs(delta));
}
