// The gamepad's window grammar as one table. Omarchy binds every window
// action to SUPER plus one key and lists them all on SUPER + K; here the
// shoulders are the modifiers:
//
//   L1 held        window      act on the focused window (SUPER)
//   R1 held        move        move it, and the session's verbs (SUPER + SHIFT)
//   L1 + R1 held   workspace   the D-pad steps workspaces and carries windows
//   neither        plain       L2/R2 step workspaces, Start opens the Omarchy
//                              menu, Select the launcher; the other buttons
//                              belong to the focused window
//
// The dispatcher (app.tsx), the deck's chord map and the key sheet read this
// table, so a label cannot describe what its button does not do. The L1 and
// R1 pills on the deck latch a layer for one action, and the map's rows are
// tap targets, so every chord is also a touch.
import { BTN } from "@pocketjs/framework/input";

export type Layer = "plain" | "window" | "move" | "workspace";

export type Action =
  | "focus.left" | "focus.right" | "focus.up" | "focus.down"
  | "swap.left" | "swap.right" | "swap.up" | "swap.down"
  | "ws.prev" | "ws.next" | "carry.prev" | "carry.next"
  | "launcher" | "terminal" | "close" | "fullscreen" | "maximize" | "split"
  | "shrink" | "grow" | "keys" | "menu" | "system" | "background" | "bar" | "screenshot";

export interface Chord {
  layer: Layer;
  button: number;
  action: Action;
  /** Omarchy's binding for the same action */
  omarchy: string;
}

export const CHORDS: readonly Chord[] = [
  { layer: "window", button: BTN.LEFT, action: "focus.left", omarchy: "SUPER + ←" },
  { layer: "window", button: BTN.RIGHT, action: "focus.right", omarchy: "SUPER + →" },
  { layer: "window", button: BTN.UP, action: "focus.up", omarchy: "SUPER + ↑" },
  { layer: "window", button: BTN.DOWN, action: "focus.down", omarchy: "SUPER + ↓" },
  { layer: "window", button: BTN.CIRCLE, action: "launcher", omarchy: "SUPER + SPACE" },
  { layer: "window", button: BTN.CROSS, action: "close", omarchy: "SUPER + W" },
  { layer: "window", button: BTN.TRIANGLE, action: "fullscreen", omarchy: "SUPER + F" },
  { layer: "window", button: BTN.SQUARE, action: "split", omarchy: "SUPER + J" },
  { layer: "window", button: BTN.ZL, action: "shrink", omarchy: "SUPER + -" },
  { layer: "window", button: BTN.ZR, action: "grow", omarchy: "SUPER + =" },
  { layer: "window", button: BTN.START, action: "terminal", omarchy: "SUPER + RETURN" },
  { layer: "window", button: BTN.SELECT, action: "keys", omarchy: "SUPER + K" },

  { layer: "move", button: BTN.LEFT, action: "swap.left", omarchy: "SUPER + SHIFT + ←" },
  { layer: "move", button: BTN.RIGHT, action: "swap.right", omarchy: "SUPER + SHIFT + →" },
  { layer: "move", button: BTN.UP, action: "swap.up", omarchy: "SUPER + SHIFT + ↑" },
  { layer: "move", button: BTN.DOWN, action: "swap.down", omarchy: "SUPER + SHIFT + ↓" },
  { layer: "move", button: BTN.CIRCLE, action: "menu", omarchy: "SUPER + ALT + SPACE" },
  { layer: "move", button: BTN.CROSS, action: "system", omarchy: "SUPER + ESCAPE" },
  { layer: "move", button: BTN.TRIANGLE, action: "maximize", omarchy: "SUPER + ALT + F" },
  { layer: "move", button: BTN.SQUARE, action: "background", omarchy: "SUPER + CTRL + SPACE" },
  { layer: "move", button: BTN.ZL, action: "carry.prev", omarchy: "SUPER + SHIFT + n" },
  { layer: "move", button: BTN.ZR, action: "carry.next", omarchy: "SUPER + SHIFT + n" },
  { layer: "move", button: BTN.START, action: "bar", omarchy: "SUPER + SHIFT + SPACE" },
  { layer: "move", button: BTN.SELECT, action: "screenshot", omarchy: "PRINT" },

  { layer: "workspace", button: BTN.LEFT, action: "ws.prev", omarchy: "SUPER + n" },
  { layer: "workspace", button: BTN.RIGHT, action: "ws.next", omarchy: "SUPER + n" },
  { layer: "workspace", button: BTN.UP, action: "carry.prev", omarchy: "SUPER + SHIFT + n" },
  { layer: "workspace", button: BTN.DOWN, action: "carry.next", omarchy: "SUPER + SHIFT + n" },

  { layer: "plain", button: BTN.ZL, action: "ws.prev", omarchy: "SUPER + n" },
  { layer: "plain", button: BTN.ZR, action: "ws.next", omarchy: "SUPER + n" },
  { layer: "plain", button: BTN.START, action: "menu", omarchy: "SUPER + ALT + SPACE" },
  { layer: "plain", button: BTN.SELECT, action: "launcher", omarchy: "SUPER + SPACE" },
];

export const MODIFIERS = BTN.LTRIGGER | BTN.RTRIGGER;

export function layerOf(held: number): Layer {
  const l = (held & BTN.LTRIGGER) !== 0;
  const r = (held & BTN.RTRIGGER) !== 0;
  return l && r ? "workspace" : l ? "window" : r ? "move" : "plain";
}

export const chordsOf = (layer: Layer) => CHORDS.filter((c) => c.layer === layer);
export const chordFor = (layer: Layer, button: number) => CHORDS.find((c) => c.layer === layer && c.button === button);

export const LAYER_TITLE: Record<Layer, string> = {
  plain: "",
  window: "L1 window",
  move: "R1 move",
  workspace: "L1+R1 workspace",
};

export const LABEL: Record<Action, string> = {
  "focus.left": "focus left",
  "focus.right": "focus right",
  "focus.up": "focus up",
  "focus.down": "focus down",
  "swap.left": "swap left",
  "swap.right": "swap right",
  "swap.up": "swap up",
  "swap.down": "swap down",
  "ws.prev": "previous workspace",
  "ws.next": "next workspace",
  "carry.prev": "carry to previous",
  "carry.next": "carry to next",
  launcher: "launcher",
  terminal: "terminal",
  close: "close window",
  fullscreen: "fullscreen",
  maximize: "maximize",
  split: "toggle split",
  shrink: "shrink",
  grow: "grow",
  keys: "key sheet",
  menu: "Omarchy menu",
  system: "system menu",
  background: "next background",
  bar: "toggle bar",
  screenshot: "screenshot",
};

export const BUTTON_NAME: Record<number, string> = {
  [BTN.LEFT]: "←",
  [BTN.RIGHT]: "→",
  [BTN.UP]: "↑",
  [BTN.DOWN]: "↓",
  [BTN.CIRCLE]: "A",
  [BTN.CROSS]: "B",
  [BTN.TRIANGLE]: "X",
  [BTN.SQUARE]: "Y",
  [BTN.ZL]: "L2",
  [BTN.ZR]: "R2",
  [BTN.START]: "Start",
  [BTN.SELECT]: "Select",
};
