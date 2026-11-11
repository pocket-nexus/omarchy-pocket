// What each chord does (chords.ts). Buttons, the deck's layout badge, the
// stage's bar and the key sheet all end here, so a chord behaves the same however
// it is given. An action that cannot happen says why in a notice, as Pocket
// Shell's 3DS shell does.
import { createEffect, createRoot } from "solid-js";
import { run } from "./bridge.ts";
import type { Action } from "./chords.ts";
import { appletById, openApplet } from "./applets/applet.ts";
import { toggleMenu } from "./stage/menu.tsx";
import { toggleSheet } from "./stage/keysheet.tsx";
import { toast } from "./stage/toasts.tsx";
import { state } from "./system.ts";
import { closePackage, openPackage } from "./packages.ts";
import { closeTerminal, openTerminal } from "./term/store.ts";
import { keyRepeating } from "./keys.ts";
import { UCONSOLE } from "./screen.ts";
import type { WindowManager } from "./wm.ts";
import { act, current, focused, takeClosed, WORKSPACES } from "./workspaces.ts";

const INFO = "\u{f02fc}";
const say = (title: string) => toast({ icon: INFO, title, body: "", tone: "info" }, 1.8);

const fail = (title: string) => (result: { code: number | null; stderr: string }) => {
  if (result.code !== 0) toast({ icon: "\u{f015a}", title, body: result.stderr.trim().split("\n").pop() ?? "", tone: "error" });
};

export { toggleMenu };

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

/** The uConsole has no workspace layer: a left or right step with no window
 *  that way goes on to the workspace beside (focus) or carries the window
 *  there (swap), and stops at the first and the last, as the bar lays them
 *  out. A held D-pad's repeats stop at the last window, as a list stops at
 *  its last row; only a press goes past it. True when it acted. */
function edgeStep(action: Action, step: (m: WindowManager) => boolean, beyond: (m: WindowManager, delta: -1 | 1) => unknown): boolean {
  if (act(step)) return true;
  const delta = action.endsWith("left") ? -1 : action.endsWith("right") ? 1 : 0;
  if (!delta || keyRepeating()) return false;
  if (action.startsWith("swap") && !focused()) return false;
  const ws = current() + delta;
  if (ws < 0 || ws >= WORKSPACES) {
    say(delta < 0 ? "The first workspace" : "The last workspace");
    return true;
  }
  act((m) => beyond(m, delta));
  return true;
}

export function perform(action: Action) {
  switch (action) {
    case "focus.left":
    case "focus.right":
    case "focus.up":
    case "focus.down":
      if (UCONSOLE && edgeStep(action, (m) => m.focusDir(action.slice(6) as "left"), (m, d) => m.stepWs(d))) return;
      return must((m) => m.focusDir(action.slice(6) as "left"), focused() ? "No window that way" : "No window here");
    case "swap.left":
    case "swap.right":
    case "swap.up":
    case "swap.down":
      if (UCONSOLE && edgeStep(action, (m) => m.swapDir(action.slice(5) as "left"), (m, d) => m.carry(d))) return;
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
      say("Next background");
      return void run("omarchy-theme-bg-next").then(fail("Next background"), () => {});
    case "bar":
      say("Toggling the bar");
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
