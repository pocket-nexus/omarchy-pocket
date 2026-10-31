// The deck's bottom band, the remote's launch bar: Omarchy's menu, the
// shell's windows (a tap opens one beside the focused window, or focuses it
// where it is; Terminal always opens a new session; Agent opens one running
// Omarchy's default coding agent, as Omarchy's SUPER + SHIFT + CTRL + A does,
// in that window: `omarchy-agent --inline --pick`, since the launcher's own
// terminal hand-off opens nothing from inside a session), then the applets (X,
// Discord, YouTube, Hacker News: one window each, focused when it is open).
// Every cell launches the frame a finger settles on it. Glyphs carry
// no labels; the pressed cell fills with the accent and names itself above
// the dock. An accent mark sits under the focused window's app and a short
// grey one under an app with a window elsewhere; the menu cell draws in the
// accent while the menu is up.
import { For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { openApplet } from "../applets/applet.ts";
import { toggleMenu } from "../actions.ts";
import { openPackage } from "../packages.ts";
import { menuOpen } from "../stage/menu.tsx";
import { openTerminal } from "../term/store.ts";
import { color } from "../theme.ts";
import { find, focused, focusWindow, revision, type Win } from "../workspaces.ts";
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
  /** the menu: whether it is up */
  on?: () => boolean;
}

const CELL = 42;
const stateOf = (isIt: (w: Win) => boolean) => (): "focused" | "open" | null => {
  revision();
  const f = focused();
  if (f && isIt(f)) return "focused";
  return find(isIt) ? "open" : null;
};
const app = (id: string, glyph: string, label: string, x: number): Item => ({ id, glyph, label, x, tap: () => openApplet(id), app: stateOf((w) => w.kind === "applet" && w.applet === id) });
const APPLETS = "/usr/share/omarchy-pocket/applets";
/** A Pocket applet: its window is focused when it has one, else it opens. */
const applet = (name: string, glyph: string, label: string, x: number): Item => {
  const path = `${APPLETS}/${name}.pocket`;
  const isIt = (w: Win) => w.kind === "app" && w.path === path;
  return {
    id: name,
    glyph,
    label,
    x,
    tap: () => {
      const open = find(isIt);
      if (open) focusWindow(open.id);
      else openPackage(path, label, true, true);
    },
    app: stateOf(isIt),
  };
};

const ITEMS: Item[] = [
  { id: "menu", glyph: "\u{e900}", label: "menu", x: 16, tap: toggleMenu, on: menuOpen },
  { id: "terminal", glyph: "\u{f018d}", label: "terminal", x: 16 + CELL + 6, tap: () => openTerminal(), app: stateOf((w) => w.kind === "terminal") },
  { id: "agent", glyph: "\u{f06a9}", label: "agent", x: 16 + CELL * 2 + 6, tap: () => openTerminal(["omarchy-agent", "--inline", "--pick"], "Agent") },
  app("notes", "\u{f09ed}", "notes", 16 + CELL * 3 + 6),
  app("activity", "\u{f04c5}", "activity", 16 + CELL * 4 + 6),
  app("pictures", "\u{f02e9}", "pictures", 16 + CELL * 5 + 6),
  app("clock", "\u{f0954}", "clock", 16 + CELL * 6 + 6),
  applet("x", "\u{f0544}", "X", 16 + CELL * 7 + 12),
  applet("discord", "\u{f066f}", "Discord", 16 + CELL * 8 + 12),
  applet("youtube", "\u{f05c3}", "YouTube", 16 + CELL * 9 + 12),
  applet("hn", "\u{f2e5}", "Hacker News", 16 + CELL * 10 + 12),
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
