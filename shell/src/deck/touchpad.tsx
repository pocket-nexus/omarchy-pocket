// The deck's trackpad, under the keys in the keys layout and alone in the pad
// layout, after the trackpad of Pocket Shell's iPod touch remote. The stage
// takes no touch, so a finger here moves the pointer there (stage/pointer.tsx)
// as a laptop's trackpad does, relative and accelerated. A tap clicks where the
// pointer is. Two fingers scroll: the pointer stays where it is and the list
// under it moves with the fingers. The round Hold button and a finger drag: the
// pointer holds down and moves, which moves a slider or a picked-up row. In the
// keys layout the pointer shows from the first touch here until the next key.
//
// Two round buttons sit at the bottom of each margin and stay put when the
// trackpad grows: the microphone (deck/voice.ts) and Hold on the left, the
// keyboard (folds the keys away and back) and the key sheet on the right. A
// package that draws a touch surface of its own and is not a touch app
// (app.surfaces.auxiliary without `applet`) shows that surface in the pad layout
// instead, and the fingers on it are its contacts.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { perform } from "../actions.ts";
import { toggleVoice, voiceLevel, voiceState } from "./voice.ts";
import { C } from "../classes.ts";
import { inkShift } from "../ink.ts";
import { keySink, layout, toggleKeys, type Layout } from "../focus.ts";
import { flip, TOP_LEFT } from "../motion.ts";
import { appTextures } from "../packages.ts";
import { sheetOpen } from "../stage/keysheet.tsx";
import { chordSent, onTyped } from "../term/keyboard.tsx";
import { click, hold, movePointer, pinchTo, scrollBy } from "../stage/pointer.tsx";
import { color } from "../theme.ts";
import { settled, type TouchFrame } from "../touch.ts";
import { focused, type Win } from "../workspaces.ts";
import { BODY_H, inRect, PAD_LARGE, PAD_SMALL, ROUND, ROUNDS, type Rect } from "./geometry.ts";
import { pressed } from "./press.ts";

const padFor = (l: Layout): Rect => (l === "keys" ? PAD_SMALL : PAD_LARGE);
type RoundName = keyof typeof ROUNDS;
const ROUND_LIST: { name: RoundName; glyph: string }[] = [
  { name: "voice", glyph: "\u{f036c}" },
  { name: "hold", glyph: "\u{f01be}" },
  { name: "toggle", glyph: "\u{f030c}" },
  { name: "more", glyph: "\u{f01d8}" },
];
const roundAt = (x: number, y: number) => ROUND_LIST.find((r) => inRect(ROUNDS[r.name], x, y))?.name;

/** The round button's target under a finger, for the pressed look. */
export function roundTarget(x: number, y: number): string | null {
  const name = roundAt(x, y);
  return name ? `round:${name}` : null;
}
/** pointer points per deck point at rest, and how much speed adds */
const GAIN = 1.1;
const ACCEL = 0.09;
const MAX_GAIN = 3.2;

type Mode = "drag" | "scroll" | null;
const [mode, setMode] = createSignal<Mode>(null);

/** In the keys layout: the pointer shows from a touch here until the next key. */
const [awake, setAwake] = createSignal(false);
export const pointerAwake = awake;
onTyped(() => setAwake(false));

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
/** The fingers' distance when the second one counted: a spread or a squeeze
 *  from it is a pinch on the applet (stage/pointer.tsx pinchTo). */
let span = 0;

function move(dx: number, dy: number) {
  const speed = Math.hypot(dx, dy);
  const gain = Math.min(MAX_GAIN, GAIN + speed * ACCEL);
  if (speed > 0) movePointer(dx * gain, dy * gain);
}

/** The pad's fingers (body coordinates). Returns a package surface's
 *  contacts [id, x, y, ...] in its own points when the pad shows one. */
