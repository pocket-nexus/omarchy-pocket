// A painted target's pressed look. A button reports its own press; a target
// on the panel has to say so, so every one lights while a finger is on it
// and for a few frames after the lift, which keeps a quick tap visible.
// Targets are `band:key` strings, so one signal covers the strip, the dock,
// the chord card and the map.
import { createSignal } from "solid-js";

const LINGER = 5;
const [lit, setLit] = createSignal<string | null>(null);
let linger = 0;

export const pressed = (target: string) => lit() === target;

/** Once per frame: the target under the oldest finger, or null when none is down. */
export function pressAt(target: string | null) {
  if (target !== null) {
    linger = LINGER;
    if (lit() !== target) setLit(target);
  } else if (lit() !== null && --linger <= 0) setLit(null);
}

/** A target that acted on the lift keeps its look for the linger. */
export function flash(target: string) {
  linger = LINGER;
  setLit(target);
}
