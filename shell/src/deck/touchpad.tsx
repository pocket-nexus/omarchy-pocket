// The deck as a touchpad for the stage, after the trackpad of Pocket Shell's
// iPod touch remote: the stage takes no touch, so a finger here moves the
// pointer there (stage/pointer.tsx) as a laptop's trackpad does, relative and
// accelerated. A tap clicks where the pointer is. Two fingers scroll: the
// pointer stays where it is and the list under it moves with the fingers.
// The Hold key and a finger drag: the pointer holds down and moves, which
// moves a slider or a picked-up row. It is the deck's body for a focused
// applet, and a mode of its own for any window (the dock's touchpad cell).
import { createSignal } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { C } from "../classes.ts";
import { click, hold, movePointer, scrollBy, trackPointer } from "../stage/pointer.tsx";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { BODY_H } from "./geometry.ts";

const PAD = { x: 12, y: 10, w: 488, h: BODY_H - 10 - 58 };
const KEY = { x: 12, y: PAD.y + PAD.h + 8, w: 140, h: 40 };
/** pointer points per deck point at rest, and how much speed adds */
const GAIN = 1.1;
const ACCEL = 0.09;
const MAX_GAIN = 3.2;

const inPad = (x: number, y: number) => x >= PAD.x && x < PAD.x + PAD.w && y >= PAD.y && y < PAD.y + PAD.h;
const onKey = (x: number, y: number) => x >= KEY.x && x < KEY.x + KEY.w && y >= KEY.y && y < KEY.y + KEY.h;

type Mode = "drag" | "scroll" | null;
const [mode, setMode] = createSignal<Mode>(null);

/** A second finger counts once it has stayed SECOND_FRAMES frames at least
 *  SECOND_APART points from the first: the Goodix panel reports brief contacts
 *  at a finger's previous position, and those are not a second finger. Until
 *  it counts, the first finger's travel waits: it scrolls if the second one
 *  counts, and moves the pointer if it lifts. */
const SECOND_FRAMES = 5;
const SECOND_APART = 40;
/** the finger that moves the pointer, and whether its touch has dragged or scrolled */
let primary: number | null = null;
let dragged = false;
let scrolled = false;
const waiting = { dx: 0, dy: 0 };

function move(dx: number, dy: number) {
  const speed = Math.hypot(dx, dy);
  const gain = Math.min(MAX_GAIN, GAIN + speed * ACCEL);
  if (speed > 0) movePointer(dx * gain, dy * gain);
}

/** The touchpad's fingers (body coordinates). */
export function touchpadTouch(frame: TouchFrame) {
  const keyDown = frame.down.some((c) => onKey(c.start.x, c.start.y));
  const pad = frame.down.filter((c) => inPad(c.start.x, c.start.y));
  // a tap of the moving finger that did not travel, in a touch that never dragged, clicks
  for (const t of frame.taps) if (t.id === primary && !t.moved && !dragged && inPad(t.start.x, t.start.y)) click();
  const first = pad[0];
  if (!first) {
    primary = null;
    dragged = scrolled = false;
  } else if (first.id !== primary) {
    primary = first.id;
    dragged = false;
  }
  const others = first ? pad.filter((c) => c.id !== first.id) : [];
  const second = others.find((c) => c.frames >= SECOND_FRAMES && Math.hypot(c.x - first!.x, c.y - first!.y) >= SECOND_APART);
  const next: Mode = keyDown ? "drag" : second ? "scroll" : null;
  if (next !== mode()) {
    if (mode()) hold(false);
    if (next) hold(true, next === "drag");
    setMode(next);
  }
  if (next) dragged = true;
  if (next === "scroll") scrolled = true;
  if (first) {
    if (next === "scroll") {
      // both fingers' mean, with what the first one travelled while the second was settling
      scrollBy((first.dx + second!.dx) / 2 + waiting.dx, (first.dy + second!.dy) / 2 + waiting.dy);
      waiting.dx = waiting.dy = 0;
    } else if (others.length && !keyDown) {
      waiting.dx += first.dx;
      waiting.dy += first.dy;
    } else {
      // a touch that scrolled keeps the pointer where the scroll left it
      if (!scrolled) move(first.dx + waiting.dx, first.dy + waiting.dy);
      waiting.dx = waiting.dy = 0;
    }
  } else waiting.dx = waiting.dy = 0;
  trackPointer();
}

export function Touchpad() {
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <View class="absolute rounded-lg" style={{ insetL: PAD.x, insetT: PAD.y, width: PAD.w, height: PAD.h, bgColor: color(mode() ? "selection" : "dark_background") }}>
        <Text class="absolute left-0 text-center text-2xl leading-[28]" style={{ insetT: PAD.h / 2 - 36, width: PAD.w, textColor: color("muted") }}>{"\u{f0741}"}</Text>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: PAD.h / 2 + 2, width: PAD.w, textColor: color("dark_foreground") }}>
          {"move the pointer · tap to click"}
        </Text>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ insetT: PAD.h / 2 + 20, width: PAD.w, textColor: color("dark_foreground") }}>
          {"two fingers scroll"}
        </Text>
      </View>
      <View class="absolute rounded-md" style={{ insetL: KEY.x, insetT: KEY.y, width: KEY.w, height: KEY.h, bgColor: color(mode() === "drag" ? "accent" : "dark_background") }}>
        <Text class="absolute left-0 text-center font-mono text-sm leading-[16]" style={{ insetT: KEY.h / 2 - 8, width: KEY.w, textColor: color(mode() === "drag" ? "background" : "foreground") }}>
          {"Hold"}
        </Text>
      </View>
      <Text class="absolute font-mono text-xs leading-[14]" style={{ insetL: KEY.x + KEY.w + 14, insetT: KEY.y + 13, textColor: color("dark_foreground") }}>
        {"hold it and slide a finger to drag"}
      </Text>
    </View>
  );
}
