// The pointer on the stage, which the deck's touchpad moves (deck/touchpad.tsx),
// after iPadOS's adaptive pointer. The stage takes no touch, so a click lands
// where the pointer is: on the card, a tap on its row (outside the card, the
// card closes); on the bar, a workspace number or an indicator's panel; on a
// window, focus, and for an applet a touch on its surface at that point
// (packages.ts fitSurface gives the scale its window draws it at).
//
// The pointer knows what it is over. An applet's page lists its rows and
// buttons (packages.ts appletTargets) and the bar has its workspace numbers
// and indicators. The pointer takes the target it is on, or the nearest one
// within ATTRACT points, and keeps it until it is LEAVE points past that
// target's edge. On a target the pointer is the target's highlight: the box
// moves onto it by FLIP on the core's tracks, the dot fades, the box leans
// a tenth of the way toward the finger, and a click lands at the target's
// centre, so a press needs no exact aim.
//
// A touch held on an applet has a point of its own. A drag (the Hold key and
// a finger) moves it with the pointer, from where the press began (the
// target's centre when the pointer was on one); a scroll (two fingers) moves
// it by the fingers' travel while the pointer stays, so the list under the
// pointer scrolls and the pointer does not. The pointer fades in and out
// with the touchpad.
import { createEffect, createSignal, on } from "solid-js";
import { View, type NodeMirror } from "@pocketjs/framework/components";
import { flip, glide, place, TOP_LEFT, type Box } from "../motion.ts";
import { appletFit, appletTargets } from "../packages.ts";
import { state } from "../system.ts";
import { color } from "../theme.ts";
import type { Contact, TouchFrame } from "../touch.ts";
import { BORDER } from "../wm.ts";
import { focus, focusWindow, placements, windowAt, windowById, WORKSPACES } from "../workspaces.ts";
import { card, cardTouch, closeCard, onCard } from "./card.tsx";
import { CARD_X, CARD_Y } from "./geometry.ts";
import { showPanel, type PanelName } from "./panels.tsx";
import { HEADER_H } from "./windows.tsx";

const BAR_H = 18;
const DOT = 12;
/** points from a target's edge that pull the pointer onto it, and that it travels past to leave */
const ATTRACT = 10;
const LEAVE = 14;
/** the highlight's margin around its target, and how far it leans toward the finger */
const PAD = 2;
const PARALLAX = 0.1;
const LEAN = 3;
/** a target over this share of its surface is a page, not a control */
const PAGE_SHARE = 0.5;

let x = 256;
let y = 192;
let dot: NodeMirror | undefined;
let lean: NodeMirror | undefined;
let box: NodeMirror | undefined;

/** the target the pointer is on, in stage points */
const [snap, setSnap] = createSignal<Box | null>(null);
/** where the highlight box is laid out: the last target */
const [boxAt, setBoxAt] = createSignal<Box>({ x: 0, y: 0, w: DOT, h: DOT });

export const pointer = () => ({ x, y });

/** An applet window's touch surface on the stage: its origin, scale and size. */
interface Surface {
  app: number;
  ox: number;
  oy: number;
  k: number;
  w: number;
  h: number;
}

function surfaceOf(id: number | null): Surface | null {
  const win = id === null ? null : windowById(id);
  if (!win || win.kind !== "app" || !win.appletSurface) return null;
  const rect = placements().find((p) => p.id === id)?.rect;
  const fit = appletFit(win.app);
  if (!rect || !fit) return null;
  const cw = rect.w - 2 * BORDER;
  const ch = rect.h - 2 * BORDER - HEADER_H;
  const k = Math.min(cw / fit.w, ch / fit.h, 1);
  return { app: win.app, ox: rect.x + BORDER + (cw - fit.w * k) / 2, oy: rect.y + BORDER + HEADER_H + (ch - fit.h * k) / 2, k, w: fit.w, h: fit.h };
}

function surfaceOfApp(app: number): Surface | null {
  const at = placements().find((p) => {
    const w = windowById(p.id);
    return w?.kind === "app" && w.app === app;
  });
  return at ? surfaceOf(at.id) : null;
}

/** Where stage point (px, py) lands on an applet's surface, if on one. */
function appletPoint(px: number, py: number): { app: number; x: number; y: number } | null {
  const s = surfaceOf(windowAt(px, py));
  if (!s) return null;
  const sx = (px - s.ox) / s.k;
  const sy = (py - s.oy) / s.k;
  return sx >= 0 && sx < s.w && sy >= 0 && sy < s.h ? { app: s.app, x: sx, y: sy } : null;
}

