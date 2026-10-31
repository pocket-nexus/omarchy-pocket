// The deck's pad layout: a trackpad for the stage, after the trackpad of
// Pocket Shell's iPod touch remote. The stage takes no touch, so a finger
// here moves the pointer there (stage/pointer.tsx) as a laptop's trackpad
// does, relative and accelerated. A tap clicks where the pointer is. Two
// fingers scroll: the pointer stays where it is and the list under it moves
// with the fingers. The Hold key and a finger drag: the pointer holds down
// and moves, which moves a slider or a picked-up row. It is the layout for
// a touch app in a window (X, Discord, YouTube, Hacker News), and the Pad
// tab brings it up for any window: its clicks focus windows and open the
// bar's panels. A package that draws a touch surface of its own and is not
// a touch app (app.surfaces.auxiliary without `applet`) shows that surface
// here instead, and the fingers on it are its contacts.
import { createEffect, createSignal, Show } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { C } from "../classes.ts";
import { appTextures } from "../packages.ts";
import { click, hold, movePointer, scrollBy } from "../stage/pointer.tsx";
import { color } from "../theme.ts";
import { settled, type TouchFrame } from "../touch.ts";
import { focused, type Win } from "../workspaces.ts";
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

type AppWin = Extract<Win, { kind: "app" }>;
/** The focused package whose own touch surface the pad shows. */
export const surfacePackage = (): AppWin | null => {
  const w = focused();
  return w?.kind === "app" && w.aux && !w.appletSurface ? w : null;
};

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

/** The pad's fingers (body coordinates). Returns a package surface's
 *  contacts [id, x, y, ...] in its own points when the pad shows one. */
export function touchpadTouch(frame: TouchFrame): number[] {
  if (surfacePackage()) {
    const contacts: number[] = [];
    for (const c of frame.down) {
      const x = (c.x - SURFACE_X) / SCALE;
      const y = c.y / SCALE;
      if (x >= 0 && x < 512 && y >= 0 && y < 384) contacts.push(c.id, x, y);
    }
    return contacts;
  }
  const down = frame.down.filter(settled);
  const keyDown = down.some((c) => onKey(c.start.x, c.start.y));
  const pad = down.filter((c) => inPad(c.start.x, c.start.y));
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
  return [];
}

const SCALE = Math.min(512 / 512, BODY_H / 384);
const SURFACE_W = 512 * SCALE;
const SURFACE_H = 384 * SCALE;
const SURFACE_X = (512 - SURFACE_W) / 2;

/** A package's own touch surface, letterboxed into the body. The texture is
 *  a GL framebuffer, first row at the bottom, so the image flips on Y. */
function Surface(props: { win: AppWin }) {
  let node: NodeMirror | undefined;
  const texture = () => appTextures(props.win.app)?.[1];
  createEffect(() => {
    const t = texture();
    if (node && t !== undefined) getOps().setImage(node.id, t);
  });
  return (
    <Image
      ref={(n: NodeMirror) => (node = n)}
      class="absolute top-0"
      src="wall-0-0.png"
      style={{ insetL: SURFACE_X, width: SURFACE_W, height: SURFACE_H, scaleY: -1, opacity: texture() === undefined ? 0 : 1 }}
    />
  );
}

export function Touchpad() {
  return (
    <View class={C.deck} style={{ bgColor: color("darker_background") }}>
      <Show when={surfacePackage()} keyed fallback={<Pad />}>
        {(w) => <Surface win={w} />}
      </Show>
    </View>
  );
}

function Pad() {
  return (
    <>
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
    </>
  );
}
