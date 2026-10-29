// A terminal's remote on the deck, the strip's middle segment while a
// terminal has focus: what drives the program in it, where the Keys segment
// types into it. The pad sends the arrows, one for each STEP points a finger
// travels, up and down for a shell's history, a pager's lines or a TUI's
// rows, left and right along a line; a tap on it is Enter. The keys beside it
// send what a program is driven with in one press: ^C, ^D, ^Z, ^R, ^L, Tab,
// Esc and q.
import { createSignal, For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { request } from "../bridge.ts";
import { C } from "../classes.ts";
import { active } from "../term/store.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { BODY_H } from "./geometry.ts";

interface Key {
  id: string;
  label: string;
  what: string;
  key: string;
  ctrl?: boolean;
}
const KEYS: Key[] = [
  { id: "c", label: "^C", what: "stop", key: "c", ctrl: true },
  { id: "d", label: "^D", what: "end input", key: "d", ctrl: true },
  { id: "z", label: "^Z", what: "suspend", key: "z", ctrl: true },
  { id: "r", label: "^R", what: "history", key: "r", ctrl: true },
  { id: "l", label: "^L", what: "clear", key: "l", ctrl: true },
  { id: "tab", label: "Tab", what: "complete", key: "Tab" },
  { id: "esc", label: "Esc", what: "escape", key: "Escape" },
  { id: "q", label: "q", what: "quit a pager", key: "q" },
];

const STEP = 22;
const PAD = { x: 12, y: 10, w: 268, h: BODY_H - 20 };
const GRID = { x: PAD.x + PAD.w + 10, y: PAD.y, cols: 2 };
const GAP = 6;
const KEY_W = (512 - GRID.x - 12 - GAP) / GRID.cols;
const KEY_H = (PAD.h - GAP * (KEYS.length / GRID.cols - 1)) / (KEYS.length / GRID.cols);

const inPad = (x: number, y: number) => x >= PAD.x && x < PAD.x + PAD.w && y >= PAD.y && y < PAD.y + PAD.h;
const keyAt = (x: number, y: number) => {
  const col = Math.floor((x - GRID.x) / (KEY_W + GAP));
  const row = Math.floor((y - GRID.y) / (KEY_H + GAP));
  if (x < GRID.x || col < 0 || col >= GRID.cols || row < 0) return null;
  return KEYS[row * GRID.cols + col] ?? null;
};

function send(key: string, ctrl = false) {
  const sid = active();
  if (sid === null) return;
  if (key.length === 1 && !ctrl) void request({ method: "termInput", sid, text: key });
  else void request({ method: "termKey", sid, key, ctrl, alt: false, shift: false });
}

const [lit, setLit] = createSignal<string | null>(null);
/** travel not yet spent on an arrow, per finger and axis */
const travel = new Map<number, { x: number; y: number }>();

export function termRemoteTouch(frame: TouchFrame) {
  const first = frame.down[0];
  setLit(first && !first.moved ? (keyAt(first.start.x, first.start.y)?.id ?? (inPad(first.start.x, first.start.y) ? "pad" : null)) : null);
  for (const c of frame.down) {
    if (!inPad(c.start.x, c.start.y) || !c.moved) continue;
    const t = travel.get(c.id) ?? { x: 0, y: 0 };
    t.x += c.dx;
    t.y += c.dy;
    // the axis the finger travels more along wins, so a vertical drag sends no stray left or right
    for (const axis of ["y", "x"] as const) {
      while (Math.abs(t[axis]) >= STEP && Math.abs(t[axis]) >= Math.abs(t[axis === "x" ? "y" : "x"])) {
        send(axis === "y" ? (t.y > 0 ? "Down" : "Up") : t.x > 0 ? "Right" : "Left");
        t[axis] -= Math.sign(t[axis]) * STEP;
      }
    }
    travel.set(c.id, t);
  }
  for (const tap of frame.taps) {
    travel.delete(tap.id);
    if (tap.moved) continue;
    if (inPad(tap.start.x, tap.start.y)) send("Enter");
    else {
      const key = keyAt(tap.start.x, tap.start.y);
      if (key) send(key.key, key.ctrl);
    }
  }
}

export function TermRemote() {
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <View class="absolute rounded-lg" style={{ insetL: PAD.x, insetT: PAD.y, width: PAD.w, height: PAD.h, bgColor: color(lit() === "pad" ? "selection" : "dark_background") }}>
        <Text class="absolute left-0 text-center font-mono text-base leading-[18]" style={{ insetT: PAD.h / 2 - 30, width: PAD.w, textColor: color("foreground") }}>
          {"\u{2190} \u{2191} \u{2193} \u{2192}"}
        </Text>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: PAD.h / 2 - 4, width: PAD.w, textColor: color("dark_foreground") }}>
          {"drag for the arrows"}
        </Text>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: PAD.h / 2 + 14, width: PAD.w, textColor: color("dark_foreground") }}>
          {"tap for Enter"}
        </Text>
      </View>
      <For each={KEYS}>
        {(k, i) => (
          <View
            class="absolute rounded-md"
            style={{
              insetL: GRID.x + (i() % GRID.cols) * (KEY_W + GAP),
              insetT: GRID.y + Math.floor(i() / GRID.cols) * (KEY_H + GAP),
              width: KEY_W,
              height: KEY_H,
              bgColor: color(lit() === k.id ? "accent" : "dark_background"),
            }}
          >
            <Text class="absolute left-0 text-center font-mono text-base leading-[18]" style={{ insetT: KEY_H / 2 - 17, width: KEY_W, textColor: color(lit() === k.id ? "background" : "accent") }}>
              {k.label}
            </Text>
            <Text class="absolute left-0 h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetT: KEY_H / 2 + 3, width: KEY_W, textColor: color(lit() === k.id ? "background" : "dark_foreground") }}>
              {k.what}
            </Text>
          </View>
        )}
      </For>
    </View>
  );
}
