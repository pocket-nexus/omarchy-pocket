// The uConsole's keyboard names (src/superkeys.ts) and START as SUPER (src/super.ts).
import { expect, test } from "bun:test";
import { parseKey, superAction } from "../src/superkeys.ts";
import { latched, setModifier, startPressed, startReleased, superLayer, unlatch, used } from "../src/super.ts";

test("a key event's name splits into its modifiers and the key the sinks name", () => {
  expect(parseKey("Meta+w")).toEqual({ key: "w", mods: { ctrl: false, alt: false, shift: false, meta: true } });
  expect(parseKey("Control+Shift+ArrowLeft").key).toBe("Left");
  expect(parseKey("Control+Shift+ArrowLeft").mods).toEqual({ ctrl: true, alt: false, shift: true, meta: false });
  expect(parseKey("Control++").key).toBe("+");
  expect(parseKey("Meta+ ").key).toBe(" ");
});

test("SUPER's keys are Omarchy's bindings, and Shift turns them to the move layer", () => {
  expect(superAction("w", false)).toBe("close");
  expect(superAction("Enter", false)).toBe("terminal");
  expect(superAction(" ", false)).toBe("menu");
  expect(superAction("Left", false)).toBe("focus.left");
  expect(superAction("Left", true)).toBe("swap.left");
  expect(superAction("3", false)).toBe("ws2");
  // a shifted digit arrives as its character
  expect(superAction("@", true)).toBe("carry1");
  expect(superAction("Tab", true)).toBe("ws.prev");
  expect(superAction("z", false)).toBeNull();
});

test("START tapped latches the window layer, again the move layer, again nothing", () => {
  unlatch();
  startPressed();
  expect(superLayer()).toBe("window");
  startReleased();
  expect(latched()).toBe("window");
  startPressed();
  startReleased();
  expect(latched()).toBe("move");
  expect(superLayer()).toBe("move");
  startPressed();
  startReleased();
  expect(latched()).toBeNull();
  expect(superLayer()).toBe("plain");
});

test("a step keeps a latched layer, a verb lets it go, and a chord latches nothing", () => {
  unlatch();
  startPressed();
  startReleased();
  used("step");
  expect(latched()).toBe("window");
  used("verb");
  expect(latched()).toBeNull();
  // START held through A: a chord, no latch on release
  startPressed();
  used("verb");
  expect(startReleased()).toBe("chord");
  expect(latched()).toBeNull();
});

test("the keyboard's Cmd holds the window layer, and Shift the move layer", () => {
  unlatch();
  setModifier("Meta", true);
  expect(superLayer()).toBe("window");
  setModifier("Shift", true);
  expect(superLayer()).toBe("move");
  setModifier("Shift", false);
  setModifier("Meta", false);
  expect(superLayer()).toBe("plain");
});
