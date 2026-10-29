// The deck's top band: the five workspaces (tap one to go there; the
// current one in the accent, one holding windows lit), the focused window's
// title or the chord layer in force, the L1 and R1 pills that latch a layer
// for one action, and Go, which opens and closes the Omarchy menu.
import { For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { appletOf } from "../applets/applet.ts";
import { LAYER_TITLE } from "../chords.ts";
import { sessionById } from "../term/store.ts";
import { color } from "../theme.ts";
import { current, focus, focused, occupied, WORKSPACES } from "../workspaces.ts";
import { deckOpen, setDeckOpen } from "./deck-state.ts";
import { STRIP_H } from "./geometry.ts";
import { layer, pills, togglePill } from "./layer.ts";

const TAB_W = 26;
const TABS_L = 4;
const TITLE_L = TABS_L + WORKSPACES * TAB_W + 8;
const PILL_W = 38;
const GO_W = 44;
const GO_L = 512 - 4 - GO_W;
const R_L = GO_L - 4 - PILL_W;
const L_L = R_L - 4 - PILL_W;
const NUMBERS = Array.from({ length: WORKSPACES }, (_, i) => i);

export function windowTitle(): string {
  const w = focused();
  if (!w) return "Empty workspace";
  if (w.kind === "terminal") return sessionById(w.sid)?.title() || "Terminal";
  return appletOf(w)?.title ?? w.applet;
}

/** The workspace tab under `x`, or -1. */
export function tabAt(x: number): number {
  const i = Math.floor((x - TABS_L) / TAB_W);
  return x >= TABS_L && i < WORKSPACES ? i : -1;
}

export function stripTap(x: number) {
  const tab = tabAt(x);
  if (tab >= 0) return focus(tab);
  if (x >= GO_L) return setDeckOpen(!deckOpen());
  if (x >= R_L) return togglePill("r");
  if (x >= L_L) return togglePill("l");
}

function Pill(props: { left: number; label: string; on: () => boolean }) {
  return (
    <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: props.left, width: PILL_W, bgColor: color(props.on() ? "accent" : "dark_background") }}>
      <Text class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]" style={{ width: PILL_W, textColor: color(props.on() ? "background" : "foreground") }}>
        {props.label}
      </Text>
    </View>
  );
}

export function Strip() {
  return (
    <View class="absolute left-0 top-0 w-[512]" style={{ height: STRIP_H, bgColor: color("background") }}>
      <For each={NUMBERS}>
        {(n) => (
          <View
            class="absolute top-[3] h-[20] rounded-sm"
            style={{ insetL: TABS_L + n * TAB_W, width: TAB_W - 4, bgColor: color(current() === n ? "accent" : occupied(n) ? "selection" : "background") }}
          >
            <Text
              class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]"
              style={{ width: TAB_W - 4, textColor: color(current() === n ? "background" : occupied(n) ? "bright_foreground" : "dark_foreground") }}
            >
              {String(n + 1)}
            </Text>
          </View>
        )}
      </For>
      <Text class="absolute top-[5] h-[16] overflow-hidden font-mono text-sm leading-[16]" style={{ insetL: TITLE_L, width: L_L - TITLE_L - 6, textColor: color(layer() === "plain" ? "foreground" : "accent") }}>
        {layer() === "plain" ? windowTitle() : LAYER_TITLE[layer()]}
      </Text>
      <Pill left={L_L} label="L1" on={() => pills().l || layer() === "window" || layer() === "workspace"} />
      <Pill left={R_L} label="R1" on={() => pills().r || layer() === "move" || layer() === "workspace"} />
      <View class="absolute top-[3] h-[20] rounded-sm" style={{ insetL: GO_L, width: GO_W, bgColor: color(deckOpen() || focused() === null ? "selection" : "dark_background") }}>
        <Text class="absolute left-0 top-[3] text-center font-mono text-xs leading-[14]" style={{ width: GO_W, textColor: color("accent") }}>{"\u{f035c} Go"}</Text>
      </View>
    </View>
  );
}
