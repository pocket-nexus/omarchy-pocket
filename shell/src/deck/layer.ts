// The chord layer the deck shows: the one the shoulders hold, else the one
// the strip's L1/R1 pills give it. A finger on a pill holds that layer as
// the shoulder does, and the layer goes with the finger; a quick tap that
// ran no chord latches it for the next action. The latch lets go when a
// chord runs, when the pill is tapped again, and when anything else on the
// deck is tapped (app.tsx), so a pill leaves nothing behind once its finger
// is gone.
import { createSignal } from "solid-js";
import type { Layer } from "../chords.ts";

const [held, setHeld] = createSignal<Layer>("plain");
const [touched, setTouchedRaw] = createSignal({ l: false, r: false });
const [latched, setLatched] = createSignal({ l: false, r: false });

export { setHeld };

const layerOf = (l: boolean, r: boolean): Layer => (l && r ? "workspace" : l ? "window" : r ? "move" : "plain");

/** The layer in force: held shoulders win over the pills. */
export const layer = (): Layer => {
  if (held() !== "plain") return held();
  const t = touched();
  const p = latched();
  return layerOf(t.l || p.l, t.r || p.r);
};

/** The pills that show lit: latched or under a finger. */
export const pills = () => {
  const t = touched();
  const p = latched();
  return { l: t.l || p.l, r: t.r || p.r };
};

/** whether a chord ran while a finger was on a pill */
let used = false;

/** Once per frame: the pills under a finger. */
export function setTouched(next: { l: boolean; r: boolean }) {
  const now = touched();
  if (next.l === now.l && next.r === now.r) return;
  if (!now.l && !now.r) used = false;
  setTouchedRaw(next);
}

/** A pill's finger lifted after `frames` frames: a quick tap that ran no
 *  chord latches it (or lets a latched one go). */
export function pillLifted(side: "l" | "r", frames: number, quick: number) {
  if (used || frames > quick) return;
  setLatched((p) => ({ ...p, [side]: !p[side] }));
}

export const latchedAny = () => latched().l || latched().r;

/** A chord ran, or the deck was tapped elsewhere: the pills let go, as a modifier key does. */
export function releasePills() {
  used = true;
  if (latchedAny()) setLatched({ l: false, r: false });
}
