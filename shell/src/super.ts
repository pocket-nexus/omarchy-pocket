// SUPER on the ClockworkPi uConsole. The uConsole has no shoulders: its
// controls sit in one row under the panel, held by both thumbs (the D-pad,
// then L and R, then the trackball, then A B X Y), with the keyboard under
// them. A thumb cannot hold a modifier and press the D-pad beside it, so
// START, on the keyboard's top row under the left thumb, is SUPER both ways:
//
//   held     the window layer while it is down, for a chord with the other
//            thumb (START + A opens the menu) or a key (START + W closes)
//   tapped   the window layer stays until something is done with it: a
//            second tap turns it to the move layer (SUPER + SHIFT), a third
//            lets it go, and so do Escape and a verb (menu, close, ...);
//            the D-pad's steps keep it, so focus can walk window to window
//
// The keyboard's own SUPER (Fn + Alt, which the keyboard sends as Cmd) holds
// the window layer as START does, and Shift turns either to the move layer,
// as on Omarchy. L and R stay the mouse's buttons under every layer.
//
// While a layer is latched, or held for LEGEND_FRAMES, the stage draws the
// controls row along its bottom edge with what each does (stage/controls.tsx).
// SELECT tapped on its own (the keyboard's firmware makes the trackball a
// wheel while SELECT is held) shows that row for the plain layer, and any
// key puts it away.
import { createSignal } from "solid-js";
import type { Layer } from "./chords.ts";
import { onEvent } from "./bridge.ts";

/** Frames START or Cmd is held before the legend shows: a chord pressed at
 *  once never sees it, as the RG DS Plus's shoulders. */
export const LEGEND_FRAMES = 14;

type Latch = "window" | "move" | null;
const [latched, setLatched] = createSignal<Latch>(null);
const [startDown, setStartDown] = createSignal(false);
const [heldFrames, setHeldFrames] = createSignal(0);
/** the keyboard's modifiers as they are held (host/src/uconsole.rs sends their presses and releases) */
const [mods, setMods] = createSignal({ shift: false, ctrl: false, alt: false, meta: false });
const [help, setHelp] = createSignal(false);
/** something was done while START was down: its release latches nothing */
let chorded = false;

export { mods as keyboardMods, latched };

/** The layer in force for the D-pad, A B X Y and the keyboard: a function
 *  of the signals, so whatever reads it tracks them. */
export function superLayer(): Layer {
  const m = mods();
  const latch = latched();
  if (latch) return latch === "move" || m.shift ? "move" : "window";
  if (startDown() || m.meta) return m.shift ? "move" : "window";
  return "plain";
}

/** How the layer came: tapped (latched), held, or none. */
export const superHow = (): "latched" | "held" | "none" => (latched() ? "latched" : superLayer() === "plain" ? "none" : "held");

/** The legend row shows: a latched layer at once, a held one after a
 *  moment, the plain layer while SELECT's help is up. */
export const legendShown = (): Layer | null => {
  const layer = superLayer();
  if (layer !== "plain") return latched() || heldFrames() >= LEGEND_FRAMES ? layer : null;
  return help() ? "plain" : null;
};

/** Once a frame: how long the layer has been held. */
export function superTick() {
  const held = startDown() || mods().meta;
  setHeldFrames(held ? heldFrames() + 1 : 0);
}

export function startPressed() {
  setStartDown(true);
  chorded = false;
  setHelp(false);
}

/** START up: a tap with nothing done under it turns the latch, unless
 *  `latch` is false (a game has focus, and hears the tap as START). */
export function startReleased(latch = true): "tap" | "chord" {
  setStartDown(false);
  if (chorded) return "chord";
  if (latch) setLatched(latched() === null ? "window" : latched() === "window" ? "move" : null);
  return "tap";
}

/** A modifier key went down or up on the keyboard. */
export function setModifier(name: string, down: boolean) {
  const key = ({ Shift: "shift", Control: "ctrl", Alt: "alt", Meta: "meta" } as const)[name as "Shift"];
  if (!key) return;
  setMods({ ...mods(), [key]: down });
}

/** Something was done under the layer: a step (focus, swap, a workspace
 *  step) keeps a latched layer, anything else lets it go. */
export function used(kind: "step" | "verb") {
  chorded = true;
  if (kind === "verb") setLatched(null);
}

/** Lets a latched layer go; true when there was one. */
export function unlatch(): boolean {
  const was = latched() !== null;
  setLatched(null);
  return was;
}

/** The panel is dark (the power key, daemon/uconsole.ts): the key or roll
 *  that lights it does nothing else. */
const [dark, setDark] = createSignal(false);
export { dark as panelDark };
onEvent((event) => {
  if (event.event === "screen") setDark(event.dark);
});

/** SELECT tapped alone: the controls row for the plain layer, or away. */
export const toggleHelp = () => setHelp((h) => !h);
/** Puts the help row away; true when it was up. */
export function closeHelp(): boolean {
  const was = help();
  setHelp(false);
  return was;
}
