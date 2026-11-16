// SUPER on the ClockworkPi uConsole. Its controls sit in one row under the
// panel (the D-pad and L/R under the left thumb, the trackball and A B X Y
// under the right), with the keyboard under them; START, on the keyboard's
// top row, sits by the middle, where either thumb reaches it. START is the
// keyboard's SUPER key, as the Windows key is on a laptop:
//
//   tapped   Omarchy's menu, or away again (app.tsx)
//   held     SUPER for as long as it is down: the other thumb presses the
//            control (the right thumb holds START for the D-pad, the left
//            for A B X Y and the ball), and letting go leaves nothing on
//
// Nothing latches and nothing counts taps: a control means one thing under
// SUPER and one without it. The keyboard's own SUPER (Fn + Alt, which the
// keyboard sends as Cmd) is SUPER while it is down as START is. L and R stay
// the mouse's buttons.
//
// Held a moment, SUPER draws the controls row along the stage's bottom edge
// with what each does (stage/controls.tsx); let go then with nothing pressed,
// START does nothing (the row was a look, not a tap). SELECT tapped on its
// own (the keyboard's firmware makes the trackball a wheel while SELECT is
// held) shows the row for the controls without SUPER, and any key puts it
// away.
import { createSignal } from "solid-js";
import type { Layer } from "./chords.ts";
import { onEvent } from "./bridge.ts";

/** Frames START or Cmd is held before the controls row shows; START let go
 *  sooner with nothing pressed is a tap. */
export const LEGEND_FRAMES = 18;

const [startDown, setStartDown] = createSignal(false);
const [heldFrames, setHeldFrames] = createSignal(0);
/** the keyboard's modifiers as they are held (host/src/uconsole.rs sends their presses and releases) */
const [mods, setMods] = createSignal({ shift: false, ctrl: false, alt: false, meta: false });
const [help, setHelp] = createSignal(false);
/** something was done while START was down: its release is no tap */
let chorded = false;

export { mods as keyboardMods };

/** "window" while START or Cmd is held (SUPER), "plain" otherwise: a
 *  function of the signals, so whatever reads it tracks them. */
export function superLayer(): Layer {
  return startDown() || mods().meta ? "window" : "plain";
}

/** The controls row shows: SUPER after a moment, the plain controls while
 *  SELECT's help is up. */
export const legendShown = (): Layer | null => {
  if (superLayer() !== "plain") return heldFrames() >= LEGEND_FRAMES ? "window" : null;
  return help() ? "plain" : null;
};

/** Once a frame: how long SUPER has been held. */
export function superTick() {
  const held = startDown() || mods().meta;
  setHeldFrames(held ? heldFrames() + 1 : 0);
}

export function startPressed() {
  setStartDown(true);
  chorded = false;
  setHelp(false);
}

/** START up: "tap" when it went down and up again before the controls row
 *  showed, with nothing pressed while it was down. */
export function startReleased(): "tap" | "held" {
  const tap = !chorded && heldFrames() < LEGEND_FRAMES;
  setStartDown(false);
  setHeldFrames(0);
  return tap ? "tap" : "held";
}

/** A modifier key went down or up on the keyboard. */
export function setModifier(name: string, down: boolean) {
  const key = ({ Shift: "shift", Control: "ctrl", Alt: "alt", Meta: "meta" } as const)[name as "Shift"];
  if (!key) return;
  setMods({ ...mods(), [key]: down });
}

/** Something was pressed or rolled while START was down: its release is no tap. */
export function used() {
  chorded = true;
}

/** The panel is dark (the power key, daemon/uconsole.ts): the key or roll
 *  that lights it does nothing else. */
const [dark, setDark] = createSignal(false);
export { dark as panelDark };
onEvent((event) => {
  if (event.event === "screen") setDark(event.dark);
});

/** SELECT tapped alone: the controls row for the plain controls, or away. */
export const toggleHelp = () => setHelp((h) => !h);
/** Puts the help row away; true when it was up. */
export function closeHelp(): boolean {
  const was = help();
  setHelp(false);
  return was;
}
