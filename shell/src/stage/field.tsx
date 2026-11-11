// A text field that has the keyboard (keys.ts fieldSink: the lock's
// password, a Wi-Fi password), drawn on the stage where the deck has none:
// the uConsole's keys are its own keyboard's, so the field sits on the stage
// above its bottom edge, with what the keys do under it.
import { Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { fieldSink } from "../keys.ts";
import { color } from "../theme.ts";
import { STAGE_H, STAGE_W } from "../screen.ts";

const W = 400;
const H = 46;

export function FieldLine() {
  return (
    <Show when={fieldSink()}>
      {(sink) => (
        <View class="absolute rounded-md border-[1]" style={{ insetL: (STAGE_W - W) / 2, insetT: STAGE_H - H - 24, width: W, height: H, bgColor: color("background", 0.96), borderColor: color("accent") }}>
          <Text class="absolute left-0 top-[6] text-center text-lg leading-[22]" style={{ width: W, textColor: color("bright_foreground") }}>
            {sink().field?.() ?? ""}
          </Text>
          <Text class="absolute left-0 top-[29] h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ width: W, textColor: color("dark_foreground") }}>
            {sink().hint?.() ?? ""}
          </Text>
        </View>
      )}
    </Show>
  );
}
