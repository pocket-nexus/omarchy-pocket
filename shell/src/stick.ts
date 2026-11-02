// R1 and a stick resize the focused window as the stick is pushed (chords.ts):
// right makes it wider and left narrower, up taller and down shorter. In
// dwindle the nearest split across that direction moves; in scrolling the
// column's width changes. A push past DEAD takes one RESIZE_STEP at once and
// another every few frames while it holds, sooner the further the stick
// goes, as a held key repeats. Either stick does it; `omarchy-shell
// pocket.input stick <x> <y> [frames]` stands in for one over SSH.
import { analogX, analogY, rightAnalogX, rightAnalogY } from "@pocketjs/framework/lifecycle";
import { act } from "./workspaces.ts";

const DEAD = 0.35;
/** frames between steps, just past the dead zone and at full push */
const SLOW = 14;
const FAST = 4;
const wait = [0, 0];
const remote = { x: 0, y: 0, frames: 0 };

/** A stick pushed to (x, y), each -1..1, for `frames` frames. */
export function holdStick(x: number, y: number, frames: number) {
  Object.assign(remote, { x, y, frames });
}

function read(): [number, number] {
  if (remote.frames > 0) {
    remote.frames--;
    return [remote.x, remote.y];
  }
  const left: [number, number] = [analogX(), analogY()];
  const right: [number, number] = [rightAnalogX(), rightAnalogY()];
  return Math.hypot(...left) >= Math.hypot(...right) ? left : right;
}

function step(axis: 0 | 1, push: number) {
  if (Math.abs(push) < DEAD) return void (wait[axis] = 0);
  if (wait[axis]! > 0) return void wait[axis]!--;
  act((m) => m.resizeAxis(axis === 0 ? "x" : "y", Math.sign(push)));
  wait[axis] = Math.round(SLOW + (FAST - SLOW) * ((Math.abs(push) - DEAD) / (1 - DEAD)));
}

/** Once per frame: `active` while R1's layer is held. */
export function stickTick(active: boolean) {
  const [x, y] = active ? read() : [0, 0];
  step(0, x);
  // the stick's y grows downward; up makes the window taller
  step(1, -y);
}
