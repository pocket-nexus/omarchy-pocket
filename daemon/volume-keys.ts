// The device's volume keys. KEY_VOLUMEDOWN and KEY_VOLUMEUP come from the
// gamepad's key device (ANBERNIC-rk3568-keys on the RG DS Plus), which the
// host program reads for the buttons and never grabs, so this reads the same
// events (through evdev.ts): each press and each auto-repeat is one step. Every
// /dev/input/event* whose key capabilities have both codes is read (a
// Bluetooth keyboard's volume keys too), and the list is read again every
// RESCAN_MS for devices that came later. volumeStepper turns the steps into
// volume changes: one wpctl round at a time, the steps that arrive meanwhile
// summed into the next round, and Omarchy's volume OSD after each.
import { readdirSync, readFileSync } from "node:fs";
import { readDevice, type DeviceReader } from "./evdev.ts";
import { levelOsd, VOLUME_MAX, type OsdPayload } from "./protocol.ts";

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
  const open = new Map<string, DeviceReader>();
  const logged = new Set<string>();
  const scan = () => {
    for (const path of volumeKeyDevices(root)) {
      if (open.has(path)) continue;
      open.set(
        path,
        readDevice(
          path,
          (data) => {
            for (const delta of volumeSteps(data)) step(delta);
          },
          (code) => {
            // gone (a keyboard switched off): the next scan opens it again;
            // a device it could not read is said once
            open.delete(path);
            if (code !== 0 && !logged.has(path)) {
              logged.add(path);
              log(`volume keys: ${path}: cat exited ${code}`);
            }
          },
        ),
      );
    }
  };
  scan();
  const timer = setInterval(scan, RESCAN_MS);
  return () => {
    clearInterval(timer);
    for (const reader of open.values()) reader.stop();
    open.clear();
  };
}

/** a volume key's step, in percent */
export const VOLUME_STEP = 5;
/** PipeWire answers get-volume with the old value for a moment after a set:
 *  steps this close to the last one build on the value the keys set */
const SETTLE_MS = 1500;
const SPEAKER = "\u{f057e}";
const MUTED = "\u{f075f}";

export interface VolumeControl {
  /** the default sink's volume (percent) and mute, or null */
  read(): Promise<{ volume: number; muted: boolean } | null>;
  /** set the volume, unmuting first when asked; false when wpctl failed */
  set(volume: number, unmute: boolean): Promise<boolean>;
  /** the OSD for a set that took */
  shown(osd: OsdPayload): void;
  now?: () => number;
}

/** A step function for watchVolumeKeys: 0 to VOLUME_MAX as the Sound panel's
 *  slider goes; a step up unmutes; a held key's repeats sum while a round runs. */
export function volumeStepper(control: VolumeControl): (delta: number) => void {
  const now = control.now ?? Date.now;
  let pending = 0;
  let running = false;
  let keyed: { volume: number; at: number } | null = null;
  const round = async () => {
    running = true;
    try {
      while (pending !== 0) {
        const delta = pending;
        pending = 0;
        const current = await control.read();
        if (!current) continue;
        const base = keyed && now() - keyed.at < SETTLE_MS ? keyed.volume : current.volume;
        const next = Math.max(0, Math.min(VOLUME_MAX, base + delta * VOLUME_STEP));
        const unmute = delta > 0 && current.muted;
        if (!(await control.set(next, unmute))) {
          keyed = null;
          continue;
        }
        keyed = { volume: next, at: now() };
        const muted = current.muted && !unmute;
        control.shown(levelOsd(muted || next === 0 ? MUTED : SPEAKER, next, VOLUME_MAX, muted ? "Muted" : undefined));
      }
    } finally {
      running = false;
    }
  };
  return (delta) => {
    pending += delta;
    if (!running) void round();
  };
}
