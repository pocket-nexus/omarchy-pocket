// The uConsole's keyboard names (src/superkeys.ts) and START as SUPER (src/super.ts).
import { expect, test } from "bun:test";
import { parseKey, superAction } from "../src/superkeys.ts";
import { LEGEND_FRAMES, setModifier, startPressed, startReleased, superLayer, superTick, used } from "../src/super.ts";

test("a key event's name splits into its modifiers and the key the sinks name", () => {
  expect(parseKey("Meta+w")).toEqual({ key: "w", mods: { ctrl: false, alt: false, shift: false, meta: true } });
  expect(parseKey("Control+Shift+ArrowLeft").key).toBe("Left");
  expect(parseKey("Control+Shift+ArrowLeft").mods).toEqual({ ctrl: true, alt: false, shift: true, meta: false });
  expect(parseKey("Control++").key).toBe("+");
  expect(parseKey("Meta+ ").key).toBe(" ");
});

test("SUPER's keys are Omarchy's bindings, and Shift moves instead of focusing", () => {
  expect(superAction("w", false)).toBe("close");
  expect(superAction("Enter", false)).toBe("terminal");
  expect(superAction(" ", false)).toBe("menu");
  expect(superAction(" ", true)).toBe("bar");
  expect(superAction("Left", false)).toBe("focus.left");
  expect(superAction("Left", true)).toBe("swap.left");
  expect(superAction("3", false)).toBe("ws2");
  // a shifted digit arrives as its character
  expect(superAction("@", true)).toBe("carry1");
  expect(superAction("Tab", true)).toBe("ws.prev");
  expect(superAction("z", false)).toBeNull();
});

test("START is SUPER while it is held, and nothing stays on after it", () => {
  expect(superLayer()).toBe("plain");
  startPressed();
  expect(superLayer()).toBe("window");
  startReleased();
  expect(superLayer()).toBe("plain");
  // tapping it again and again never reaches another layer
  for (let i = 0; i < 3; i++) {
    startPressed();
    startReleased();
    expect(superLayer()).toBe("plain");
  }
});

test("a quick START with nothing under it is a tap: the menu", () => {
  startPressed();
  superTick();
  expect(startReleased()).toBe("tap");
  // A pressed under it: a chord, no menu
  startPressed();
  used();
  expect(startReleased()).toBe("held");
  // held until the controls row shows: a look, no menu
  startPressed();
  for (let i = 0; i <= LEGEND_FRAMES; i++) superTick();
  expect(startReleased()).toBe("held");
});

test("the keyboard's Cmd is SUPER while it is down, with or without Shift", () => {
  setModifier("Meta", true);
  expect(superLayer()).toBe("window");
  setModifier("Shift", true);
  expect(superLayer()).toBe("window");
  setModifier("Shift", false);
  setModifier("Meta", false);
  expect(superLayer()).toBe("plain");
});
