// What each chord does (chords.ts). Buttons, the deck's chord map and the
// key sheet all end here, so a chord behaves the same however it is given.
import { createEffect, createRoot } from "solid-js";
import { run } from "./bridge.ts";
import type { Action } from "./chords.ts";
import { openApplet } from "./applets/applet.ts";
import { setDeckOpen } from "./deck/deck-state.ts";
import { openAppsList, summon } from "./deck/menu-deck.tsx";
import { closePanel } from "./deck/panels.tsx";
import { toast } from "./stage/toasts.tsx";
import { state } from "./system.ts";
import { closeTerminal, openTerminal } from "./term/store.ts";
import { act, closeWindow, focused, step } from "./workspaces.ts";

const fail = (title: string) => (result: { code: number | null; stderr: string }) => {
  if (result.code !== 0) toast({ icon: "\u{f015a}", title, body: result.stderr.trim().split("\n").pop() ?? "", tone: "error" });
};

/** The Omarchy deck at the menu `id` ("root" is Go), over any window. */
export function openMenu(id = "root") {
  closePanel();
  summon(id);
  setDeckOpen(true);
}

/** The launcher: Go's Apps list. */
export function openLauncher() {
  closePanel();
  openAppsList();
  setDeckOpen(true);
}

export function closeFocused() {
  const w = focused();
  if (!w) return;
  if (w.kind === "terminal") closeTerminal(w.sid);
  else closeWindow(w.id);
}

export function perform(action: Action) {
  switch (action) {
    case "focus.left":
    case "focus.right":
    case "focus.up":
    case "focus.down":
      return void act((m) => m.focusDir(action.slice(6) as "left"));
    case "swap.left":
    case "swap.right":
    case "swap.up":
    case "swap.down":
      return void act((m) => m.swapDir(action.slice(5) as "left"));
    case "ws.prev":
      return step(-1);
    case "ws.next":
      return step(1);
    case "carry.prev":
      return act((m) => m.carry(-1));
    case "carry.next":
      return act((m) => m.carry(1));
    case "launcher":
      return openLauncher();
    case "terminal":
      return openTerminal();
    case "close":
      return closeFocused();
    case "fullscreen":
      return act((m) => m.toggleFullscreen("full"));
    case "maximize":
      return act((m) => m.toggleFullscreen("max"));
    case "split":
      return void act((m) => m.toggleSplit());
    case "shrink":
      return act((m) => m.resize(-1));
    case "grow":
      return act((m) => m.resize(1));
    case "keys":
      return openApplet("keys");
    case "menu":
      return openMenu();
    case "system":
      return openMenu("system");
    case "background":
      return void run("omarchy-theme-bg-next").then(fail("Next background"), () => {});
    case "bar":
      return void run("omarchy-toggle-bar").then(fail("Toggle bar"), () => {});
    case "screenshot":
      return void run("omarchy-capture-screenshot").then(fail("Screenshot"), () => {});
  }
}

// The tiled area follows the bar: shell.json's position, Omarchy's bar-off toggle.
createRoot(() =>
  createEffect(() => {
    const bar = state()?.bar;
    act((m) => (m.bar = !bar ? "top" : bar.hidden ? "none" : bar.position === "bottom" ? "bottom" : "top"));
  }),
);
