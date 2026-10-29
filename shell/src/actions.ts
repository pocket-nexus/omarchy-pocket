// What each chord does (chords.ts). Buttons, the deck's chord card, the dock
// and the key sheet all end here, so a chord behaves the same however it is
// given. An action that cannot happen says why in a notice, as Pocket Shell's
// 3DS shell does.
import { createEffect, createRoot } from "solid-js";
import { run } from "./bridge.ts";
import type { Action } from "./chords.ts";
import { appletById, openApplet } from "./applets/applet.ts";
import { body, setBody } from "./deck/body.ts";
import { toRoot } from "./deck/menu-deck.tsx";
import { toggleSheet } from "./stage/keysheet.tsx";
import { toast } from "./stage/toasts.tsx";
import { state } from "./system.ts";
import { closePackage, openPackage } from "./packages.ts";
import { closeTerminal, openTerminal } from "./term/store.ts";
import type { WindowManager } from "./wm.ts";
import { act, focused, takeClosed } from "./workspaces.ts";

const INFO = "\u{f02fc}";
const say = (title: string) => toast({ icon: INFO, title, body: "", tone: "info" }, 1.8);

const fail = (title: string) => (result: { code: number | null; stderr: string }) => {
  if (result.code !== 0) toast({ icon: "\u{f015a}", title, body: result.stderr.trim().split("\n").pop() ?? "", tone: "error" });
};

/** Omarchy's menu on the deck (L1 + A, the dock's menu cell), from its root. */
export function toggleMenu() {
  if (body() !== "menu") toRoot();
  setBody(body() === "menu" ? "map" : "menu");
}

/** The focused window's keyboard or controls on the deck (SELECT). */
export function toggleControls() {
  if (!focused()) return say("No window here");
  setBody(body() === "controls" ? "map" : "controls");
}

export function closeFocused() {
  const w = focused();
  if (!w) return say("Nothing to close");
  if (w.kind === "terminal") closeTerminal(w.sid);
  else if (w.kind === "app") closePackage(w.app);
  else act((m) => m.close(w.id));
}

/** Runs `change`; `why` is the notice when it changes nothing. */
const must = (change: (m: WindowManager) => boolean, why: string) => {
  if (!act(change)) say(why);
};

export function perform(action: Action) {
  switch (action) {
    case "focus.left":
    case "focus.right":
    case "focus.up":
    case "focus.down":
      return must((m) => m.focusDir(action.slice(6) as "left"), focused() ? "No window that way" : "No window here");
    case "swap.left":
    case "swap.right":
    case "swap.up":
    case "swap.down":
      return must((m) => m.swapDir(action.slice(5) as "left"), focused() ? "No window that way" : "No window here");
    case "ws.prev":
      return act((m) => m.stepWs(-1));
    case "ws.next":
      return act((m) => m.stepWs(1));
    case "carry.prev":
      return must((m) => m.carry(-1), "No window to carry");
    case "carry.next":
      return must((m) => m.carry(1), "No window to carry");
    case "menu":
      return toggleMenu();
    case "close":
      return closeFocused();
    case "fullscreen":
      return focused() ? act((m) => m.toggleFullscreen("full")) : say("No window here");
    case "maximize":
      return focused() ? act((m) => m.toggleFullscreen("max")) : say("No window here");
    case "split":
      return must((m) => m.toggleSplit(), "A split needs two windows");
    case "swapsplit":
      return must((m) => m.swapSplit(), "A split needs two windows");
    case "layout": {
      const next = act((m) => m.toggleLayout());
      return say(`Layout: ${next}`);
    }
    case "shrink":
      return must((m) => m.resize(-1), "A split needs two windows");
    case "grow":
      return must((m) => m.resize(1), "A split needs two windows");
    case "pan.left":
      return must((m) => m.pan(-1), "Panning needs the scrolling layout");
    case "pan.right":
      return must((m) => m.pan(1), "Panning needs the scrolling layout");
    case "keys":
      return toggleSheet();
    case "another": {
      const w = focused();
      if (!w) return openTerminal();
      if (w.kind === "terminal") return openTerminal();
      if (w.kind === "app") return openPackage(w.path, w.title, w.aux, w.appletSurface);
      return say(`${appletById(w.applet)?.title ?? w.applet} has one window`);
    }
    case "reopen": {
      const last = takeClosed();
      if (!last) return say("Nothing closed yet");
      if (last.kind === "terminal") return openTerminal();
      if (last.kind === "app") return openPackage(last.path, last.title, last.aux, last.appletSurface);
      return openApplet(last.applet);
    }
    case "wallpaper":
      return void run("omarchy-theme-bg-next").then(fail("Next background"), () => {});
    case "bar":
      return void run("omarchy-toggle-bar").then(fail("Toggle bar"), () => {});
  }
}

// The tiled area follows the bar: shell.json's position, Omarchy's bar-off toggle.
createRoot(() =>
  createEffect(() => {
    const bar = state()?.bar;
    act((m) => (m.bar = !bar ? "top" : bar.hidden ? "none" : bar.position === "bottom" ? "bottom" : "top"));
  }),
);
