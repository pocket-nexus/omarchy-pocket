// The Omarchy bridge protocol between the shell (a PocketJS realm in
// omarchy-pocket-host) and omarchy-pocketd: one JSON object per line over
// $XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock. Both processes run as the
// Omarchy user. The shell sends requests; the daemon sends one reply per
// request (matched by id) and events whenever it has them.

import type { Run } from "../vendor/pocket-term/shared/protocol.ts";
import type { ImeSnapshot } from "../vendor/pocketjs/contracts/spec/ime.ts";

export type { ImeSnapshot, Run };

export const BRIDGE_DIRECTORY = "omarchy-pocket";
export const BRIDGE_SOCKET = "bridge.sock";

/** Every terminal's grid: the top panel below the bar, in 6.4 x 14-point
 *  cells of the 12 px mono face. 80 columns, the width full-screen TUIs
 *  (btop) require. */
export const TERM_COLS = 80;
export const TERM_ROWS = 26;

/** Column, row, 1 when visible. */
export type Cursor = [number, number, number];
/** A row index and its runs (Pocket Term's Run: col, text, fg, bg, ...). */
export type TermRow = [number, Run[]];

export type Request =
  /** Runs `bash -c command` with Omarchy's environment and replies with its
   *  exit code and output once it exits. */
  | { id: number; method: "run"; command: string }
  /** Runs each command; true where it exits 0. The Omarchy menu's `when`,
   *  `checked` and `disabled` fields are such commands. */
  | { id: number; method: "conditions"; commands: string[] }
  /** The current SystemState; the daemon also pushes it as `state` events. */
  | { id: number; method: "state" }
  /** The shell's answer to a `shell` event: whether it ran the call, and
   *  what the call printed. */
  | { id: number; method: "answer"; call: number; handled: boolean; output?: string }
  /** Starts a terminal session; replies with its sid. No argv: a login shell. */
  | { id: number; method: "termOpen"; argv?: string[]; title?: string }
  /** Text typed into a session, as is. */
  | { id: number; method: "termInput"; sid: number; text: string }
  /** A named key (Enter, Up, F5, ...) or one character with modifiers. */
  | { id: number; method: "termKey"; sid: number; key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }
  /** Text pasted as one block (bracketed when the program asked for it). */
  | { id: number; method: "termPaste"; sid: number; text: string }
  /** Ends a session (SIGHUP to its process). */
  | { id: number; method: "termClose"; sid: number }
  /** the session's grid, at most TERM_COLS x TERM_ROWS */
  | { id: number; method: "termResize"; sid: number; cols: number; rows: number }
  /** The open sessions; each also sends a full snapshot as `termRows`. */
  | { id: number; method: "termList" }
  /** Runs a notification's command (action -1) or one of its actions, and closes it. */
  | { id: number; method: "notifyInvoke"; notice: number; action: number }
  | { id: number; method: "notifyDismiss"; notice: number }
  /** Recent notifications, newest first. */
  | { id: number; method: "notifyList" }
  /** Omarchy's current background (or `path`) as wallpaper textures; `fit`
   *  letterboxes the whole image instead of cropping it to the panel. */
  | { id: number; method: "wallpaper"; path?: string; fit?: boolean }
  /** Omarchy's screensaver text (~/.config/omarchy/branding/screensaver.txt) */
  | { id: number; method: "screensaver" }
  | { id: number; method: "systemStats" }
  | { id: number; method: "processes"; sort?: "cpu" | "mem" }
  | { id: number; method: "pictures" }
  | { id: number; method: "notes" }
  | { id: number; method: "noteRead"; name: string }
  | { id: number; method: "noteWrite"; name: string; text: string }
  | { id: number; method: "network"; rescan?: boolean }
  | { id: number; method: "wifiConnect"; ssid: string; password?: string }
  | { id: number; method: "wifiDisconnect" }
  | { id: number; method: "wifiForget"; ssid: string }
  | { id: number; method: "wifiPower"; on: boolean }
  | { id: number; method: "audio" }
  | { id: number; method: "audioSet"; kind: "sink" | "source"; name: string; volume?: number; muted?: boolean; current?: boolean }
  | { id: number; method: "power" }
  | { id: number; method: "powerSet"; profile?: string; brightness?: number }
  | { id: number; method: "bluetooth"; scan?: boolean }
  | { id: number; method: "bluetoothPower"; on: boolean }
  | { id: number; method: "bluetoothConnect"; mac: string }
  | { id: number; method: "bluetoothDisconnect"; mac: string }
  | { id: number; method: "bluetoothForget"; mac: string }
  /** Characters the shell is about to draw; true when they need a new atlas
   *  (an `atlas` event follows). */
  | { id: number; method: "glyphs"; text: string }
  /** The run-time atlases as they are now. */
  | { id: number; method: "atlases" }
  /** Desktop entries that run in a terminal, for the Apps menu. */
  | { id: number; method: "apps" }
  /** Evaluates a pinyin key transcript (PocketJS IME key codes). */
  | { id: number; method: "ime"; keys: number[] }
  /** The Omarchy user's password, for the lock screen. */
  | { id: number; method: "checkPassword"; password: string };

