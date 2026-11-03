// daemon/volume-keys.ts: which devices have the volume keys, and the steps
// a run of input events makes.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VOLUME_MAX, type OsdPayload } from "./protocol.ts";
import { hasKey, volumeKeyDevices, volumeStepper, volumeSteps, type VolumeControl } from "./volume-keys.ts";

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

describe("volumeStepper", () => {
  /** a sink whose get-volume answers what was set only after `lag` reads, as PipeWire's does */
  function sink(volume: number, muted = false) {
    const sets: { volume: number; unmute: boolean }[] = [];
    const shown: OsdPayload[] = [];
    let clock = 0;
    let fail = false;
    const control: VolumeControl = {
      read: async () => ({ volume, muted }),
      set: async (v, unmute) => {
        await Bun.sleep(5);
        if (fail) return false;
        sets.push({ volume: v, unmute });
        return true;
      },
      shown: (osd) => shown.push(osd),
      now: () => clock,
    };
    return { control, sets, shown, tick: (ms: number) => (clock += ms), failNext: (on: boolean) => (fail = on) };
  }
  const settled = () => Bun.sleep(40);

  test("steps in a burst are one set, and steps in a row build on the last set, not on a stale read", async () => {
    const s = sink(40);
    const step = volumeStepper(s.control);
    step(1);
    step(1);
    step(1);
    await settled();
    // the first round has the first step; the two that came while it ran are the next
    expect(s.sets.map((x) => x.volume)).toEqual([45, 55]);
    step(1);
    await settled();
    expect(s.sets.at(-1)!.volume).toBe(60);
    // a pause past the settle: the sink's own reading again
    s.tick(2000);
    step(-1);
    await settled();
    expect(s.sets.at(-1)!.volume).toBe(35);
    expect(s.shown.at(-1)).toEqual({ icon: "\u{f057e}", value: 35, max: 100, progressText: "35%" });
  });

  test("0 to 150, the bar's span past 100, a step up unmutes, a muted step down says Muted", async () => {
    const loud = sink(148);
    volumeStepper(loud.control)(1);
    await settled();
    expect(loud.sets[0]!.volume).toBe(VOLUME_MAX);
    expect(loud.shown[0]).toMatchObject({ value: 150, max: 150 });
    const quiet = sink(0, true);
    const step = volumeStepper(quiet.control);
    step(-1);
    await settled();
    expect(quiet.sets[0]).toEqual({ volume: 0, unmute: false });
    expect(quiet.shown[0]).toMatchObject({ icon: "\u{f075f}", progressText: "Muted" });
    quiet.tick(2000);
    step(1);
    await settled();
    expect(quiet.sets[1]).toEqual({ volume: 5, unmute: true });
    expect(quiet.shown[1]).toMatchObject({ icon: "\u{f057e}", progressText: "5%" });
  });

  test("a set that failed shows nothing", async () => {
    const s = sink(40);
    s.failNext(true);
    volumeStepper(s.control)(1);
    await settled();
    expect(s.shown).toEqual([]);
  });
});