export function touchpadTouch(frame: TouchFrame): number[] {
  const l = layout();
  if (l === "pad" && surfacePackage()) {
    const contacts: number[] = [];
    for (const c of frame.down) {
      const x = (c.x - SURFACE_X) / SCALE;
      const y = c.y / SCALE;
      if (x >= 0 && x < 512 && y >= 0 && y < 384) contacts.push(c.id, x, y);
    }
    return contacts;
  }
  for (const c of frame.presses) {
    const name = roundAt(c.x, c.y);
    if (name === "toggle") toggleKeys();
    else if (name === "voice") toggleVoice();
    else if (name === "more") perform("keys");
  }
  const rect = padFor(l);
  const inPad = (x: number, y: number) => !keySink().field && inRect(rect, x, y);
  const onKey = (x: number, y: number) => inRect(ROUNDS.hold, x, y);
  const down = frame.down.filter(settled);
  const keyDown = down.some((c) => onKey(c.start.x, c.start.y));
  const pad = down.filter((c) => inPad(c.start.x, c.start.y));
  if (pad.length && !awake()) setAwake(true);
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
  if (next !== "scroll") span = 0;
  if (first) {
    if (next === "scroll") {
      // both fingers' mean, with what the first one travelled while the second was settling
      scrollBy((first.dx + second!.dx) / 2 + waiting.dx, (first.dy + second!.dy) / 2 + waiting.dy);
      waiting.dx = waiting.dy = 0;
      const apart = Math.hypot(second!.x - first.x, second!.y - first.y);
      if (span === 0) span = apart;
      pinchTo(apart / span);
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
    <View class={C.deck}>
      <Show when={layout() === "pad" && surfacePackage()} keyed fallback={<Pad />}>
        {(w) => <Surface win={w} />}
      </Show>
    </View>
  );
}

/** The line along the trackpad's bottom edge: what a chord sent, what the keys do here. */
const line = () => {
  const voice = voiceState();
  if (voice === "listening") return "listening · press the microphone to finish";
  if (voice === "decoding") return "turning that into text";
  const sent = chordSent();
  if (sent) return `sent ${sent}`;
  return keySink().hint?.() ?? (layout() === "pad" ? "tap to click · two fingers scroll or pinch" : "");
};

function Pad() {
  let node: NodeMirror | undefined;
  const rect = () => padFor(layout() === "keys" ? "keys" : "pad");
  // the keys fold away: the trackpad grows from where it was on the core's tracks
  createEffect(on(rect, (next, prev) => node && prev && prev !== next && flip(node, prev, next, 1, 1, 180), { defer: false }));
  const field = () => keySink().field;
  return (
    <>
      <View
        class="absolute rounded-lg"
        style={{ insetL: rect().x, insetT: rect().y, width: rect().w, height: rect().h, bgColor: color(mode() ? "selection" : "dark_background"), ...TOP_LEFT }}
        ref={(n: NodeMirror) => (node = n)}
      />
      <Show
        when={field()}
        fallback={
          <Text
            class="absolute h-[28] overflow-hidden text-center font-mono text-xs leading-[14]"
            style={{ insetL: rect().x + 12, insetT: rect().y + rect().h - 34, width: rect().w - 24, textColor: color(voiceState() !== "idle" || chordSent() ? "accent" : "muted") }}
          >
            {line()}
          </Text>
        }
      >
        {(value) => (
          <>
            <Text class="absolute text-center text-lg leading-[24]" style={{ insetL: rect().x, insetT: rect().y + rect().h / 2 - 26, width: rect().w, textColor: color("bright_foreground") }}>
              {value()()}
            </Text>
            <Text class="absolute h-[14] overflow-hidden text-center font-mono text-xs leading-[14]" style={{ insetL: rect().x + 8, insetT: rect().y + rect().h / 2 + 6, width: rect().w - 16, textColor: color("dark_foreground") }}>
              {keySink().hint?.() ?? ""}
            </Text>
          </>
        )}
      </Show>
      <For each={ROUND_LIST}>
        {(r) => {
          const listening = () => r.name === "voice" && voiceState() === "listening";
          const lit = () => (r.name === "voice" ? voiceState() === "decoding" : r.name === "hold" ? mode() === "drag" : r.name === "toggle" ? layout() === "keys" : r.name === "more" ? sheetOpen() : false);
          const at = ROUNDS[r.name];
          return (
            <View class="absolute w-[44] h-[44] rounded-full" style={{ insetL: at.x, insetT: at.y, bgColor: color(listening() ? "red" : pressed(`round:${r.name}`) ? "selection" : "dark_background"), opacity: listening() ? 0.55 + 0.45 * voiceLevel() : 1 }}>
              <Text class="absolute left-0 text-center text-xl leading-[24]" style={{ insetT: ROUND / 2 - 12, insetL: -inkShift(r.glyph, 20), width: ROUND, textColor: color(listening() ? "bright_foreground" : lit() ? "accent" : "foreground") }}>
                {r.glyph}
              </Text>
            </View>
          );
        }}
      </For>
    </>
  );
}
