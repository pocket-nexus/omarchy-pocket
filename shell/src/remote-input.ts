// `omarchy-shell pocket.input hold <BUTTON> [frames]` holds a gamepad button
// for some frames (default 2) as if it were pressed on the device,
// `omarchy-shell pocket.input tap <x> <y>` taps the deck,
// `omarchy-shell pocket.input drag <x> <y> <x2> <y2> [frames] [hold]` drags a
// finger across it (after holding it still for `hold` frames) and
// `omarchy-shell pocket.input type <text>` types on the touch keyboard. They drive the shell
// over SSH for testing; the names are BTN's (UP, CIRCLE, START, ...).
import { BTN } from "@pocketjs/framework/input";
import { serve } from "./system.ts";
import { sendKey } from "./term/keyboard.tsx";

const held: { mask: number; frames: number }[] = [];
/** queued taps: each is a contact for TAP_FRAMES frames (a drag: from x,y to
 *  x2,y2 over its frames), then a lift */
const taps: { x: number; y: number; frames: number; x2?: number; y2?: number; total?: number; hold?: number }[] = [];
const TAP_FRAMES = 3;

serve("pocket.input", {
  hold: (name, frames = "2") => {
    const mask = (BTN as Record<string, number>)[name ?? ""];
    if (!mask) throw new Error(`no button ${name}`);
    held.push({ mask, frames: Math.max(1, Number(frames) || 2) });
    return "ok";
  },
  tap: (x, y) => (taps.push({ x: Number(x), y: Number(y), frames: TAP_FRAMES + 1 }), "ok"),
  drag: (x, y, x2, y2, frames = "20", hold = "0") => {
    const total = Math.max(4, Number(frames) || 20);
    const still = Math.max(0, Number(hold) || 0);
    taps.push({ x: Number(x), y: Number(y), x2: Number(x2), y2: Number(y2), frames: still + total + 1, total, hold: still });
    return "ok";
  },
  /** text typed on the touch keyboard: into the terminal, the lock or a password field */
  type: (text) => {
    for (const ch of text ?? "") sendKey(ch);
    return "ok";
  },
});

/** The buttons held for this frame. */
export function remoteButtons(): number {
  let mask = 0;
  for (const h of held) if (h.frames-- > 0) mask |= h.mask;
  for (let i = held.length - 1; i >= 0; i--) if (held[i]!.frames <= 0) held.splice(i, 1);
  return mask;
}

/** This frame's contact on the deck from a queued tap: a few frames down,
 *  then one frame up (null) before the next tap starts. */
export function remoteContact(): { x: number; y: number } | null {
  const tap = taps[0];
  if (!tap) return null;
  tap.frames--;
  if (tap.frames <= 0) {
    taps.shift();
    return null;
  }
  if (tap.total === undefined) return tap;
  const t = Math.max(0, Math.min(1, (tap.total - tap.frames) / (tap.total - 1)));
  return { x: tap.x + (tap.x2! - tap.x) * t, y: tap.y + (tap.y2! - tap.y) * t };
}
