// The gamepad's window grammar as one table, after Pocket Shell's 3DS shell.
// Omarchy binds every window action to SUPER plus one key and lists them on
// SUPER + K; here the shoulders are the modifiers:
//
//   L1 held        window      act on the focused window (SUPER)
//   R1 held        move        the same verbs, moved: swap, maximize, spawn
//   L1 + R1 held   workspace   the D-pad steps workspaces and carries windows
//   neither        plain       the buttons are keys for what has focus
//                              (keys.ts BUTTON_KEYS); SELECT turns the
//                              deck's layout, L2/R2 step workspaces
//
// L2/R2 under a shoulder do what the 3DS's circle pad does: resize under L1,
// pan the scrolling strip under R1. The dispatcher (app.tsx), the legend
// while a shoulder is held and the key sheet read this table, so a label
// cannot describe what its button does not do. A layer lasts as long as its
// shoulder: nothing on the deck latches one.
import { BTN } from "@pocketjs/framework/input";
import type { Layout } from "./wm.ts";

export type Layer = "plain" | "window" | "move" | "workspace";

export type Action =
  | "focus.left" | "focus.right" | "focus.up" | "focus.down"
  | "swap.left" | "swap.right" | "swap.up" | "swap.down"
  | "ws.prev" | "ws.next" | "carry.prev" | "carry.next"
  | "menu" | "close" | "fullscreen" | "split" | "layout" | "keys" | "shrink" | "grow"
  | "another" | "reopen" | "maximize" | "swapsplit" | "wallpaper" | "bar" | "pan.left" | "pan.right";

export interface Chord {
  layer: Layer;
  button: number;
  action: Action;
}

export const DPAD = BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN;
/** The face buttons in the order the chord card draws them. */
export const FACE_ORDER: readonly number[] = [BTN.TRIANGLE, BTN.SQUARE, BTN.CIRCLE, BTN.CROSS];

export const CHORDS: readonly Chord[] = [
  { layer: "window", button: BTN.LEFT, action: "focus.left" },
  { layer: "window", button: BTN.RIGHT, action: "focus.right" },
  { layer: "window", button: BTN.UP, action: "focus.up" },
  { layer: "window", button: BTN.DOWN, action: "focus.down" },
  { layer: "window", button: BTN.CIRCLE, action: "menu" },
  { layer: "window", button: BTN.CROSS, action: "close" },
  { layer: "window", button: BTN.TRIANGLE, action: "fullscreen" },
  { layer: "window", button: BTN.SQUARE, action: "split" },
  { layer: "window", button: BTN.START, action: "layout" },
  { layer: "window", button: BTN.SELECT, action: "keys" },
  { layer: "window", button: BTN.ZL, action: "shrink" },
  { layer: "window", button: BTN.ZR, action: "grow" },

  { layer: "move", button: BTN.LEFT, action: "swap.left" },
  { layer: "move", button: BTN.RIGHT, action: "swap.right" },
  { layer: "move", button: BTN.UP, action: "swap.up" },
  { layer: "move", button: BTN.DOWN, action: "swap.down" },
  { layer: "move", button: BTN.CIRCLE, action: "another" },
  { layer: "move", button: BTN.CROSS, action: "reopen" },
  { layer: "move", button: BTN.TRIANGLE, action: "maximize" },
  { layer: "move", button: BTN.SQUARE, action: "swapsplit" },
  { layer: "move", button: BTN.START, action: "wallpaper" },
  { layer: "move", button: BTN.SELECT, action: "bar" },
  { layer: "move", button: BTN.ZL, action: "pan.left" },
  { layer: "move", button: BTN.ZR, action: "pan.right" },

  { layer: "workspace", button: BTN.LEFT, action: "ws.prev" },
  { layer: "workspace", button: BTN.RIGHT, action: "ws.next" },
  { layer: "workspace", button: BTN.UP, action: "carry.prev" },
  { layer: "workspace", button: BTN.DOWN, action: "carry.next" },

  { layer: "plain", button: BTN.ZL, action: "ws.prev" },
  { layer: "plain", button: BTN.ZR, action: "ws.next" },
];

export const MODIFIERS = BTN.LTRIGGER | BTN.RTRIGGER;
export const HELD_LAYERS: readonly Layer[] = ["window", "move", "workspace"];

export function layerOf(held: number): Layer {
  const l = (held & BTN.LTRIGGER) !== 0;
  const r = (held & BTN.RTRIGGER) !== 0;
  return l && r ? "workspace" : l ? "window" : r ? "move" : "plain";
}

export const chordsOf = (layer: Layer) => CHORDS.filter((c) => c.layer === layer);
export const chordFor = (layer: Layer, button: number) => CHORDS.find((c) => c.layer === layer && c.button === button);

export const LAYER_TITLE: Record<Layer, string> = {
  plain: "",
  window: "L1  window",
  move: "R1  move",
  workspace: "L1+R1  workspace",
};

