// daemon/volume-keys.ts: which devices have the volume keys, and the steps
// a run of input events makes.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasKey, volumeKeyDevices, volumeSteps } from "./volume-keys.ts";

const event = (type: number, code: number, value: number) => {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(type, 16);
  b.writeUInt16LE(code, 18);
  b.writeInt32LE(value, 20);
  return b;
};

test("the RG DS Plus key device's bitmap has both volume keys; the ADC keys' does not", () => {
  // /sys/class/input/event5/device/capabilities/key on the device (ANBERNIC-rk3568-keys)
  const anbernic = "400000000 1fff000000000000 0 0 c000000000000 2";
  expect(hasKey(anbernic, 114)).toBe(true);
  expect(hasKey(anbernic, 115)).toBe(true);
  expect(hasKey(anbernic, 304)).toBe(true); // BTN_SOUTH, the A button
  expect(hasKey("40000000 0 0", 114)).toBe(false);
});

test("devices with both keys are found, in event order", () => {
  const root = mkdtempSync(join(tmpdir(), "volume-keys-"));
  try {
    const device = (name: string, bitmap: string | null) => {
      mkdirSync(join(root, name, "device", "capabilities"), { recursive: true });
      if (bitmap !== null) writeFileSync(join(root, name, "device", "capabilities", "key"), bitmap);
    };
    device("event10", "c000000000000 0");
    device("event4", "40000000 0 0");
    device("event5", "400000000 1fff000000000000 0 0 c000000000000 2");
    device("event2", null);
    expect(volumeKeyDevices(root)).toEqual(["/dev/input/event5", "/dev/input/event10"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a press and each repeat are a step; a release, other keys and other types are none", () => {
  const run = Buffer.concat([event(1, 115, 1), event(0, 0, 0), event(1, 115, 2), event(1, 115, 2), event(1, 115, 0), event(1, 114, 1), event(1, 304, 1), event(3, 114, 1)]);
  expect(volumeSteps(run)).toEqual([1, 1, 1, -1]);
});
