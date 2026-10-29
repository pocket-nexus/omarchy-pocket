// The deck's bottom band: the shell's windows by icon (a dot beside the ones
// that are open) and the launcher. A tap opens the window beside the focused
// one, or focuses it where it already is; Terminal always opens a new session.
// A cell lights while it is touched, so the panel shows it heard the tap.
import { createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { appletById, openApplet } from "../applets/applet.ts";
import { openLauncher } from "../actions.ts";
import { openTerminal } from "../term/store.ts";
import { color } from "../theme.ts";
import { find, revision } from "../workspaces.ts";
import { DOCK_H } from "./geometry.ts";

interface Item {
  id: string;
  icon: string;
  label: string;
  open(): void;
  running?(): boolean;
}

const applet = (id: string): Item => ({
  id,
  icon: appletById(id)?.icon ?? "?",
  label: appletById(id)?.title ?? id,
  open: () => openApplet(id),
  running: () => (revision(), find((w) => w.kind === "applet" && w.applet === id) !== null),
});

const ITEMS = (): Item[] => [
  { id: "terminal", icon: "\u{f018d}", label: "Terminal", open: openTerminal, running: () => (revision(), find((w) => w.kind === "terminal") !== null) },
  applet("activity"),
  applet("clock"),
  applet("notes"),
  applet("pictures"),
  applet("keys"),
  { id: "apps", icon: "\u{f003b}", label: "Apps", open: openLauncher },
];

const [lit, setLit] = createSignal(-1);
let items: Item[] = [];

const cellW = () => 512 / Math.max(1, items.length);

/** The fingers over the dock this frame (x positions): the cell under one lights. */
export function dockTouch(xs: number[]) {
  setLit(xs.length ? Math.floor(xs[0]! / cellW()) : -1);
}

export function dockTap(x: number) {
  items[Math.floor(x / cellW())]?.open();
}

export function Dock() {
  items = ITEMS();
  return (
    <View class="absolute left-0 w-[512]" style={{ insetT: 384 - DOCK_H, height: DOCK_H, bgColor: color("background") }}>
      <View class="absolute left-0 top-0 w-[512] h-[1]" style={{ bgColor: color("muted") }} />
      <For each={items}>
        {(item, i) => (
          <View class="absolute top-[2]" style={{ insetL: i() * cellW(), width: cellW(), height: DOCK_H - 4 }}>
            <View class="absolute top-0 rounded-md" style={{ insetL: 4, width: cellW() - 8, height: DOCK_H - 4, bgColor: color(lit() === i() ? "selection" : "background") }} />
            <Text class="absolute left-0 top-[3] text-center font-mono text-base leading-[18]" style={{ width: cellW(), textColor: color(lit() === i() ? "accent" : "foreground") }}>
              {item.icon}
            </Text>
            <Text class="absolute left-0 top-[21] text-center font-mono text-xs leading-[12]" style={{ width: cellW(), textColor: color("dark_foreground") }}>
              {item.label}
            </Text>
            <Show when={item.running?.()}>
              <View class="absolute top-[9] h-[5] w-[5] rounded-full" style={{ insetL: cellW() / 2 + 13, bgColor: color("accent") }} />
            </Show>
          </View>
        )}
      </For>
    </View>
  );
}