/** The label a chord shows, for the layout it would act on. */
export function labelFor(action: Action, layout: Layout): string {
  switch (action) {
    case "focus.left":
    case "focus.right":
    case "focus.up":
    case "focus.down":
      return "focus window";
    case "swap.left":
    case "swap.right":
    case "swap.up":
    case "swap.down":
      return "swap window";
    case "ws.prev":
    case "ws.next":
      return "switch workspace";
    case "carry.prev":
    case "carry.next":
      return "carry window";
    case "menu":
      return "menu";
    case "close":
      return "close window";
    case "fullscreen":
      return "fullscreen";
    case "split":
      return layout === "dwindle" ? "toggle split" : "column width";
    case "layout":
      return layout === "dwindle" ? "layout: scrolling" : "layout: dwindle";
    case "keys":
      return "key sheet";
    case "shrink":
    case "grow":
      return layout === "dwindle" ? "resize" : "column width";
    case "another":
      return "another of this";
    case "reopen":
      return "reopen closed";
    case "maximize":
      return "maximize";
    case "swapsplit":
      return layout === "dwindle" ? "swap split" : "stack / unstack";
    case "wallpaper":
      return "next background";
    case "bar":
      return "toggle bar";
    case "pan.left":
    case "pan.right":
      return "pan the strip";
  }
}

/** What the D-pad does under a layer, in one line. */
export function dpadLabel(layer: Layer): string {
  switch (layer) {
    case "window":
      return "focus window";
    case "move":
      return "swap window";
    case "workspace":
      return "← → switch  ↑ ↓ carry";
    case "plain":
      return "arrows";
  }
}

/** What L2/R2 do under a layer. */
export function triggerLabel(layer: Layer, layout: Layout): string {
  switch (layer) {
    case "window":
      return layout === "dwindle" ? "shrink / grow" : "column width";
    case "move":
      return layout === "scrolling" ? "pan the strip" : "—";
    case "workspace":
      return "—";
    case "plain":
      return "switch workspace";
  }
}

export const BUTTON_NAME: Record<number, string> = {
  [BTN.CIRCLE]: "A",
  [BTN.CROSS]: "B",
  [BTN.TRIANGLE]: "X",
  [BTN.SQUARE]: "Y",
  [BTN.START]: "START",
  [BTN.SELECT]: "SELECT",
  [BTN.ZL]: "L2",
  [BTN.ZR]: "R2",
};

/** Omarchy's binding for an action, for the key sheet. */
export const OMARCHY: Partial<Record<Action, string>> = {
  "focus.left": "SUPER + arrows",
  "swap.left": "SUPER + SHIFT + arrows",
  "ws.prev": "SUPER + 1-5",
  "carry.prev": "SUPER + SHIFT + 1-5",
  menu: "SUPER + SPACE",
  close: "SUPER + W",
  fullscreen: "SUPER + F",
  split: "SUPER + J",
  layout: "SUPER + L",
  keys: "SUPER + K",
  shrink: "SUPER + - / =",
  another: "SUPER + RETURN",
  maximize: "fullscreen, 1",
  swapsplit: "swapsplit",
  wallpaper: "SUPER + CTRL + SPACE",
  bar: "SUPER + SHIFT + SPACE",
};

export interface SheetRow {
  keys: string;
  what: string;
}

/** The whole table the way SUPER + K lists it: one group per layer. */
export function keySheet(layout: Layout): { title: string; rows: SheetRow[] }[] {
  const prefix: Record<Layer, string> = { plain: "", window: "L1 +", move: "R1 +", workspace: "L1+R1" };
  const groups: { title: string; rows: SheetRow[] }[] = [];
  for (const layer of HELD_LAYERS) {
    // the sheet's value column is narrower than the deck's: the workspace row says less
    const rows: SheetRow[] = [{ keys: `${prefix[layer]} d-pad`, what: layer === "workspace" ? "switch · carry" : dpadLabel(layer) }];
    const triggers = triggerLabel(layer, layout);
    if (triggers !== "—") rows.push({ keys: `${prefix[layer]} L2/R2`, what: triggers });
    for (const chord of chordsOf(layer)) {
      if (chord.button & (DPAD | BTN.ZL | BTN.ZR)) continue;
      rows.push({ keys: `${prefix[layer]} ${BUTTON_NAME[chord.button]}`, what: labelFor(chord.action, layout) });
    }
    groups.push({ title: LAYER_TITLE[layer], rows });
  }
  groups.push({
    title: "no shoulder",
    rows: [
      { keys: "d-pad", what: "arrows" },
      { keys: "A B X Y", what: "Enter Bksp Tab Space" },
      { keys: "START", what: "Escape" },
      { keys: "SELECT", what: "Keys · Pad · Home" },
      { keys: "L2 / R2", what: "switch workspace" },
    ],
  });
  return groups;
}
