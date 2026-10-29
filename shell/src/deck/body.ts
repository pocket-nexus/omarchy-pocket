// What the deck's body shows, after Pocket Shell's 3DS deck: the live map of
// the stage unless something asks for it. In order:
//
//   chords     a shoulder is held, or a pill latched: the layer's chord card
//   remote     a card is up on the stage (Omarchy's menu, a bar panel, the
//              theme picker): its remote (deck/remote.tsx)
//   keys       the keyboard, for a window that takes keys (the strip's Keys)
//   controls   the focused window's remote (the strip's middle segment,
//              SELECT, a second tap on the window in the map): an applet's
//              touchpad and the stage's pointer, a terminal's keyboard, an
//              app's own controls
//   map        the minimap
import { createSignal } from "solid-js";

export type Body = "map" | "controls" | "keys";

const [body, setBody] = createSignal<Body>("map");

export { body, setBody };

export function toggleBody(next: Exclude<Body, "map">) {
  setBody((b) => (b === next ? "map" : next));
}