/** A request without its id, as the shell's bridge.request() takes it. */
export type RequestBody = Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Activity's figures (daemon/applets.ts). */
export interface SystemStats {
  /** percent of all cores, then each core */
  cpu: number;
  cores: number[];
  mhz: number;
  /** kB */
  memTotal: number;
  memUsed: number;
  temps: { name: string; celsius: number }[];
  /** bytes per second, all interfaces but lo */
  rx: number;
  tx: number;
  uptime: number;
  load: string;
}

export interface Process {
  pid: number;
  cpu: number;
  rssKb: number;
  name: string;
}

export interface Picture {
  name: string;
  path: string;
  /** Pictures or Backgrounds */
  group: string;
}

/** Omarchy's idle settings (shell.json `idle`, seconds) and its toggles. */
export interface IdleSettings {
  screensaver: number;
  lock: number;
  /** ~/.local/state/omarchy/toggles/screensaver-off */
  screensaverOff: boolean;
  /** the Stay Awake indicator: no idle actions */
  stayAwake: boolean;
}

/** An application the Apps menu can start (daemon/apps.ts). */
export interface App {
  id: string;
  name: string;
  /** a shell command (terminal applications) */
  command: string;
  /** a PocketJS package the host program runs in place of the shell */
  applet?: string;
}

/** A run-time font atlas omarchy-pocketd baked (daemon/glyphs.ts). */
export interface AtlasFile {
  slot: number;
  path: string;
  gen: number;
  glyphs: number;
}

/** Whether a code point needs a run-time glyph: it is outside every range the
 *  shell package bakes for all text (ASCII, Latin-1, general punctuation,
 *  arrows, box drawing and blocks, Braille). The Nerd Font icons in the
 *  private use areas count too: the package bakes only the menu's. */
export function needsRuntimeGlyph(cp: number): boolean {
  if (cp <= 0x7e || (cp >= 0xa0 && cp <= 0xff)) return false;
  if ((cp >= 0x2010 && cp <= 0x205e) || (cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x2500 && cp <= 0x259f) || (cp >= 0x2800 && cp <= 0x28ff)) return false;
  return cp >= 0x100;
}

/** Emoji command-line tools print, drawn as the Nerd Font icon for the same
 *  thing: no face on the device has their outlines (Noto Color Emoji is
 *  bitmaps). starship marks a read-only directory with 🔒. */
export const EMOJI_ICONS: Record<number, number> = {
  0x1f512: 0xf023, // 🔒 lock
  0x1f513: 0xf09c, // 🔓 unlock
  0x2705: 0xf00c, // ✅ check
  0x274c: 0xf00d, // ❌ cross
  0x26a0: 0xf071, // ⚠ warning
  0x1f680: 0xf135, // 🚀 rocket
  0x1f4c1: 0xf07b, // 📁 folder
  0x1f4e6: 0xf487, // 📦 package
  0x1f40d: 0xe73c, // 🐍 python
  0x1f980: 0xe7a8, // 🦀 rust
  0x23f1: 0xf017, // ⏱ clock
  0x1f527: 0xf0ad, // 🔧 wrench
};

