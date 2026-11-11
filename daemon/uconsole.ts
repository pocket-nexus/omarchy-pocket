// The ClockworkPi uConsole's keys the shell never sees (OMARCHY_POCKET_PLATFORM
// =uconsole, set by /usr/lib/omarchy-pocket/omarchy-root). The keyboard's
// consumer function (`ClockworkPI uConsole Consumer Control`) sends
// Fn+, and Fn+. as KEY_BRIGHTNESSDOWN and KEY_BRIGHTNESSUP and Fn+the volume
// key as KEY_MUTE (the volume keys themselves are volume-keys.ts's); the
// AXP228's power key (`axp20x-pek`) sends KEY_POWER, which logind leaves
// alone (HandlePowerKey=ignore). Like volume-keys.ts this reads the devices
// beside the host program, which never grabs them (evdev.ts).
//
//   brightness   the panel's backlight a tenth up or down, with Omarchy's OSD
//   mute         the default sink muted or back, with the OSD
//   power        the panel dark and the shell locked; the next key, any key
//                on the keyboard or a roll of the trackball, lights it again
//                on the lock screen
//
// The CM4 has no suspend to RAM: a dark panel is the uConsole's sleep.
import { readdirSync, readFileSync } from "node:fs";
import { readDevice, type DeviceReader } from "./evdev.ts";
import { hasKey } from "./volume-keys.ts";

export const UCONSOLE = process.env.OMARCHY_POCKET_PLATFORM === "uconsole";

const EV_KEY = 1;
const KEY_MUTE = 113;
const KEY_POWER = 116;
const KEY_BRIGHTNESSDOWN = 224;
const KEY_BRIGHTNESSUP = 225;
const EVENT_BYTES = 24;
const KEYBOARD = "ClockworkPI uConsole Keyboard";
const JOYSTICK = "ClockworkPI uConsole";
const MOUSE = "ClockworkPI uConsole Mouse";
const EV_REL = 2;

export type UconsoleKey = "brightness-up" | "brightness-down" | "mute" | "power" | "any";

/** The keys of one chunk of input_events: presses and repeats only. */
export function uconsoleKeys(data: Uint8Array, wakers: boolean): UconsoleKey[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: UconsoleKey[] = [];
  for (let at = 0; at + EVENT_BYTES <= data.length; at += EVENT_BYTES) {
    const type = view.getUint16(at + 16, true);
    if (type === EV_REL && wakers) {
      out.push("any");
      continue;
    }
    if (type !== EV_KEY) continue;
    const code = view.getUint16(at + 18, true);
    const value = view.getInt32(at + 20, true);
    if (value === 0) continue;
    if (code === KEY_BRIGHTNESSUP) out.push("brightness-up");
    else if (code === KEY_BRIGHTNESSDOWN) out.push("brightness-down");
    else if (code === KEY_MUTE && value === 1) out.push("mute");
    else if (code === KEY_POWER && value === 1) out.push("power");
    else if (wakers && value === 1) out.push("any");
  }
  return out;
}

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

/** The devices to read: those with the brightness, mute or power keys, and
 *  the keyboard, its joystick and its trackball, which wake a dark panel. */
function devices(root = "/sys/class/input"): { path: string; wakers: boolean }[] {
  let names: string[] = [];
  try {
    names = readdirSync(root).filter((n) => n.startsWith("event"));
  } catch {}
  const out: { path: string; wakers: boolean }[] = [];
  for (const name of names) {
    const bitmap = read(`${root}/${name}/device/capabilities/key`);
    const device = read(`${root}/${name}/device/name`);
    const wakers = device === KEYBOARD || device === JOYSTICK || device === MOUSE;
    if (wakers || [KEY_MUTE, KEY_POWER, KEY_BRIGHTNESSUP, KEY_BRIGHTNESSDOWN].some((code) => hasKey(bitmap, code))) out.push({ path: `/dev/input/${name}`, wakers });
  }
  return out;
}

/** Calls `key` for each of those keys until the returned stop(). */
export function watchUconsoleKeys(key: (which: UconsoleKey) => void, log: (...args: unknown[]) => void): () => void {
  const open = new Map<string, DeviceReader>();
  const scan = () => {
    for (const { path, wakers } of devices()) {
      if (open.has(path)) continue;
      open.set(
        path,
        readDevice(
          path,
          (data) => {
            for (const which of uconsoleKeys(data, wakers)) key(which);
          },
          (code) => {
            open.delete(path);
            if (code !== 0) log(`uconsole keys: ${path}: cat exited ${code}`);
          },
        ),
      );
    }
  };
  scan();
  const timer = setInterval(scan, 30_000);
  return () => {
    clearInterval(timer);
    for (const reader of open.values()) reader.stop();
    open.clear();
  };
}
