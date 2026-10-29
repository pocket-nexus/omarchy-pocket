// SUPER + K: the whole chord table over the stage (L1 + SELECT, or the
// dock's keys cell). The window, move and workspace layers and the bindings
// that hold without a shoulder, in two columns, from the same table the
// dispatcher reads. It mounts on demand and fades in on the core's track.
import { createSignal, For, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { keySheet } from "../chords.ts";
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
