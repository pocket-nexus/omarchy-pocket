// Omarchy's bar along the top of the stage, in the order of Omarchy's default
// shell.json layout: menu logo and workspaces, clock, then the Bluetooth,
// network, audio and power indicators from omarchy-pocketd's SystemState.
import { For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { C } from "../classes.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { state } from "../system.ts";
import { color } from "../theme.ts";

const WORKSPACES = [1, 2, 3, 4, 5];

export function Bar(props: { clock: () => string; workspace: () => number }) {
  const indicators = () => {
    const s = state();
    return [bluetoothGlyph(s?.bluetooth ?? null), networkGlyph(s?.network), audioGlyph(s?.audio ?? null), batteryGlyph(s?.battery ?? null)]
      .filter(Boolean)
      .join("  ");
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
      <Text class={C.barRight} style={{ textColor: color("foreground") }}>{indicators()}</Text>
    </View>
  );
}
