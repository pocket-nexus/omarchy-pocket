// Keys: the chord table as a window, Omarchy's SUPER + K. The stage lists
// every layer's chords with Omarchy's binding for each; the deck shows one
// layer at a time (tabs along its top) and runs a chord when its row is
// tapped. Both read chords.ts, as the dispatcher does.
import { createSignal, For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { perform } from "../actions.ts";
import { BUTTON_NAME, chordsOf, LABEL, type Layer } from "../chords.ts";
import { C } from "../classes.ts";
import { color } from "../theme.ts";
import { register } from "./applet.ts";

const LAYERS: { layer: Layer; title: string }[] = [
  { layer: "window", title: "hold L1" },
  { layer: "move", title: "hold R1" },
  { layer: "workspace", title: "hold L1+R1" },
  { layer: "plain", title: "no shoulder" },
];
const [tab, setTab] = createSignal(0);

const LINE = 14;

function Stage(props: { w: number; h: number }) {
  // two columns when the window is wide enough, one otherwise
  const columns = () => (props.w >= 420 ? 2 : 1);
  const colW = () => (props.w - 16) / columns();
  const blocks = () => {
    let col = 0;
    let y = 8;
    const out: { x: number; y: number; title: string; layer: Layer }[] = [];
    for (const l of LAYERS) {
      const height = (chordsOf(l.layer).length + 1) * LINE + 8;
      if (columns() === 2 && col === 0 && y + height > props.h && y > 8) {
        col = 1;
        y = 8;
      }
      out.push({ x: 8 + col * colW(), y, title: l.title, layer: l.layer });
      y += height;
    }
    return out;
  };
  return (
    <For each={blocks()}>
      {(b) => (
        <>
          <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: b.x, insetT: b.y, textColor: color("accent") }}>{b.title}</Text>
          <For each={chordsOf(b.layer)}>
            {(c, i) => (
              <Text class="absolute h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ insetL: b.x, insetT: b.y + (i() + 1) * LINE, width: colW() - 8, textColor: color("foreground") }}>
                {`${(BUTTON_NAME[c.button] ?? "?").padEnd(7)}${LABEL[c.action].padEnd(19)}${colW() > 300 ? c.omarchy : ""}`}
              </Text>
            )}
          </For>
        </>
      )}
    </For>
  );
}

const TAB_W = 512 / LAYERS.length;
const ROW_T = 56;
const ROW_H = 22;

function Deck() {
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <For each={LAYERS}>
        {(l, i) => (
          <View class="absolute top-[4] h-[22] rounded-sm" style={{ insetL: i() * TAB_W + 4, width: TAB_W - 8, bgColor: color(tab() === i() ? "selection" : "dark_background") }}>
            <Text class="absolute left-0 top-[4] text-center font-mono text-xs leading-[14]" style={{ width: TAB_W - 8, textColor: color(tab() === i() ? "accent" : "foreground") }}>{l.title}</Text>
          </View>
        )}
      </For>
      <Text class="absolute left-[12] top-[34] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>tap a row to run it</Text>
      <For each={chordsOf(LAYERS[tab()]!.layer)}>
        {(c, i) => (
          <View class="absolute left-[8] w-[496] rounded-sm" style={{ insetT: ROW_T + i() * ROW_H, height: ROW_H - 2, bgColor: color(i() % 2 ? "darker_background" : "dark_background") }}>
            <Text class="absolute left-[8] top-[3] font-mono text-sm leading-[14]" style={{ textColor: color("accent") }}>{BUTTON_NAME[c.button] ?? "?"}</Text>
            <Text class="absolute left-[72] top-[3] font-mono text-sm leading-[14]" style={{ textColor: color("bright_foreground") }}>{LABEL[c.action]}</Text>
            <Text class="absolute right-[8] top-[4] font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>{c.omarchy}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

register({
  id: "keys",
  title: "Keys",
  icon: "\u{f030c}",
  Stage,
  Deck,
  tap(x, y) {
    if (y < 30) return setTab(Math.min(LAYERS.length - 1, Math.floor(x / TAB_W)));
    const chord = chordsOf(LAYERS[tab()]!.layer)[Math.floor((y - ROW_T) / ROW_H)];
    if (y >= ROW_T && chord) perform(chord.action);
  },
});
