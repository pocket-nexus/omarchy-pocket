// Keys, from the deck's keyboard and from the gamepad. Omarchy Pocket has
// one keyboard: the deck types it by touch, and with no shoulder held the
// gamepad types the keys a thumb reaches without looking (BUTTON_KEYS: the
// D-pad is the arrows, A Enter, B Backspace, X Tab, Y Space, START Escape).
// Both end in a KeySink, which focus.ts picks: a text field that took the
// keyboard over (the lock, a Wi-Fi password), the card on the stage, or the
// focused window.
import { BTN } from "@pocketjs/framework/input";
import { createSignal } from "solid-js";

export interface Mods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}
export const NO_MODS: Mods = { ctrl: false, alt: false, shift: false };

export interface KeySink {
  /** a character, shift applied */
  text(ch: string): void;
  /** a key name (Enter, Up, Tab, ...) or a character with Ctrl or Alt */
  key(name: string, mods: Mods): void;
  /** a text field's value, drawn above the keys in place of the hint */
  field?: () => string;
  /** the line above the keys: what the keys do here */
  hint?: () => string;
  /** the close button beside the hint */
  close?(): void;
}

/** The sink that takes nothing: a pointer app, an empty workspace. */
export const NO_SINK: KeySink = { text() {}, key() {} };

export const BUTTON_KEYS: readonly [number, string][] = [
  [BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"],
  [BTN.CIRCLE, "Enter"], [BTN.CROSS, "Backspace"], [BTN.TRIANGLE, "Tab"], [BTN.SQUARE, " "], [BTN.START, "Escape"],
];
/** The button a named key stands for, for a window that takes buttons. */
export const KEY_BUTTONS: Record<string, number> = Object.fromEntries(BUTTON_KEYS.map(([b, k]) => [k, b]));
export const buttonKey = (button: number) => BUTTON_KEYS.find(([b]) => b & button)?.[1];

/** A text field that has the keyboard: the lock, a panel's password. Set
 *  to null when the field is done. */
const [field, setField] = createSignal<KeySink | null>(null);
export { field as fieldSink };
export function setFieldSink(sink: KeySink | null) {
  setField(() => sink);
}
