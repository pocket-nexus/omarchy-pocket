// The uConsole's trackball and its two mouse buttons, which the shell reads
// once a frame (`omarchyBridge.trackball()`, host/src/uconsole.rs) and moves
// the stage's pointer with (stage/pointer.tsx), as the RG DS Plus's trackpad
// does. The ball sits under the right thumb; L and R under the left, so one
// thumb points while the other clicks, the way the keyboard's maker laid
// them out.
//
//   the ball      moves the pointer; pressed, it clicks as L does
//   L             the click: down on an applet is a touch held until L is up
//                 (a press is a tap, a press and roll a drag); elsewhere it
//                 acts at once (a card's row, a workspace number, an
//                 indicator's panel, a window's focus)
//   R             the other click: Back in a touch app and in the menu, the
//                 window carried to a workspace number, and Omarchy's menu on
//                 the bare wallpaper, where a desktop puts its own
//   SELECT + ball the firmware's wheel: the list under the pointer scrolls,
//                 a card's selection moves; under SUPER it steps workspaces,
//                 as Omarchy's SUPER + wheel does
import { createSignal } from "solid-js";
import { perform } from "./actions.ts";
import { pressBack } from "./packages.ts";
import { card, cardKey, closeCard, onCard } from "./stage/card.tsx";
import { carryWindowTo, click, hold, movePointer, pointer, scrollBy, targetAt } from "./stage/pointer.tsx";
import { toggleMenu } from "./stage/menu.tsx";
import { superLayer, used } from "./super.ts";
import { focusWindow, windowAt } from "./workspaces.ts";
import { watching } from "./watch.ts";

interface Bridge {
  trackball?: () => number[];
}
const bridge = (globalThis as { omarchyBridge?: Bridge }).omarchyBridge;

/** points per count at rest, and how much speed adds (the firmware already glides) */
const GAIN = 0.9;
const ACCEL = 0.06;
const MAX_GAIN = 2.6;
/** points a wheel detent scrolls a list */
const WHEEL_STEP = 24;
/** frames without a detent that end a scroll */
const WHEEL_END = 10;

const L = 1;
const R = 2;
const BALL = 4;

/** The pointer shows from the ball's first roll until the next typed key. */
const [awake, setAwake] = createSignal(false);
export const trackballAwake = awake;
export const sleepPointer = () => setAwake(false);

let buttons = 0;
/** the touch L holds on an applet, from its press to its release */
let holding = false;
let wheelIdle = 0;
let scrolling = false;
let wheeled = false;

/** SELECT's hold: starts watching for the wheel (true), or says whether
 *  the ball turned it since (false): SELECT alone shows the controls. */
export function wheeledWhile(start: boolean): boolean {
  if (start) wheeled = false;
  return wheeled;
}

/** samples `pocket.input ball|wheel|button` queues (remote-input.ts), one a frame */
const injected: number[][] = [];
export const injectTrackball = (sample: number[]) => injected.push(sample);

/** While the panel is dark: what the ball did is dropped, and its buttons
 *  are remembered as held, so letting one go after the panel lights acts on
 *  nothing. */
export function discardTrackball() {
  const real = bridge?.trackball?.();
  injected.length = 0;
  if (real) buttons = real[3] ?? 0;
}

/** Once per frame: what the ball and its buttons did. Returns whether
 *  anything happened (the idle timers' input). */
export function trackballTick(): boolean {
  const real = bridge?.trackball?.();
  const extra = injected.shift();
  if (!real && !extra) return false;
  const sample = [0, 1, 2, 3].map((i) => (i === 3 ? (real?.[i] ?? 0) | (extra?.[i] ?? 0) : (real?.[i] ?? 0) + (extra?.[i] ?? 0)));
  const [dx = 0, dy = 0, wheel = 0, now = 0] = sample;
  const down = now & ~buttons;
  const up = buttons & ~now;
  buttons = now;
  if (watching() && (down || up || wheel)) console.log(`trackball: down ${down} up ${up} wheel ${wheel} card ${card()} at ${pointer().x.toFixed(0)},${pointer().y.toFixed(0)}`);
  const active = dx !== 0 || dy !== 0 || wheel !== 0 || now !== 0 || up !== 0;
  if (dx || dy) {
    const speed = Math.hypot(dx, dy);
    const gain = Math.min(MAX_GAIN, GAIN + speed * ACCEL);
    movePointer(dx * gain, dy * gain);
    setAwake(true);
  }
  if (wheel) wheelTurned(wheel);
  else if (scrolling && ++wheelIdle > WHEEL_END) {
    scrolling = false;
    hold(false);
  }
  // L and the ball press are the one click
  if (down & (L | BALL)) primaryDown();
  if (up & (L | BALL) && !(now & (L | BALL))) primaryUp();
  if (down & R) secondary();
  return active;
}

function primaryDown() {
  setAwake(true);
  const target = card() ? null : targetAt(pointer().x, pointer().y);
  if (target === "applet") {
    hold(true, true);
    holding = true;
  } else click();
}

function primaryUp() {
  if (!holding) return;
  holding = false;
  hold(false);
}

/** R: the other click, by what is under the pointer. */
function secondary() {
  setAwake(true);
  const { x, y } = pointer();
  if (card()) {
    // back a level, and out of the menu at its top, as Backspace and Escape do
    if (!onCard(x, y)) return closeCard();
    return cardKey("Backspace");
  }
  const target = targetAt(x, y);
  if (typeof target === "object" && target.kind === "workspace") return carryWindowTo(target.ws);
  if (typeof target === "object" && target.kind === "window") return focusWindow(target.id);
  if (target === "applet") {
    const id = windowAt(x, y);
    if (id !== null) focusWindow(id);
    return pressBack();
  }
  if (target === "wallpaper") toggleMenu();
}

function wheelTurned(detents: number) {
  wheelIdle = 0;
  wheeled = true;
  // Omarchy's SUPER + wheel: the workspace before or after
  if (superLayer() !== "plain") {
    used("step");
    return perform(detents > 0 ? "ws.prev" : "ws.next");
  }
  if (card()) {
    for (let i = 0; i < Math.abs(detents); i++) cardKey(detents > 0 ? "Up" : "Down");
    return;
  }
  if (!scrolling) {
    if (targetAt(pointer().x, pointer().y) !== "applet") return;
    scrolling = true;
    hold(true, false);
  }
  // the ball rolled away from the user: the content comes down, as a wheel scrolls up
  scrollBy(0, detents * WHEEL_STEP);
}
