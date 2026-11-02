// What the buttons do. Two views of chords.ts: the key sheet (SUPER + K on
// Omarchy: L1 + SELECT) puts the whole table over the stage, in two columns,
// and the legend shows one held layer's bindings along the stage's bottom
// edge once a shoulder has been held for LEGEND_AFTER frames, going with
// the shoulder. Both read the table the dispatcher reads, so neither can
// describe what a button does not do.
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { BUTTON_NAME, chordsOf, DPAD, keySheet, labelFor, LAYER_TITLE, stickLabel, triggerLabel, type Layer } from "../chords.ts";
import { C } from "../classes.ts";
import { heldLayer } from "../held.ts";
import { glide } from "../motion.ts";
import { color } from "../theme.ts";
import { layout } from "../workspaces.ts";

const [open, setOpen] = createSignal(false);
export const sheetOpen = open;
export const toggleSheet = () => setOpen((o) => !o);
export const closeSheet = () => setOpen(false);

const LINE = 15;
const COL_W = 236;
const KEYS_W = 96;

interface Line {
  kind: "title" | "row" | "gap";
  keys: string;
  what: string;
}

function lines(groups: number[]): Line[] {
  const all = keySheet(layout());
  const out: Line[] = [];
  for (const index of groups) {
    const group = all[index]!;
    out.push({ kind: "title", keys: group.title, what: "" });
    for (const row of group.rows) out.push({ kind: "row", ...row });
    out.push({ kind: "gap", keys: "", what: "" });
  }
  return out;
}

function Column(props: { x: number; groups: number[] }) {
  return (
    <For each={lines(props.groups)}>
      {(line, i) => (
        <Show when={line.kind !== "gap"}>
          <Text
            class="absolute h-[15] overflow-hidden font-mono text-xs leading-[15]"
            style={{ insetL: props.x, insetT: 44 + i() * LINE, width: line.kind === "title" ? COL_W : KEYS_W, textColor: color(line.kind === "title" ? "accent" : "bright_foreground") }}
          >
            {line.keys}
          </Text>
          <Show when={line.kind === "row"}>
            <Text class="absolute h-[15] overflow-hidden font-mono text-xs leading-[15]" style={{ insetL: props.x + KEYS_W, insetT: 44 + i() * LINE, width: COL_W - KEYS_W, textColor: color("foreground") }}>
              {line.what}
            </Text>
          </Show>
        </Show>
      )}
    </For>
  );
}

export function KeySheet() {
  return (
    <Show when={open()}>
      <View
        class="absolute left-[12] top-[24] w-[488] h-[348] rounded-md border-[1]"
        style={{ bgColor: color("background", 0.96), borderColor: color("accent") }}
        ref={(node: NodeMirror) => {
          jump(node, "opacity", 0);
          animate(node, "opacity", 1, { dur: 150, easing: "out" });
        }}
      >
        <Text class="absolute left-[12] top-[8] font-mono text-sm leading-[16]" style={{ textColor: color("bright_foreground") }}>Keys</Text>
        <Text class="absolute right-[12] top-[9] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>L1 + SELECT closes</Text>
        <View class="absolute left-[12] top-[30] w-[464] h-[1]" style={{ bgColor: color("muted") }} />
        <Column x={0 + 12} groups={[0, 3]} />
        <Column x={12 + COL_W} groups={[1, 2]} />
      </View>
    </Show>
  );
}

/** frames a shoulder is held before the legend shows (a chord pressed at
 *  once never sees it) */
export const LEGEND_AFTER = 14;
const [legendDue, setLegendDue] = createSignal(false);

/** Once per frame: whether a shoulder has been held long enough. */
export function tickLegend(held: boolean, frames: number) {
  const due = held && frames >= LEGEND_AFTER;
  if (due !== legendDue()) setLegendDue(due);
}

/** A held layer's bindings as [key, what] cells: the D-pad, the sticks,
 *  L2/R2, then the face and side buttons. */
function legendCells(layer: Layer): [string, string][] {
  if (layer === "plain") return [];
  const l = layout();
  const cells: [string, string][] =
    layer === "workspace" ? [["← →", "workspace"], ["↑ ↓", "carry window"]] : [["D-pad", labelFor(chordsOf(layer).find((c) => c.button & DPAD)!.action, l)]];
  const stick = stickLabel(layer);
  if (stick) cells.push(["Stick", stick]);
  const triggers = triggerLabel(layer, l);
  if (triggers !== "—") cells.push(["L2/R2", triggers]);
  for (const c of chordsOf(layer)) if (FACE_AND_SIDE.includes(c.button)) cells.push([BUTTON_NAME[c.button]!, labelFor(c.action, l)]);
  return cells;
}
const FACE_AND_SIDE: readonly number[] = [BTN.CIRCLE, BTN.CROSS, BTN.TRIANGLE, BTN.SQUARE, BTN.START, BTN.SELECT];
/** three cells a row: a key column with room after SELECT, and a label of 14 characters */
const LEGEND_COLS = 3;
const CELL_W = 154;
const KEY_W = 50;
const LEGEND_ROW = 16;
const LEGEND_TOP = 23;
const LEGEND_BOTTOM = 376;

/** The legend: the held layer's chords along the stage's bottom edge. It
 *  stays mounted and fades on the core's track; its text follows the held
 *  layer while it shows, and keeps the last layer's while it fades. */
export function Legend() {
  let node: NodeMirror | undefined;
  const shownLayer = createMemo<Layer>((last) => (heldLayer() === "plain" ? (last ?? "window") : heldLayer()), "window");
  const cells = createMemo(() => legendCells(shownLayer()));
  const height = () => LEGEND_TOP + Math.ceil(cells().length / LEGEND_COLS) * LEGEND_ROW + 6;
  createEffect(on(legendDue, (due) => glide(node, "opacity", due ? 1 : 0, due ? 120 : 160), { defer: true }));
  return (
    <View class={C.legend} style={{ insetT: LEGEND_BOTTOM - height(), height: height(), bgColor: color("background", 0.96), borderColor: color("accent"), opacity: 0 }} ref={(n: NodeMirror) => (node = n)}>
      <Text class="absolute left-[12] top-[6] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ width: 464, textColor: color("accent") }}>
        {LAYER_TITLE[shownLayer()]}
      </Text>
      <For each={cells()}>
        {([key, what], i) => (
          <>
            <Text
              class="absolute h-[14] overflow-hidden font-mono text-xs leading-[14]"
              style={{ insetL: 12 + (i() % LEGEND_COLS) * CELL_W, insetT: LEGEND_TOP + Math.floor(i() / LEGEND_COLS) * LEGEND_ROW, width: KEY_W, textColor: color("bright_foreground") }}
            >
              {key}
            </Text>
            <Text
              class="absolute h-[14] overflow-hidden font-mono text-xs leading-[14]"
              style={{ insetL: 12 + (i() % LEGEND_COLS) * CELL_W + KEY_W, insetT: LEGEND_TOP + Math.floor(i() / LEGEND_COLS) * LEGEND_ROW, width: CELL_W - KEY_W - 4, textColor: color("foreground") }}
            >
              {what}
            </Text>
          </>
        )}
      </For>
    </View>
  );
}
