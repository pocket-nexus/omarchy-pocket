// Omarchy's bar along the top of the stage, in the order of Omarchy's default
// shell.json layout: menu logo and workspaces, clock, then the Bluetooth,
// network, audio and power indicators from omarchy-pocketd's SystemState.
// The indicator whose panel is open on the deck is drawn in the accent.
import { For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { C } from "../classes.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { state } from "../system.ts";
import { color } from "../theme.ts";

const WORKSPACES = [1, 2, 3, 4, 5];

/** The indicators from the right edge: Omarchy's order, Bluetooth leftmost. */
const SLOT = 20;

export function Bar(props: { clock: () => string; workspace: () => number; focused: () => string | null }) {
  const indicators = () => {
    const s = state();
    return [
      { name: "power", glyph: batteryGlyph(s?.battery ?? null) },
      { name: "audio", glyph: audioGlyph(s?.audio ?? null) },
      { name: "network", glyph: networkGlyph(s?.network) },
      { name: "bluetooth", glyph: bluetoothGlyph(s?.bluetooth ?? null) },
    ].filter((i) => i.glyph);
  };
  return (
    <View class={C.bar} style={{ bgColor: color("background") }}>
      <Text class={C.barText} style={{ insetL: 6, textColor: color("foreground") }}>{"\u{e900}"}</Text>
      <For each={WORKSPACES}>
        {(n) => (
          <Text class={C.barText} style={{ insetL: 14 + n * 12, textColor: color(props.workspace() === n ? "accent" : "dark_foreground") }}>
            {String(n)}
          </Text>
        )}
      </For>
      <Text class={C.barCenter} style={{ textColor: color("foreground") }}>{props.clock()}</Text>
      <For each={indicators()}>
        {(i, n) => (
          <Text class={C.barText} style={{ insetL: 512 - 8 - SLOT * (n() + 1) + 4, textColor: color(props.focused() === i.name ? "accent" : "foreground") }}>
            {i.glyph}
          </Text>
        )}
      </For>
    </View>
  );
}
