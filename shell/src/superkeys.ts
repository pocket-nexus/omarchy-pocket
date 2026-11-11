// The uConsole keyboard's names (hardkeys.ts): a key event's name split
// into its modifiers and its key, and Omarchy's SUPER binding for a key, as
// its Hyprland binds them (default/hypr/bindings/tiling.lua and
// utilities.lua). No shell state: the tests read these.
import type { Action } from "./chords.ts";
import type { Mods } from "./keys.ts";

/** KeyboardEvent.key's arrow names as the key sinks name them. */
const NAMES: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
export const SHIFTED_DIGITS = "!@#$%";

/** A key event's name split into its modifiers and the key itself. */
export function parseKey(name: string): { key: string; mods: Mods & { meta: boolean } } {
  const parts = name.split("+");
  // "Control++" names the plus key
  const key = name.endsWith("++") ? "+" : parts.pop()!;
  const has = (m: string) => parts.includes(m);
  return { key: NAMES[key] ?? key, mods: { ctrl: has("Control"), alt: has("Alt"), shift: has("Shift"), meta: has("Meta") } };
}

/** Omarchy's SUPER binding for a key, or null. `shift` is held. */
export function superAction(key: string, shift: boolean): Action | "terminal" | "system" | `ws${number}` | `carry${number}` | null {
  const digit = "12345".indexOf(key);
  const shiftedDigit = SHIFTED_DIGITS.indexOf(key);
  if (digit >= 0) return shift ? `carry${digit}` : `ws${digit}`;
  if (shiftedDigit >= 0) return `carry${shiftedDigit}`;
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case "Up":
    case "Down":
    case "Left":
    case "Right":
      return `${shift ? "swap" : "focus"}.${key.toLowerCase()}` as Action;
    case "Enter":
      return shift ? "another" : "terminal";
    case " ":
      return "menu";
    case "w":
    case "q":
      return "close";
    case "f":
      return "fullscreen";
    case "j":
      return "split";
    case "l":
      return "layout";
    case "k":
      return "keys";
    case "Tab":
      return shift ? "ws.prev" : "ws.next";
    case "]":
      return "ws.next";
    case "[":
      return "ws.prev";
    case "}":
      return "carry.next";
    case "{":
      return "carry.prev";
    case "-":
    case "_":
      return "shrink";
    case "=":
    case "+":
      return "grow";
    case "Escape":
      return "system";
    default:
      return null;
  }
}

