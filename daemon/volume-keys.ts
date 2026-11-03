// The device's volume keys. KEY_VOLUMEDOWN and KEY_VOLUMEUP come from the
// gamepad's key device (ANBERNIC-rk3568-keys on the RG DS Plus), which the
// host program reads for the buttons and never grabs, so this reads the same
// events: each press and each auto-repeat is one step. Every
// /dev/input/event* whose key capabilities have both codes is read (a
// Bluetooth keyboard's volume keys too), and the list is read again every
// RESCAN_MS for devices that came later.
import { createReadStream, readdirSync, readFileSync } from "node:fs";

const EV_KEY = 1;
const KEY_VOLUMEDOWN = 114;
const KEY_VOLUMEUP = 115;
/** struct input_event on 64-bit Linux: a timeval (16 bytes), type and code (u16), value (i32) */
const EVENT_BYTES = 24;

/** Whether the `capabilities/key` bitmap (hex words, the highest first) has `code`. */
export function hasKey(bitmap: string, code: number): boolean {
  const words = bitmap.trim().split(/\s+/).reverse();
  const word = words[Math.floor(code / 64)];
  return word !== undefined && ((BigInt(`0x${word}`) >> BigInt(code % 64)) & 1n) === 1n;
}

/** The input devices with both volume keys. */
export function volumeKeyDevices(root = "/sys/class/input"): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(root).filter((n) => n.startsWith("event"));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.sort((x, y) => Number(x.slice(5)) - Number(y.slice(5)))) {
    try {
      const bitmap = readFileSync(`${root}/${name}/device/capabilities/key`, "utf8");
      if (hasKey(bitmap, KEY_VOLUMEUP) && hasKey(bitmap, KEY_VOLUMEDOWN)) out.push(`/dev/input/${name}`);
    } catch {
      // a device without key capabilities
    }
  }
  return out;
}

/** The volume steps in a run of input events: +1 for up, -1 for down, a press or a repeat each. */
export function volumeSteps(events: Buffer): number[] {
  const out: number[] = [];
  for (let at = 0; at + EVENT_BYTES <= events.length; at += EVENT_BYTES) {
    if (events.readUInt16LE(at + 16) !== EV_KEY) continue;
    const code = events.readUInt16LE(at + 18);
    const value = events.readInt32LE(at + 20);
    if (value !== 1 && value !== 2) continue;
    if (code === KEY_VOLUMEUP) out.push(1);
    else if (code === KEY_VOLUMEDOWN) out.push(-1);
  }
  return out;
}

const RESCAN_MS = 30_000;

/** Calls `step` for every volume key press and repeat until the returned stop(). */
export function watchVolumeKeys(step: (delta: number) => void, log: (...args: unknown[]) => void, root = "/sys/class/input"): () => void {
  const open = new Map<string, ReturnType<typeof createReadStream>>();
  const scan = () => {
    for (const path of volumeKeyDevices(root)) {
      if (open.has(path)) continue;
      let rest = Buffer.alloc(0);
      const stream = createReadStream(path, { highWaterMark: EVENT_BYTES * 64 });
      open.set(path, stream);
      stream.on("data", (chunk) => {
        const data = rest.length ? Buffer.concat([rest, chunk as Buffer]) : (chunk as Buffer);
        const whole = data.length - (data.length % EVENT_BYTES);
        rest = data.subarray(whole);
        for (const delta of volumeSteps(data.subarray(0, whole))) step(delta);
      });
      stream.on("error", (error: NodeJS.ErrnoException) => {
        // ENODEV: the device went away, and close follows
        if (error.code !== "ENODEV") log(`volume keys: ${path}: ${error.message}`);
      });
      // gone (a keyboard switched off): the next scan opens it again
      stream.on("close", () => open.delete(path));
    }
  };
  scan();
  const timer = setInterval(scan, RESCAN_MS);
  return () => {
    clearInterval(timer);
    for (const stream of open.values()) stream.destroy();
    open.clear();
  };
}
