// `omarchy-shell pocket.input hold <BUTTON> [frames]` holds a gamepad button
// for some frames (default 2) as if it were pressed on the device,
// `omarchy-shell pocket.input tap <x> <y>` taps the deck and
// `omarchy-shell pocket.input type <text>` types into the active terminal. They drive the shell
// over SSH for testing; the names are BTN's (UP, CIRCLE, START, ...).
import { BTN } from "@pocketjs/framework/input";
import { request } from "./bridge.ts";
import { serve } from "./system.ts";
import { active } from "./term/store.ts";

const held: { mask: number; frames: number }[] = [];
/** queued taps: each is a contact for TAP_FRAMES frames, then a lift */
const taps: { x: number; y: number; frames: number }[] = [];
const TAP_FRAMES = 3;

serve("pocket.input", {
  hold: (name, frames = "2") => {
    const mask = (BTN as Record<string, number>)[name ?? ""];
    if (!mask) throw new Error(`no button ${name}`);
    held.push({ mask, frames: Math.max(1, Number(frames) || 2) });
    return "ok";
  },
  tap: (x, y) => (taps.push({ x: Number(x), y: Number(y), frames: TAP_FRAMES + 1 }), "ok"),
  /** text into the active terminal, as if typed */
  type: (text) => {
    const sid = active();
    if (sid === null) throw new Error("no terminal");
    void request({ method: "termInput", sid, text: text ?? "" });
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
  return tap;
}