/** the bar's indicators from the right edge, as stage/bar.tsx lays them out */
const INDICATORS: PanelName[] = ["power", "audio", "network", "bluetooth", "proxy"];
const SLOT = 20;
const barTop = () => (state()?.bar?.position === "bottom" ? 384 - BAR_H : 0);
const barShown = () => !state()?.bar?.hidden;

function barClick(px: number) {
  for (let n = 0; n < WORKSPACES; n++) if (px >= 22 + n * 14 && px < 36 + n * 14) return focus(n);
  const at = Math.floor((512 - 8 - px) / SLOT);
  if (px < 512 - 8 && at >= 0 && at < INDICATORS.length) showPanel(INDICATORS[at]!);
}

/** The targets near the pointer, in stage points: the bar's, and the page's
 *  of the applet under it, cut to what its window shows. */
function targetsNear(): Box[] {
  const out: Box[] = [];
  const top = barTop();
  if (barShown() && y < top + BAR_H + LEAVE && y >= top - LEAVE) {
    for (let n = 0; n < WORKSPACES; n++) out.push({ x: 22 + n * 14, y: top, w: 14, h: BAR_H });
    for (let i = 0; i < INDICATORS.length; i++) out.push({ x: 512 - 8 - (i + 1) * SLOT, y: top, w: SLOT, h: BAR_H });
  }
  const s = surfaceOf(windowAt(x, y));
  if (!s) return out;
  const right = s.ox + s.w * s.k;
  const bottom = s.oy + s.h * s.k;
  for (const t of appletTargets(s.app)) {
    if (t.w * t.h > PAGE_SHARE * s.w * s.h) continue;
    const bx = Math.max(s.ox, s.ox + t.x * s.k);
    const by = Math.max(s.oy, s.oy + t.y * s.k);
    const w = Math.min(right, s.ox + (t.x + t.w) * s.k) - bx;
    const h = Math.min(bottom, s.oy + (t.y + t.h) * s.k) - by;
    if (w > 1 && h > 1) out.push({ x: bx, y: by, w, h });
  }
  return out;
}

/** The pointer's distance from a box's edge, 0 inside it. */
const edge = (b: Box) => Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));
/** The same target after its page moved (a list scrolled under the pointer). */
const alike = (a: Box, b: Box) => Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1 && Math.hypot(a.x - b.x, a.y - b.y) < 40;
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const padded = (b: Box): Box => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD });

function setTarget(next: Box | null) {
  const was = snap();
  if (!next) {
    if (!was) return;
    setSnap(null);
    glide(box, "opacity", 0, 110);
    glide(dot, "opacity", 1, 90);
    place(lean, "translateX", 0);
    place(lean, "translateY", 0);
    return;
  }
  if (was && same(was, next)) return;
  const from = was ?? { x: x - DOT / 2, y: y - DOT / 2, w: DOT, h: DOT };
  setSnap(next);
  setBoxAt(next);
  // a target its list carried follows at once; a new one is reached by a glide
  const carried = was !== null && alike(was, next);
  if (box) flip(box, padded(from), padded(next), was ? 1 : 0.3, 1, carried ? 40 : 140);
  glide(dot, "opacity", 0, 90);
}

/** Once per frame while the pointer shows: the target it is on, and the lean. */
export function trackPointer() {
  if (touch?.held) return setTarget(null);
  const boxes = targetsNear();
  let next: Box | null = null;
  // the last box holding the pointer wins, as the page's own hit test does
  for (const b of boxes) if (edge(b) === 0) next = b;
  const was = snap();
  if (!next && was) {
    const kept = boxes.find((b) => alike(b, was));
    if (kept && edge(kept) <= LEAVE) next = kept;
  }
  if (!next) {
    let best = ATTRACT;
    for (const b of boxes) {
      const d = edge(b);
      if (d <= best) {
        best = d;
        next = b;
      }
    }
  }
  setTarget(next);
  const s = snap();
  if (s) {
    place(lean, "translateX", Math.max(-LEAN, Math.min(LEAN, (x - (s.x + s.w / 2)) * PARALLAX)));
    place(lean, "translateY", Math.max(-LEAN, Math.min(LEAN, (y - (s.y + s.h / 2)) * PARALLAX)));
  }
}

