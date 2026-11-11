// daemon/uconsole.ts: the keys the shell never sees, from runs of input events.
import { expect, test } from "bun:test";
import { uconsoleKeys } from "./uconsole.ts";

const event = (type: number, code: number, value: number) => {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(type, 16);
  b.writeUInt16LE(code, 18);
  b.writeInt32LE(value, 20);
  return b;
};
const run = (...events: Buffer[]) => new Uint8Array(Buffer.concat(events));

test("brightness repeats, mute and power press once, releases do nothing", () => {
  const keys = uconsoleKeys(run(event(1, 225, 1), event(1, 225, 2), event(1, 225, 0), event(1, 224, 1), event(1, 113, 1), event(1, 113, 2), event(1, 116, 1), event(1, 116, 0)), false);
  expect(keys).toEqual(["brightness-up", "brightness-up", "brightness-down", "mute", "power"]);
});

test("the keyboard, its joystick and its trackball wake a dark panel; other devices do not", () => {
  expect(uconsoleKeys(run(event(1, 30, 1), event(2, 0, 4)), true)).toEqual(["any", "any"]);
  expect(uconsoleKeys(run(event(1, 30, 1), event(2, 0, 4)), false)).toEqual([]);
});
