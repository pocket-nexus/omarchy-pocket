// What the buttons do: the key sheet (SUPER + K on Omarchy: L1 + SELECT)
// puts the whole of chords.ts over the stage, in two columns. It reads the
// table the dispatcher reads, so it cannot describe what a button does not
// do. A held shoulder's bindings are the deck's legend (deck/legend.tsx).
import { createSignal, For, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { keySheet } from "../chords.ts";
import { color } from "../theme.ts";
import { layout } from "../workspaces.ts";
import { SHEET_H, SHEET_W } from "./geometry.ts";
import { UCONSOLE } from "../screen.ts";

const [open, setOpen] = createSignal(false);
export const sheetOpen = open;
export const toggleSheet = () => setOpen((o) => !o);
export const closeSheet = () => setOpen(false);

const LINE = 15;
/** two columns across the sheet (236 on the RG DS Plus) */
const COL_W = Math.floor((SHEET_W - 16) / 2);
const KEYS_W = UCONSOLE ? 118 : 96;

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
        class="absolute left-[12] top-[24] rounded-md border-[1]"
        style={{ width: SHEET_W, height: SHEET_H, bgColor: color("background", 0.96), borderColor: color("accent") }}
        ref={(node: NodeMirror) => {
          jump(node, "opacity", 0);
          animate(node, "opacity", 1, { dur: 150, easing: "out" });
        }}
      >
        <Text class="absolute left-[12] top-[8] font-mono text-sm leading-[16]" style={{ textColor: color("bright_foreground") }}>Keys</Text>
        <Text class="absolute right-[12] top-[9] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>{UCONSOLE ? "SUPER + K or Esc closes" : "L1 + SELECT closes"}</Text>
        <View class="absolute left-[12] top-[30] h-[1]" style={{ width: SHEET_W - 24, bgColor: color("muted") }} />
        <Column x={0 + 12} groups={[0, 3]} />
        <Column x={12 + COL_W} groups={[1, 2]} />
      </View>
    </Show>
  );
}
