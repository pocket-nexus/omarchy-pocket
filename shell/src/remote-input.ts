// `omarchy-shell pocket.input hold <BUTTON> [frames]` holds a gamepad button
// for some frames (default 2) as if it were pressed on the device, and
// `omarchy-shell pocket.input tap <x> <y>` taps the deck. They drive the shell
// over SSH for testing; the names are BTN's (UP, CIRCLE, START, ...).
import { BTN } from "@pocketjs/framework/input";
import { serve } from "./system.ts";

const held: { mask: number; frames: number }[] = [];
const taps: { x: number; y: number }[] = [];

serve("pocket.input", {
  hold: (name, frames = "2") => {
    const mask = (BTN as Record<string, number>)[name ?? ""];
    if (!mask) throw new Error(`no button ${name}`);
    held.push({ mask, frames: Math.max(1, Number(frames) || 2) });
    return "ok";
  },
  tap: (x, y) => (taps.push({ x: Number(x), y: Number(y) }), "ok"),
});

/** The buttons held for this frame. */
export function remoteButtons(): number {
  let mask = 0;
  for (const h of held) if (h.frames-- > 0) mask |= h.mask;
  for (let i = held.length - 1; i >= 0; i--) if (held[i]!.frames <= 0) held.splice(i, 1);
  return mask;
}

/** The next queued tap on the deck, if any. */
export const remoteTap = () => taps.shift();
