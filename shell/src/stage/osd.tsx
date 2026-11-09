// Omarchy's on-screen display (`omarchy-osd`, `omarchy-shell osd show <json>`)
// near the bottom of the stage: an icon with a progress bar and percentage, or
// an icon with a message. Omarchy's OsdModel turns the payload into what to
// draw, as it does for Quickshell's Osd.qml. omarchy-pocketd sends the same
// payload as an `osd` event (a volume key's step, daemon/volume-keys.ts).
import { createSignal, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { stateForShow } from "../generated/osd-model.js";
import { C } from "../classes.ts";
import { onEvent } from "../bridge.ts";
import { serve } from "../system.ts";
import { color } from "../theme.ts";
import { STAGE_H, STAGE_W } from "../screen.ts";

interface Shown {
  icon: string;
  message: string;
  hasProgress: boolean;
  value: number;
  maxValue: number;
  duration: number;
}

const ADVANCE = 9.6; // JetBrains Mono at text-base: 0.6 em
const PROGRESS_W = 240;
const MAX_W = 400;
const [shown, setShown] = createSignal<Shown | null>(null);
let generation = 0;

export function showOsd(payloadJson: string) {
  const p = JSON.parse(payloadJson || "{}");
  const next: Shown = stateForShow(
    p.icon || "",
    p.message || "",
    p.value === undefined ? "" : String(p.value),
    p.max === undefined ? "100" : String(p.max),
    p.progressText || "",
    p.duration === undefined ? "1200" : String(p.duration),
  );
  setShown(next);
  const mine = ++generation;
  if (next.duration > 0) after(next.duration / 1000, () => mine === generation && setShown(null));
}

onEvent((event) => {
  if (event.event === "osd") showOsd(JSON.stringify(event.osd));
});

serve("osd", {
  show: (payloadJson) => (showOsd(payloadJson), "ok"),
  close: () => (setShown(null), "ok"),
  state: () => (shown() ? "open" : "closed"),
  ping: () => "ok",
});

export function Osd() {
  return (
    <Show when={shown()}>
      {(osd) => {
        const width = () =>
          osd().hasProgress ? PROGRESS_W : Math.min(MAX_W, Math.round(48 + osd().message.length * ADVANCE + 12));
        return (
          <View
            class={C.osd}
            style={{ insetL: Math.round((STAGE_W - width()) / 2), insetT: STAGE_H - 96, width: width(), bgColor: color("background", 0.97), borderColor: color("accent") }}
          >
            <Text class={C.osdIcon} style={{ textColor: color("foreground") }}>{osd().icon}</Text>
            <Show
              when={osd().hasProgress}
              fallback={<Text class={C.osdMessage} style={{ textColor: color("foreground") }}>{osd().message}</Text>}
            >
              <View class={C.osdTrack} style={{ bgColor: color("foreground", 0.45) }}>
                <View class="absolute left-0 top-0 h-[4]" style={{ width: Math.round((120 * osd().value) / osd().maxValue), bgColor: color("accent") }} />
              </View>
              <Text class={C.osdValue} style={{ textColor: color("foreground") }}>{osd().message}</Text>
            </Show>
          </View>
        );
      }}
    </Show>
  );
}
