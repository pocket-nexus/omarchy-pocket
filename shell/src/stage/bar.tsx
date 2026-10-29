// Omarchy's bar along the top of the stage, in the order of Omarchy's default
// shell.json layout: menu logo and workspaces, clock, then the Bluetooth,
// network, audio and power indicators from omarchy-pocketd's SystemState.
// The indicator whose panel is open on the deck is drawn in the accent. The
// bar follows Omarchy's shell.json: the clock's format, hidden (bar-off),
// at the top or bottom (left and right draw at the top: the panel is short),
// and an opaque, glassy or clear background.
import { For, Show } from "solid-js";
import { formatClock } from "../clock-format.ts";
import { Text, View } from "@pocketjs/framework/components";
import { C } from "../classes.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { state } from "../system.ts";
import { color } from "../theme.ts";

const WORKSPACES = [1, 2, 3, 4, 5];

/** The indicators from the right edge: Omarchy's order, Bluetooth leftmost. */
const SLOT = 20;

const H = 18;
const ALPHA: Record<string, number> = { opaque: 1, glassy: 0.75, none: 0 };

export function Bar(props: { now: () => Date; workspace: () => number; focused: () => string | null }) {
  const settings = () => state()?.bar;
  const clock = () => formatClock(settings()?.clock ?? "dddd HH:mm", props.now());
  const top = () => (settings()?.position === "bottom" ? 384 - H : 0);
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
    <Show when={!settings()?.hidden}>
    <View class={C.bar} style={{ insetT: top(), bgColor: color("background", ALPHA[settings()?.background ?? "opaque"] ?? 1) }}>
      <Text class={C.barText} style={{ insetL: 6, textColor: color("foreground") }}>{"\u{e900}"}</Text>
      <For each={WORKSPACES}>
        {(n) => (
          <Text class={C.barText} style={{ insetL: 14 + n * 12, textColor: color(props.workspace() === n ? "accent" : "dark_foreground") }}>
            {String(n)}
          </Text>
        )}
      </For>
      <Text class={C.barCenter} style={{ textColor: color("foreground") }}>{clock()}</Text>
      <For each={indicators()}>
        {(i, n) => (
          <Text class={C.barText} style={{ insetL: 512 - 8 - SLOT * (n() + 1) + 4, textColor: color(props.focused() === i.name ? "accent" : "foreground") }}>
            {i.glyph}
          </Text>
        )}
      </For>
    </View>
    </Show>
  );
}
