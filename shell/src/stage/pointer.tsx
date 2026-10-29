// The pointer on the stage, which the deck's touchpad moves (deck/touchpad.tsx).
// The stage takes no touch, so a click lands where the pointer is: on the
// card, a tap on its row (outside the card, the card closes); on the bar, a
// workspace number or an indicator's panel; on a window, focus, and for an
// applet a touch on its surface at that point (packages.ts fitSurface gives
// the scale its window draws it at).
//
// A touch held on an applet has a point of its own. A drag (the Hold key and
// a finger) moves it with the pointer; a scroll (two fingers) moves it by the
// fingers' travel while the pointer stays, so the list under the pointer
// scrolls and the pointer does not. The pointer moves on paint-only
// translates and fades in and out with the touchpad.
import { createEffect, on } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { glide, place } from "../motion.ts";
import { appletFit } from "../packages.ts";
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
let x = 256;
let y = 192;
let node: NodeMirror | undefined;

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

function barClick(px: number) {
  for (let n = 0; n < WORKSPACES; n++) if (px >= 22 + n * 14 && px < 36 + n * 14) return focus(n);
  const at = Math.floor((512 - 8 - px) / SLOT);
  if (px < 512 - 8 && at >= 0 && at < INDICATORS.length) showPanel(INDICATORS[at]!);
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
  place(node, "translateX", x);
  place(node, "translateY", y);
}

/** A scroll's travel: the held touch moves, the pointer stays. */
export function scrollBy(dx: number, dy: number) {
  if (touch?.held && !touch.follow) {
    touch.at.x += dx;
    touch.at.y += dy;
  }
}

/** A click at the pointer. */
export function click() {
  if (card()) {
    if (!onCard(x, y)) return closeCard();
    const at: Contact = { id: 1, x: x - CARD_X, y: y - CARD_Y, frames: 2, start: { x: x - CARD_X, y: y - CARD_Y }, dx: 0, dy: 0, moved: false };
    return cardTouch({ raw: 0, down: [], taps: [at] } satisfies TouchFrame);
  }
  const top = state()?.bar?.position === "bottom" ? 384 - BAR_H : 0;
  if (!state()?.bar?.hidden && y >= top && y < top + BAR_H) return barClick(x);
  const id = windowAt(x, y);
  if (id === null) return;
  focusWindow(id);
  const target = appletPoint(x, y);
  if (target) touch = { app: target.app, frames: 3, held: false, follow: false, at: { x, y } };
}

/** A drag (`follow`: the touch moves with the pointer) or a scroll (the
 *  fingers move it) starts at the pointer (true), or ends. */
export function hold(down: boolean, follow = true) {
  if (!down) {
    if (touch?.held) touch = null;
    return;
  }
  const id = windowAt(x, y);
  if (id !== null) focusWindow(id);
  const target = appletPoint(x, y);
  touch = target ? { app: target.app, frames: 0, held: true, follow, at: { x, y } } : null;
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
  createEffect(on(props.shown, (shown) => glide(node, "opacity", shown ? 1 : 0, 140), { defer: true }));
  return (
    <View class="absolute left-0 top-0 w-[20] h-[24]" style={{ translateX: x, translateY: y, opacity: 0 }} ref={(n: NodeMirror) => (node = n)}>
      <Text class="absolute left-[-3] top-[-2] text-xl leading-[24]" style={{ textColor: color("background") }}>{"\u{f01c0}"}</Text>
      <Text class="absolute left-[-3] top-[-2] text-xl leading-[24]" style={{ textColor: color("bright_foreground") }}>{"\u{f01bf}"}</Text>
    </View>
  );
}
