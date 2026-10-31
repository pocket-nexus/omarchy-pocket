// What has focus, and what the deck shows for it. The stage is the monitor
// and the deck is the keyboard: the keys go to one thing at a time, in this
// order, and the deck's layout follows the same thing.
//
//   a text field    the lock, a Wi-Fi password: the keys, and the field above them
//   the card        Omarchy's menu, a panel, the theme picker: the keys
//                   (typing filters the menu, the arrows move, Enter opens,
//                   Escape closes)
//   a package       a touch app (X, Discord, YouTube, Hacker News): the pad,
//                   a trackpad for the pointer on the stage
//   a window        a terminal, Notes, Activity, Clock, Pictures: the keys
//   nothing         the home layout: the workspaces, their windows, the panels
//
// The strip's tabs choose a layout by hand; the choice lasts until the thing
// in focus changes, and the rule picks again. Nothing else ever puts
// anything on the deck.
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js";
import { appletOf } from "./applets/applet.ts";
import { KEY_BUTTONS, NO_SINK, fieldSink, type KeySink, type Mods } from "./keys.ts";
import { card, cardSink, cardTitle } from "./stage/card.tsx";
import { windowTitle } from "./stage/windows.tsx";
import { terminalSink } from "./term/store.ts";
import { current, focused } from "./workspaces.ts";

export type Layout = "keys" | "pad" | "home";

/** The sink the keys go to now. */
export function keySink(): KeySink {
  const field = fieldSink();
  if (field) return field;
  if (card()) return cardSink();
  const w = focused();
  if (!w) return NO_SINK;
  if (w.kind === "terminal") return terminalSink;
  if (w.kind === "app") return NO_SINK;
  const applet = appletOf(w);
  if (!applet) return NO_SINK;
  const own = applet.keys?.();
  if (own) return own;
  // an applet that takes buttons takes the keys that stand for them
  return {
    text: (ch) => ch === " " && applet.press?.(KEY_BUTTONS[" "]!),
    key: (name) => {
      const button = KEY_BUTTONS[name];
      if (button) applet.press?.(button);
    },
    hint: applet.hint,
  };
}

/** One key from the keyboard, with its modifiers. */
export function sendKeyTo(name: string, mods: Mods) {
  keySink().key(name, mods);
}

/** What the keys go to, for the strip. */
export function focusTitle(): string {
  if (fieldSink()) return "Password";
  if (card()) return cardTitle();
  const w = focused();
  return w ? windowTitle(w) : `Workspace ${current() + 1}`;
}

/** The layout the rule picks for what has focus. */
const rule = createMemo((): Layout => {
  if (fieldSink()) return "keys";
  if (card()) return "keys";
  const w = focused();
  if (!w) return "home";
  return w.kind === "app" ? "pad" : "keys";
});

const [chosen, setChosen] = createSignal<Layout | null>(null);
// a change of focus takes the hand-picked layout with it
createRoot(() => createEffect(on(rule, () => setChosen(null), { defer: true })));

/** The deck's layout: the tabs' choice while it lasts, else the rule's. */
export const layout = (): Layout => chosen() ?? rule();

export function chooseLayout(next: Layout) {
  setChosen(next === rule() ? null : next);
}

const ORDER: Layout[] = ["keys", "pad", "home"];
/** SELECT: the next layout round. */
export function cycleLayout() {
  chooseLayout(ORDER[(ORDER.indexOf(layout()) + 1) % ORDER.length]!);
}