/** The run-time CJK slots: 12 px for terminal cells, 14 px for text-sm. */
export const CJK_SLOT_12 = 21;
export const CJK_SLOT_14 = 22;

/** One wallpaper texture: a raw RGBA8888 file of w x h pixels at (x, y) on
 *  the top panel's 1024 x 768 pixels. */
export interface WallTile {
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  secure: boolean;
  active: boolean;
  /** NetworkManager has a saved connection for it */
  known: boolean;
}

export interface NetworkPanel {
  enabled: boolean;
  /** the connected one first, then by signal */
  networks: WifiNetwork[];
  address: string;
}

export interface AudioDevice {
  name: string;
  label: string;
  volume: number;
  muted: boolean;
  /** the default sink or source */
  current: boolean;
}

export interface AudioPanel {
  outputs: AudioDevice[];
  inputs: AudioDevice[];
}

export interface BluetoothDevice {
  mac: string;
  name: string;
  paired: boolean;
  connected: boolean;
}

export interface BluetoothPanel {
  /** a controller is attached (rgds-bluetooth.service) */
  adapter: boolean;
  powered: boolean;
  devices: BluetoothDevice[];
}

export interface PowerPanel {
  profiles: string[];
  profile: string;
  /** percent of both panels' backlights */
  brightness: number | null;
}

/** A desktop notification (org.freedesktop.Notifications Notify). */
export interface Notice {
  id: number;
  app: string;
  summary: string;
  body: string;
  /** Omarchy's omarchy-glyph hint: one Nerd Font glyph */
  glyph: string;
  icon: string;
  /** 0 low, 1 normal, 2 critical */
  urgency: number;
  /** labels of the actions, in order */
  actions: string[];
}

/** Omarchy's bar settings (shell.json and the bar-off toggle). */
export interface BarSettings {
  position: string;
  /** opaque, glassy or none */
  background: string;
  /** the clock's Qt date format, e.g. "dddd HH:mm" */
  clock: string;
  hidden: boolean;
}

export interface SystemState {
  battery: { percent: number; charging: boolean } | null;
  network: { kind: "wifi" | "ethernet" | "none"; name: string; signal: number | null };
  audio: { volume: number; muted: boolean } | null;
  bluetooth: { powered: boolean } | null;
  powerProfile: string | null;
  /** Omarchy's current theme: its name and colors.toml */
  theme: { name: string; colors: Record<string, string> } | null;
  bar: BarSettings;
  idle: IdleSettings;
}

export type Event =
  /** Sent first on every bridge connection: what the shell knew of an
   *  earlier daemon (terminals, atlases) may be gone. */
  | { event: "hello" }
  | { event: "state"; state: SystemState }
  /** An `omarchy-shell <target> <method> [args...]` call from Omarchy's CLI.
   *  The shell answers it with an `answer` request carrying `call`. */
  | { event: "shell"; call: number; target: string; method: string; args: string[] }
  /** A terminal some program started (xdg-terminal-exec runs Pocket Term). */
  | { event: "termOpened"; sid: number; title: string }
  /** Rows that changed (every row when full), and the cursor. */
  | { event: "termRows"; sid: number; rows: TermRow[]; cursor: Cursor; full: boolean }
  | { event: "termTitle"; sid: number; title: string }
  | { event: "termExit"; sid: number; code: number | null }
  /** New run-time glyph atlases to load (omarchyBridge.loadFontAtlas). */
  | { event: "atlas"; atlases: AtlasFile[] }
  /** logind is about to suspend: the shell locks first. */
  | { event: "sleep" }
  | { event: "notify"; notice: Notice }
  /** reason: 1 expired, 2 dismissed, 3 closed by the program */
  | { event: "notifyClosed"; notice: number; reason: number };

export type DaemonMessage = Reply | Event;
