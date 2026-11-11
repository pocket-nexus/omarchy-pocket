// The uConsole's legend: its controls row drawn along the stage's bottom
// edge, each control's word over the place it sits under the panel, while a
// SUPER layer is latched or held a moment (super.ts) or SELECT's help is up.
// The row under the uConsole's panel holds, left to right, the D-pad, L and R
// (L above and left of R), the trackball, and Y X over B A; the keyboard's
// maker's drawing (clockworkpi/uConsole, Clockwork_uConsole_Assembly_Guidelines.pdf,
// "The Interfaces") puts their centres at these fractions of the panel's
// width, so a word sits right above its control: the D-pad 13%, L 30%, R 34%,
// the ball 65%, Y 79%, X 88%, B 83%, A 92%.
//
// It reads chords.ts as the key sheet does: a control the layer does not bind
// is drawn dim. L and R are the mouse's buttons under every layer.
import { createEffect, For, on, Show } from "solid-js";
import { BTN } from "@pocketjs/framework/input";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { chordFor, glyphFor, type Glyph, type Layer } from "../chords.ts";
import { glide } from "../motion.ts";
import { latched, legendShown } from "../super.ts";
import { color } from "../theme.ts";
import { layout } from "../workspaces.ts";
import { STAGE_H, STAGE_W } from "../screen.ts";

export const CONTROLS_H = 66;
const TOP = STAGE_H - CONTROLS_H;
const at = (fraction: number) => Math.round(STAGE_W * fraction);
/** the layer's name and what START does, then the controls in two rows */
const TITLE = TOP + 5;
const ROW1 = TOP + 26;
const ROW2 = TOP + 47;

interface Cell {
  /** the control's name, drawn small */
  name: string;
  x: number;
  y: number;
  glyph: (layer: Layer) => Glyph | null;
}

const PLAIN: Record<number, Glyph> = {
  [BTN.CIRCLE]: { icon: "\u{f0311}", word: "Enter" },
  [BTN.CROSS]: { icon: "\u{f006e}", word: "Bksp" },
  [BTN.TRIANGLE]: { icon: "\u{f0312}", word: "Tab" },
  [BTN.SQUARE]: { icon: "\u{f1050}", word: "Space" },
};

const face = (button: number) => (layer: Layer): Glyph | null => {
  if (layer === "plain") return PLAIN[button] ?? null;
  const chord = chordFor(layer, button);
  return chord ? glyphFor(chord.action, layout()) : null;
};

const CELLS: Cell[] = [
  {
    name: "D-pad",
    x: at(0.13),
    y: ROW1,
    glyph: (layer) =>
      layer === "plain" ? { icon: "\u{f0041}", word: "Arrows" } : layer === "move" ? { icon: "\u{f04e1}", word: "Swap" } : { icon: "\u{f04fe}", word: "Focus" },
  },
  { name: "L", x: at(0.295), y: ROW1, glyph: () => ({ icon: "\u{f037d}", word: "Click" }) },
  { name: "R", x: at(0.34), y: ROW2, glyph: () => ({ icon: "\u{f0b33}", word: "Back" }) },
  {
    name: "Ball",
    x: at(0.648),
    y: ROW1,
    glyph: () => ({ icon: "\u{f01bf}", word: "Point" }),
  },
  { name: "Y", x: at(0.79), y: ROW1, glyph: face(BTN.SQUARE) },
  { name: "X", x: at(0.878), y: ROW1, glyph: face(BTN.TRIANGLE) },
  { name: "B", x: at(0.835), y: ROW2, glyph: face(BTN.CROSS) },
  { name: "A", x: at(0.922), y: ROW2, glyph: face(BTN.CIRCLE) },
];

/** What the D-pad's edge, the wheel and START do, under the cells. */
function notes(layer: Layer): { left: string; middle: string; title: string; hint: string } {
  const wheel = layer === "plain" ? "SELECT + roll: scroll" : "SELECT + roll: workspace";
  switch (layer) {
    case "plain":
      return { left: "", middle: wheel, title: "Controls", hint: "START: SUPER · SELECT: close" };
    case "window":
      return { left: "past the last: workspace", middle: wheel, title: "SUPER  Window", hint: latched() ? "START: move · Esc: leave" : "SHIFT: move" };
    case "move":
      return { left: "past the last: carry", middle: wheel, title: "SUPER \u{21e7}  Move", hint: latched() ? "START: leave" : "" };
    default:
      return { left: "", middle: "", title: "", hint: "" };
  }
}

const CELL_W = 70;

/** One control: its word over where it sits, the control's name before it. */
function CellView(props: { cell: Cell; layer: () => Layer }) {
  const glyph = () => props.cell.glyph(props.layer());
  return (
    <View class="absolute h-[14]" style={{ insetL: props.cell.x - CELL_W / 2, insetT: props.cell.y, width: CELL_W }}>
      <Text class="absolute left-0 top-0 text-center font-mono text-xs leading-[14]" style={{ width: CELL_W, textColor: color(glyph() ? "bright_foreground" : "muted") }}>
        {glyph() ? `${glyph()!.icon} ${glyph()!.word}` : `${props.cell.name} —`}
      </Text>
    </View>
  );
}

export function Controls() {
  let node: NodeMirror | undefined;
  const shown = () => legendShown();
  const layer = (): Layer => shown() ?? "plain";
  createEffect(on(shown, (s) => glide(node, "opacity", s ? 1 : 0, s ? 120 : 160), { defer: true }));
  const n = () => notes(layer());
  return (
    <View class="absolute left-0" style={{ insetT: TOP, width: STAGE_W, height: CONTROLS_H, opacity: 0 }} ref={(r: NodeMirror) => (node = r)}>
      <View class="absolute left-0 top-0" style={{ width: STAGE_W, height: CONTROLS_H, bgColor: color("background", 0.94) }} />
      <View class="absolute left-0 top-0 h-[1]" style={{ width: STAGE_W, bgColor: color(layer() === "plain" ? "muted" : "accent") }} />
      <Text class="absolute left-[12] font-mono text-xs leading-[14]" style={{ insetT: TITLE - TOP, textColor: color(layer() === "plain" ? "foreground" : "accent") }}>{n().title}</Text>
      <Text class="absolute text-right font-mono text-xs leading-[14]" style={{ insetL: STAGE_W - 12 - 320, insetT: TITLE - TOP, width: 320, textColor: color("dark_foreground") }}>{n().hint}</Text>
      <Show when={shown()}>
        <For each={CELLS}>{(cell) => <CellView cell={{ ...cell, y: cell.y - TOP }} layer={layer} />}</For>
        <Text class="absolute left-[8] font-mono text-xs leading-[14]" style={{ insetT: ROW2 - TOP, width: 170, textColor: color("dark_foreground") }}>{n().left}</Text>
        <Text class="absolute text-center font-mono text-xs leading-[14]" style={{ insetL: at(0.648) - 80, insetT: ROW2 - TOP, width: 160, textColor: color("dark_foreground") }}>{n().middle}</Text>
      </Show>
    </View>
  );
}