/** A touch the pointer holds on an applet at stage point `at`: down while
 *  `frames` last (a click) or while held (a drag, `follow`ing the pointer,
 *  or a scroll, moved by the fingers). */
let touch: { app: number; frames: number; held: boolean; follow: boolean; at: { x: number; y: number } } | null = null;

export function movePointer(dx: number, dy: number) {
  const nx = Math.max(0, Math.min(511, x + dx));
  const ny = Math.max(0, Math.min(383, y + dy));
  if (touch?.held && touch.follow) {
    touch.at.x += nx - x;
    touch.at.y += ny - y;
  }
  x = nx;
  y = ny;
  place(dot, "translateX", x - DOT / 2);
  place(dot, "translateY", y - DOT / 2);
}

/** A scroll's travel: the held touch moves, the pointer stays. */
export function scrollBy(dx: number, dy: number) {
  if (touch?.held && !touch.follow) {
    touch.at.x += dx;
    touch.at.y += dy;
  }
}

/** Where a press lands: the target's centre, else the pointer. */
const aim = () => {
  const s = snap();
  return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x, y };
};

/** A click at the pointer. */
export function click() {
  const p = aim();
  if (card()) {
    if (!onCard(p.x, p.y)) return closeCard();
    const at: Contact = { id: 1, x: p.x - CARD_X, y: p.y - CARD_Y, frames: 2, start: { x: p.x - CARD_X, y: p.y - CARD_Y }, dx: 0, dy: 0, moved: false };
    return cardTouch({ raw: 0, down: [], taps: [at] } satisfies TouchFrame);
  }
  const top = barTop();
  if (barShown() && p.y >= top && p.y < top + BAR_H) return barClick(p.x);
  const id = windowAt(p.x, p.y);
  if (id === null) return;
  focusWindow(id);
  const target = appletPoint(p.x, p.y);
  if (target) touch = { app: target.app, frames: 3, held: false, follow: false, at: p };
}

/** A drag (`follow`: the touch moves with the pointer) or a scroll (the
 *  fingers move it) starts at the pointer (true), or ends. */
export function hold(down: boolean, follow = true) {
  if (!down) {
    if (touch?.held) touch = null;
    return;
  }
  const p = aim();
  const id = windowAt(p.x, p.y);
  if (id !== null) focusWindow(id);
  const target = appletPoint(p.x, p.y);
  touch = target ? { app: target.app, frames: 0, held: true, follow, at: { ...p } } : null;
}

/** This frame's contacts [id, x, y] for applet `app` from the pointer. A held
 *  touch stays on the surface it began on, at its edge when it travels past. */
export function pointerContacts(app: number): number[] {
  if (!touch || touch.app !== app) return [];
  if (!touch.held && --touch.frames < 0) {
    touch = null;
    return [];
  }
  const s = surfaceOfApp(app);
  if (!s) return [];
  const sx = Math.max(0, Math.min(s.w - 1, (touch.at.x - s.ox) / s.k));
  const sy = Math.max(0, Math.min(s.h - 1, (touch.at.y - s.oy) / s.k));
  return [1, sx, sy];
}

export function Pointer(props: { shown: () => boolean }) {
  let root: NodeMirror | undefined;
  createEffect(
    on(
      props.shown,
      (shown) => {
        glide(root, "opacity", shown ? 1 : 0, 140);
        if (!shown) setTarget(null);
      },
      { defer: true },
    ),
  );
  const at = () => padded(boxAt());
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ opacity: 0 }} ref={(n: NodeMirror) => (root = n)}>
      <View class="absolute left-0 top-0 w-[512] h-[384]" ref={(n: NodeMirror) => (lean = n)}>
        <View
          class="absolute rounded-md"
          style={{ insetL: at().x, insetT: at().y, width: at().w, height: at().h, bgColor: color("bright_foreground", 0.2), opacity: 0, ...TOP_LEFT }}
          ref={(n: NodeMirror) => (box = n)}
        />
      </View>
      <View class="absolute left-0 top-0 rounded-[6]" style={{ width: DOT, height: DOT, translateX: x - DOT / 2, translateY: y - DOT / 2, bgColor: color("background", 0.6) }} ref={(n: NodeMirror) => (dot = n)}>
        <View class="absolute left-[2] top-[2] w-[8] h-[8] rounded-[4]" style={{ bgColor: color("bright_foreground", 0.92) }} />
      </View>
    </View>
  );
}
