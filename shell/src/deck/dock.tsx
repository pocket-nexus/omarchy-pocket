// The deck's bottom band, after Pocket Shell's 3DS dock: Omarchy's bar moved
// under the thumb. The menu first, then the shell's windows (a tap opens one
// beside the focused window, or focuses it where it is; Terminal always
// opens a new session), then the switches: keyboard (the focused window's
// controls on the body), keys (the key sheet on the stage), wallpaper (the
// theme's next background) and bar. Glyphs carry no labels; the pressed cell
// fills with the accent and names itself above the dock. An accent mark sits
// under the focused window's app and a short grey one under an app with a
// window elsewhere; a switch that is on draws in the accent.
import { For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { openApplet } from "../applets/applet.ts";
import { perform, toggleControls, toggleMenu } from "../actions.ts";
import { sheetOpen, toggleSheet } from "../stage/keysheet.tsx";
import { state } from "../system.ts";
import { openTerminal } from "../term/store.ts";
import { color } from "../theme.ts";
import { find, focused, revision } from "../workspaces.ts";
import { body } from "./body.ts";
import { DOCK_H, DOCK_TOP } from "./geometry.ts";
import { pressed } from "./press.ts";

interface Item {
  id: string;
  glyph: string;
  label: string;
  x: number;
  tap(): void;
  /** an app: whether it has a window, and whether that window has focus */
  app?: () => "focused" | "open" | null;
  /** a switch: whether it is on */
  on?: () => boolean;
}

const CELL = 46;
const appState = (kind: "terminal" | string) => (): "focused" | "open" | null => {
  revision();
  const f = focused();
  const isIt = (w: { kind: string; applet?: string }) => (kind === "terminal" ? w.kind === "terminal" : w.kind === "applet" && w.applet === kind);
  if (f && isIt(f)) return "focused";
  return find(isIt) ? "open" : null;
};
const app = (id: string, glyph: string, label: string, x: number): Item => ({ id, glyph, label, x, tap: () => openApplet(id), app: appState(id) });

const ITEMS: Item[] = [
  { id: "menu", glyph: "\u{e900}", label: "menu", x: 18, tap: toggleMenu, on: () => body() === "menu" },
  { id: "terminal", glyph: "\u{f018d}", label: "terminal", x: 18 + CELL + 8, tap: openTerminal, app: appState("terminal") },
  app("notes", "\u{f09ed}", "notes", 18 + CELL * 2 + 8),
  app("activity", "\u{f04c5}", "activity", 18 + CELL * 3 + 8),
  app("pictures", "\u{f02e9}", "pictures", 18 + CELL * 4 + 8),
  app("clock", "\u{f0954}", "clock", 18 + CELL * 5 + 8),
  { id: "keyboard", glyph: "\u{f030c}", label: "keyboard", x: 18 + CELL * 6 + 16, tap: toggleControls, on: () => body() === "controls" },
  { id: "keys", glyph: "\u{f0306}", label: "keys", x: 18 + CELL * 7 + 16, tap: toggleSheet, on: sheetOpen },
  { id: "wallpaper", glyph: "\u{f02f9}", label: "next background", x: 18 + CELL * 8 + 16, tap: () => perform("wallpaper") },
  { id: "bar", glyph: "\u{f035c}", label: "bar", x: 18 + CELL * 9 + 16, tap: () => perform("bar"), on: () => !state()?.bar?.hidden },
];

const itemAt = (x: number) => ITEMS.find((i) => x >= i.x && x < i.x + CELL) ?? null;

/** The dock's target under `x`, for the pressed look. */
export const dockTarget = (x: number) => {
  const item = itemAt(x);
  return item ? `dock:${item.id}` : null;
};

export function dockTap(x: number) {
  itemAt(x)?.tap();
}

export function Dock() {
  const lit = () => ITEMS.find((i) => pressed(`dock:${i.id}`)) ?? null;
  return (
    <>
      <Show when={lit()}>
        {(item) => (
          <View class="absolute h-[18] rounded-sm" style={{ insetL: Math.max(4, Math.min(512 - 124, item().x + CELL / 2 - 60)), insetT: DOCK_TOP - 22, width: 120, bgColor: color("accent") }}>
            <Text class="absolute left-0 top-[2] w-[120] text-center font-mono text-xs leading-[14]" style={{ textColor: color("background") }}>{item().label}</Text>
          </View>
        )}
      </Show>
      <View class="absolute left-0 w-[512] contain-strict" style={{ insetT: DOCK_TOP, height: DOCK_H, bgColor: color("background") }}>
        <View class="absolute left-0 top-0 w-[512] h-[1]" style={{ bgColor: color("muted") }} />
        <For each={ITEMS}>
          {(item) => (
            <View class="absolute top-[3] rounded-md" style={{ insetL: item.x, width: CELL - 4, height: DOCK_H - 6, bgColor: color(pressed(`dock:${item.id}`) ? "accent" : "background") }}>
              <Show
                when={item.id !== "menu"}
                fallback={
                  // Omarchy's logo (omarchy.ttf) stands taller on the baseline than the
                  // Nerd Font icons: one size down and lower, it centres with them
                  <Text class="absolute left-0 top-[8] text-center font-mono text-sm leading-[20]" style={{ width: CELL - 4, textColor: color(pressed("dock:menu") ? "background" : item.on?.() ? "accent" : "foreground") }}>
                    {item.glyph}
                  </Text>
                }
              >
                <Text
                  class="absolute left-0 top-[6] text-center font-mono text-base leading-[20]"
                  style={{ width: CELL - 4, textColor: color(pressed(`dock:${item.id}`) ? "background" : item.on?.() ? "accent" : "foreground") }}
                >
                  {item.glyph}
                </Text>
              </Show>
              <Show when={item.app?.()}>
                {(s) => <View class="absolute top-[30] h-[2] rounded-sm" style={{ insetL: (CELL - 4 - (s() === "focused" ? 14 : 5)) / 2, width: s() === "focused" ? 14 : 5, bgColor: color(s() === "focused" ? "accent" : "dark_foreground") }} />}
              </Show>
            </View>
          )}
        </For>
      </View>
    </>
  );
}
