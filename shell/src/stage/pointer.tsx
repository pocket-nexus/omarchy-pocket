// The pointer on the stage, which the deck's touchpad moves (deck/touchpad.tsx).
// The stage takes no touch, so a click lands where the pointer is: on the
// card, a tap on its row (outside the card, the card closes); on the bar, a
// workspace number or an indicator's panel; on a window, focus, and for an
// applet a touch on its surface at that point (packages.ts fitSurface gives
// the scale its window draws it at). A drag holds that touch down while the
// pointer moves, which scrolls an applet's lists. The pointer moves on
// paint-only translates and fades in and out with the touchpad.
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

export function movePointer(dx: number, dy: number) {
  x = Math.max(0, Math.min(511, x + dx));
  y = Math.max(0, Math.min(383, y + dy));
  place(node, "translateX", x);
  place(node, "translateY", y);
}

/** Where stage point (px, py) lands on an applet's surface, if on one. */
function appletPoint(px: number, py: number): { app: number; x: number; y: number } | null {
  const id = windowAt(px, py);
  const win = id === null ? null : windowById(id);
  if (!win || win.kind !== "app" || !win.appletSurface) return null;
  const rect = placements().find((p) => p.id === id)?.rect;
  const fit = appletFit(win.app);
  if (!rect || !fit) return null;
  const cw = rect.w - 2 * BORDER;
  const ch = rect.h - 2 * BORDER - HEADER_H;
  const k = Math.min(cw / fit.w, ch / fit.h, 1);
  const sx = (px - rect.x - BORDER - (cw - fit.w * k) / 2) / k;
  const sy = (py - rect.y - BORDER - HEADER_H - (ch - fit.h * k) / 2) / k;
  return sx >= 0 && sx < fit.w && sy >= 0 && sy < fit.h ? { app: win.app, x: sx, y: sy } : null;
}

/** the bar's indicators from the right edge, as stage/bar.tsx lays them out */
const INDICATORS: PanelName[] = ["power", "audio", "network", "bluetooth", "proxy"];
const SLOT = 20;

function barClick(px: number) {
  for (let n = 0; n < WORKSPACES; n++) if (px >= 22 + n * 14 && px < 36 + n * 14) return focus(n);
  const at = Math.floor((512 - 8 - px) / SLOT);
  if (px < 512 - 8 && at >= 0 && at < INDICATORS.length) showPanel(INDICATORS[at]!);
}

/** A touch the pointer holds on an applet: down while `frames` last (a
 *  click) or while a drag holds it. */
let touch: { app: number; frames: number; held: boolean } | null = null;

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
  if (target) touch = { app: target.app, frames: 3, held: false };
}

/** A drag starts (true) or ends at the pointer. */
export function hold(down: boolean) {
  if (!down) {
    if (touch?.held) touch = null;
    return;
  }
  const id = windowAt(x, y);
  if (id !== null) focusWindow(id);
  const target = appletPoint(x, y);
  touch = target ? { app: target.app, frames: 0, held: true } : null;
}

/** This frame's contacts [id, x, y] for applet `app` from the pointer. */
export function pointerContacts(app: number): number[] {
  if (!touch || touch.app !== app) return [];
  const at = appletPoint(x, y);
  if (!touch.held && --touch.frames < 0) {
    touch = null;
    return [];
  }
  return at && at.app === app ? [1, at.x, at.y] : [];
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
