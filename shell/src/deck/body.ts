// What the deck's body shows, after Pocket Shell's 3DS deck: the live map of
// the stage unless something asks for it. In order:
//
//   chords     a shoulder is held, or a pill latched: the layer's chord card
//   picker     the theme picker (Appearance › Theme)
//   panel      a bar indicator's panel, opened from the strip or `summon`
//   menu       Omarchy's menu (L1 + A, the dock's first cell); B closes it
//   controls   the focused window's keyboard or touch controls (SELECT, the
//              dock's keyboard cell, a second tap on the window in the map)
//   map        the minimap
import { createSignal } from "solid-js";

export type Body = "map" | "menu" | "controls";

const [body, setBody] = createSignal<Body>("map");

export { body, setBody };

export function toggleBody(next: Exclude<Body, "map">) {
  setBody((b) => (b === next ? "map" : next));
}
