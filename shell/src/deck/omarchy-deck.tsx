// The Omarchy deck: the menu (Go) and the bar indicators' panels as tabs
// along the body's bottom edge. It is the deck's body whenever the current
// workspace is empty; over a window, Start (or Go on the strip) opens and
// closes it. A tap on the tab strip moves between tabs.
import { For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { focused } from "../workspaces.ts";
import { color } from "../theme.ts";
import { BODY_H } from "./geometry.ts";
import { atRoot, deckPress, deckTap, MenuDeck, openAppsList, toRoot } from "./menu-deck.tsx";
import { closePanel, openPanel, PANELS, panelPress, panelTap, Panels, showPanel, type PanelName } from "./panels.tsx";
import { actOnNewest } from "../stage/toasts.tsx";

type Tab = "go" | PanelName;
const TABS: Tab[] = ["go", ...PANELS];
const TITLE: Record<Tab, string> = { go: "Go", bluetooth: "Bluetooth", network: "Network", audio: "Audio", power: "Power" };
const STRIP_TOP = BODY_H - 20;
const TAB_W = 512 / TABS.length;

import { deckOpen as open, setDeckOpen as setOpen } from "./deck-state.ts";

export const tab = (): Tab => openPanel() ?? "go";
export const omarchyDeckShown = () => open() || focused() === null;

export function openOmarchyDeck(at: Tab = "go") {
  setOpen(true);
  if (at === "go") closePanel();
  else showPanel(at);
}

export function closeOmarchyDeck() {
  setOpen(false);
}

/** Start: over a window, open or close the deck; on an empty workspace, back to the menu's root. */
export function toggleOmarchyDeck() {
  if (focused() === null) {
    closePanel();
    toRoot();
  } else setOpen((o) => !o);
}

/** Select: the Apps list, to open a window on this workspace. */
export function openApps() {
  openOmarchyDeck("go");
  openAppsList();
}

function select(at: Tab) {
  if (at === "go") closePanel();
  else showPanel(at);
}

export function omarchyDeckPress(key: number) {
  if (tab() !== "go") return panelPress(key);
  if (key & BTN.SQUARE) return void actOnNewest(true);
  if (key & BTN.TRIANGLE) return void actOnNewest(false);
  // B at the menu's root closes the deck over a window
  if (key & BTN.CROSS && atRoot() && focused() !== null) return closeOmarchyDeck();
  deckPress(key);
}

export function omarchyDeckTap(x: number, y: number) {
  if (y >= STRIP_TOP) return select(TABS[Math.min(TABS.length - 1, Math.floor(x / TAB_W))]!);
  if (tab() === "go") deckTap(y);
  else panelTap(x, y);
}

export function OmarchyDeck() {
  return (
    <View class="absolute left-0 top-0 w-[512] h-[318]" style={{ bgColor: color("darker_background") }}>
      <Show when={tab() === "go"} fallback={<Panels />}>
        <MenuDeck />
      </Show>
      <View class="absolute left-0 w-[512] h-[20]" style={{ insetT: STRIP_TOP, bgColor: color("dark_background") }}>
        <For each={TABS}>
          {(t, i) => (
            <Text
              class="absolute top-[3] text-center font-mono text-xs leading-[14]"
              style={{ insetL: i() * TAB_W, width: TAB_W, textColor: color(t === tab() ? "accent" : "dark_foreground") }}
            >
              {TITLE[t]}
            </Text>
          )}
        </For>
      </View>
    </View>
  );
}
