// omarchy-pocketd on the AYN Thor, in the Android app's Linux environment
// (proot, android/app's LinuxService). Android owns the device there: no
// systemd, logind, NetworkManager, PipeWire or BlueZ runs, and evdev is
// closed to the app. The app keeps what the shell's bar and panels show in
// one JSON file and carries out what the shell asks of the device:
//
//   $XDG_RUNTIME_DIR/omarchy-pocket/android.json      the app writes it at each
//       change: battery, network, audio (the media volume), Bluetooth
//   $XDG_RUNTIME_DIR/omarchy-pocket/android-commands/  the daemon (and the
//       wpctl shim) drop one JSON command per file; the app runs and removes it
//
// The app also handles the volume keys and the screen going off (the shell
// hears `sleep` and locks), so the daemon watches neither.
import { mkdirSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SystemState } from "./protocol.ts";

export const ANDROID = process.env.OMARCHY_POCKET_PLATFORM === "android";

const RUNTIME = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 0}`;
const DIR = join(RUNTIME, "omarchy-pocket");
export const STATE_FILE = join(DIR, "android.json");
export const COMMANDS = join(DIR, "android-commands");

/** What the app reports, in SystemState's own shapes. */
export interface AndroidState {
  battery: SystemState["battery"];
  network: SystemState["network"];
  audio: SystemState["audio"];
  bluetooth: SystemState["bluetooth"];
  /** Wi-Fi switched on, whether or not it is connected */
  wifi: boolean;
  /** the active network's IPv4 address */
  address: string;
  /** the screens' brightness, percent */
  brightness: number | null;
}

const EMPTY: AndroidState = { battery: null, network: { kind: "none", name: "", signal: null }, audio: null, bluetooth: null, wifi: false, address: "", brightness: null };

/** The app's last report, or nothing yet. */
export function androidState(): AndroidState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<AndroidState>;
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

/** Calls `changed` when the app writes a new report (it renames a complete file into place). */
export function watchAndroid(changed: () => void, log: (...parts: unknown[]) => void) {
  mkdirSync(DIR, { recursive: true });
  let pending: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(DIR, (_, name) => {
      if (name !== "android.json" || pending) return;
      pending = setTimeout(() => {
        pending = null;
        changed();
      }, 50);
    });
  } catch (error) {
    log("android: watching", DIR, error instanceof Error ? error.message : error);
  }
}

export type AndroidCommand =
  | { command: "volume"; percent: number }
  | { command: "mute"; muted: boolean | "toggle" }
  | { command: "brightness"; percent: number }
  | { command: "settings"; panel: "wifi" | "bluetooth" | "sound" | "display" | "battery" | "internet" }
  | { command: "open"; url: string };

let sequence = 0;
/** Hands the app a command: one file, renamed into place once written. */
export function androidCommand(command: AndroidCommand) {
  mkdirSync(COMMANDS, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${sequence++}.json`;
  const partial = join(COMMANDS, `.${name}`);
  writeFileSync(partial, JSON.stringify(command));
  renameSync(partial, join(COMMANDS, name));
}
