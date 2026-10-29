// Omarchy's bar along the top of the stage, laid out like Omarchy 4's: the
// logo and the workspaces on the left (the current one a rounded square,
// empty ones dimmed), the clock in the middle, and on the right the chord
// layer while a shoulder is held (otherwise the workspace's layout) before
// the Bluetooth, network, audio and power indicators from omarchy-pocketd's
// SystemState. The indicator whose panel is open on the deck is drawn in the
// accent. The bar follows Omarchy's shell.json: the clock's format, hidden
// (bar-off), at the top or bottom, and an opaque, glassy or clear background.
// The layer titles are mounted together and shown by opacity, so a shoulder
// press repaints the bar without a relayout.
import { For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { HELD_LAYERS, LAYER_TITLE } from "../chords.ts";
import { C } from "../classes.ts";
import { formatClock } from "../clock-format.ts";
import { layer } from "../deck/layer.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { state } from "../system.ts";
import { color } from "../theme.ts";
import { current, layout, occupied, WORKSPACES } from "../workspaces.ts";

const NUMBERS = Array.from({ length: WORKSPACES }, (_, i) => i);
/** The indicators from the right edge: Omarchy's order, Bluetooth leftmost. */
const SLOT = 20;
const H = 18;
const ALPHA: Record<string, number> = { opaque: 1, glassy: 0.75, none: 0 };

export function Bar(props: { now: () => Date; focused: () => string | null }) {
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
  const statusRight = () => 512 - 8 - SLOT * indicators().length - 8;
  return (
    <Show when={!settings()?.hidden}>
      <View class={C.bar} style={{ insetT: top(), bgColor: color("background", ALPHA[settings()?.background ?? "opaque"] ?? 1) }}>
        <Text class={C.barText} style={{ insetL: 6, textColor: color("foreground") }}>{"\u{e900}"}</Text>
        <For each={NUMBERS}>
          {(n) => (
            <Show
              when={current() === n}
              fallback={
                <Text class={C.barText} style={{ insetL: 26 + n * 14, textColor: color(occupied(n) ? "foreground" : "muted") }}>
                  {String(n + 1)}
                </Text>
              }
            >
              <View class="absolute top-[5] h-[9] w-[9] rounded-sm" style={{ insetL: 25 + n * 14, bgColor: color("bright_foreground") }} />
            </Show>
          )}
        </For>
        <Text class={C.barCenter} style={{ textColor: color("foreground") }}>{clock()}</Text>
        <Text class="absolute top-[2] text-right font-mono text-xs leading-[14]" style={{ insetL: statusRight() - 160, width: 160, opacity: layer() === "plain" ? 1 : 0, textColor: color("dark_foreground") }}>
          {layout()}
        </Text>
        <For each={HELD_LAYERS}>
          {(l) => (
            <Text class="absolute top-[2] text-right font-mono text-xs leading-[14]" style={{ insetL: statusRight() - 160, width: 160, opacity: layer() === l ? 1 : 0, textColor: color("accent") }}>
              {LAYER_TITLE[l]}
            </Text>
          )}
        </For>
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
