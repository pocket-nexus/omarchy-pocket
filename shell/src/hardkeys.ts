// The uConsole's keyboard. The host program sends its keys as PocketJS text
// events (host/src/uconsole.rs): a character as a commit, an editing key or a
// chord as a key named as KeyboardEvent.key names it (Enter, Control+c,
// Meta+w), and the modifiers' own presses and releases. The D-pad's arrows
// are the gamepad's D-pad buttons (app.tsx) unless Control, Alt or Cmd is held.
//
// With no SUPER layer (super.ts) the keys go where the deck's keys go
// (focus.ts keySink): the terminal, the card, Notes, a text field. Under the
// layer they are Omarchy's own SUPER bindings, the ones its Hyprland binds
// (default/hypr/bindings/tiling.lua and utilities.lua):
//
//   Return terminal      Space menu        W, Q close       F fullscreen
//   J split              L layout          K key sheet      Escape the System menu
//   arrows focus         1-5 workspace     Tab, ] next      Shift+Tab, [ previous
//   - = resize
//   with Shift: arrows swap, 1-5 and { } carry the window, Return opens another
//
// A key the layer does not bind lets a latched layer go and is typed as usual.
import { onTextEvent, type TextEvent } from "@pocketjs/framework/input";
import { perform } from "./actions.ts";
import type { Action } from "./chords.ts";
import { STEPS } from "./chords.ts";
import { parseKey, superAction } from "./superkeys.ts";
import { keySink } from "./focus.ts";
import { locked } from "./stage/lock.tsx";
import { summon } from "./stage/menu.tsx";
import { closeQr, qrOpen } from "./stage/qrsheet.tsx";
import { closeSheet, sheetOpen } from "./stage/keysheet.tsx";
import { screensaverActive, stopScreensaver } from "./stage/screensaver.tsx";
import { closeHelp, keyboardMods, panelDark, setModifier, superLayer, unlatch, used } from "./super.ts";
import { openTerminal } from "./term/store.ts";
import { act, focus } from "./workspaces.ts";

let typedHook: () => void = () => {};
/** A key was typed on the keyboard: the pointer steps aside, as a laptop's does. */
export const onHardKey = (hook: () => void) => (typedHook = hook);
/** Any key at all, for the idle timers. */
let inputHook: () => void = () => {};
export const onHardInput = (hook: () => void) => (inputHook = hook);

/** Runs a SUPER binding; false when the key has none. */
function superKey(key: string, shift: boolean): boolean {
  const action = superAction(key, shift);
  if (!action) return false;
  if (action === "terminal") {
    used("verb");
    openTerminal();
  } else if (action === "system") {
    used("verb");
    summon("system");
  } else if (action.startsWith("ws") && /^ws\d$/.test(action)) {
    used("verb");
    focus(Number(action.slice(2)));
  } else if (/^carry\d$/.test(action)) {
    used("verb");
    const target = Number(action.slice(5));
    act((m) => m.carry(target - m.active));
  } else {
    used(STEPS.includes(action as Action) ? "step" : "verb");
    perform(action as Action);
  }
  return true;
}

/** One text event from the keyboard. */
export function hardKey(event: TextEvent) {
  inputHook();
  if (event.kind === "key" && ["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
    setModifier(event.key, event.pressed);
    return;
  }
  if (event.kind === "key" && !event.pressed) return;
  if (event.kind !== "key" && event.kind !== "commit") return;
  // the key that lights a dark panel only lights it
  if (panelDark()) return;
  if (screensaverActive()) return stopScreensaver();
  if (qrOpen()) return closeQr();
  const { key, mods } = event.kind === "commit" ? { key: event.text, mods: { ctrl: false, alt: false, shift: false, meta: false } } : parseKey(event.key);
  // a commit's Shift is in its character: keep the held one for the layer
  const shift = mods.shift || keyboardMods().shift;
  if (locked()) {
    if (event.kind === "commit") keySink().text(key);
    else keySink().key(key, mods);
    return;
  }
  if (closeHelp() && key === "Escape") return;
  if (sheetOpen() && key === "Escape") return closeSheet();
  if (superLayer() !== "plain" && !mods.ctrl && !mods.alt) {
    if (superKey(key, shift)) return;
    // a latched layer's Escape lets it go; any other key it does not bind is typed
    if (unlatch() && key === "Escape") return;
  }
  typedHook();
  const sink = keySink();
  if (event.kind === "commit") {
    for (const ch of key) sink.text(ch);
    return;
  }
  sink.key(key, { ctrl: mods.ctrl, alt: mods.alt, shift: mods.shift });
}

onTextEvent((event: TextEvent) => {
  hardKey(event);
  return true;
});
