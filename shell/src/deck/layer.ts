// The chord layer the deck shows: the one the shoulders hold, else the one
// the strip's L1/R1 pills latched for the next action.
import { createSignal } from "solid-js";
import type { Layer } from "../chords.ts";

const [held, setHeld] = createSignal<Layer>("plain");
const [latched, setLatched] = createSignal({ l: false, r: false });

export { setHeld };

export const latchedLayer = (): Layer => {
  const { l, r } = latched();
  return l && r ? "workspace" : l ? "window" : r ? "move" : "plain";
};

/** The layer in force: held shoulders win over latched pills. */
export const layer = (): Layer => (held() !== "plain" ? held() : latchedLayer());

export const pills = latched;

export function togglePill(side: "l" | "r") {
  setLatched((p) => ({ ...p, [side]: !p[side] }));
}

/** After a latched chord ran: the pills let go, as a modifier key does. */
export function releasePills() {
  setLatched({ l: false, r: false });
}
