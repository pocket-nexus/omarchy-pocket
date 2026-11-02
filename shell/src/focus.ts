// What has focus, and what the deck shows for it. The stage is the monitor
// and the deck is the keyboard: the keys go to one thing at a time, in this
// order, and the deck's layout follows the same thing.
//
//   a text field    the lock, a Wi-Fi password: the keys, and the field under them
//   the card        Omarchy's menu, a panel, the theme picker: the keys
//                   (typing filters the menu, the arrows move, Enter opens,
//                   Escape closes)
//   a package       a touch app (X, Discord, YouTube, Hacker News): the pad,
//                   the trackpad alone at its full size
//   a window        a terminal, Notes, Activity, Clock, Pictures: the keys,
//                   with the trackpad under them
//   nothing         the home layout: the workspaces, their windows, the panels
//
// The round keyboard button and the function row's Home choose a layout by
// hand; the choice lasts until the thing in focus changes, and the rule picks
// again. Nothing else ever puts anything on the deck.
import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js";
import { appletOf } from "./applets/applet.ts";
import { KEY_BUTTONS, NO_SINK, fieldSink, type KeySink, type Mods } from "./keys.ts";
import { appletKeys, appletTyping } from "./packages.ts";
import { card, cardSink } from "./stage/card.tsx";
import { terminalSink } from "./term/store.ts";
import { current, focused } from "./workspaces.ts";
import { watching } from "./watch.ts";

export type Layout = "keys" | "pad" | "home";

/** The sink the keys go to now. */
export function keySink(): KeySink {
  const field = fieldSink();
  if (field) return field;
  if (card()) return cardSink();
  const w = focused();
  if (!w) return NO_SINK;
  if (w.kind === "terminal") return terminalSink;
  // a package types while a field's keyboard session is open; a pointer app takes nothing
  if (w.kind === "app") return appletTyping(w.app) ? appletKeys(w.app) : NO_SINK;
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

/** The layout the rule picks for what has focus. */
const rule = createMemo((): Layout => {
  if (fieldSink()) return "keys";
  if (card()) return "keys";
  const w = focused();
  if (!w) return "home";
  return w.kind === "app" ? (appletTyping(w.app) ? "keys" : "pad") : "keys";
});

const [chosen, setChosen] = createSignal<Layout | null>(null);
// a change of focus takes the hand-picked layout with it
createRoot(() => createEffect(on(rule, () => setChosen(null), { defer: true })));

/** The deck's layout: the hand-picked choice while it lasts, else the rule's. */
export const layout = (): Layout => chosen() ?? rule();

// while a watch is on (`pocket.input watch`), the deck's layout and the
// workspace are logged as they change, beside the host's presents
createRoot(() =>
  createEffect(
    on([layout, current], ([l, ws]) => {
      if (watching()) console.log(`deck: layout ${l}, workspace ${ws + 1}`);
    }, { defer: true }),
  ),
);

export function chooseLayout(next: Layout) {
  setChosen(next === rule() ? null : next);
}

/** The round button: the keys fold away and the trackpad takes their room, or back. */
export function toggleKeys() {
  chooseLayout(layout() === "keys" ? "pad" : "keys");
}

/** The function row's Home: the home layout, or back to what has focus. */
export function toggleHome() {
  if (layout() !== "home") return chooseLayout("home");
  chooseLayout(rule() === "home" ? "keys" : rule());
}

const ORDER: Layout[] = ["keys", "pad", "home"];
/** SELECT: the next layout round. */
export function cycleLayout() {
  chooseLayout(ORDER[(ORDER.indexOf(layout()) + 1) % ORDER.length]!);
}
