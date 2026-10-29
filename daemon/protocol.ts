// The Omarchy bridge protocol between the shell (a PocketJS realm in
// omarchy-pocket-host) and omarchy-pocketd: one JSON object per line over
// $XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock. Both processes run as the
// Omarchy user. The shell sends requests; the daemon sends one reply per
// request (matched by id) and events whenever it has them.

import type { Run } from "../vendor/pocket-term/shared/protocol.ts";

export type { Run };

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
  /** The open sessions; each also sends a full snapshot as `termRows`. */
  | { id: number; method: "termList" };

/** A request without its id, as the shell's bridge.request() takes it. */
export type RequestBody = Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export interface SystemState {
  battery: { percent: number; charging: boolean } | null;
  network: { kind: "wifi" | "ethernet" | "none"; name: string; signal: number | null };
  audio: { volume: number; muted: boolean } | null;
  bluetooth: { powered: boolean } | null;
  powerProfile: string | null;
  /** Omarchy's current theme: its name and colors.toml */
  theme: { name: string; colors: Record<string, string> } | null;
}

export type Event =
  | { event: "state"; state: SystemState }
  /** An `omarchy-shell <target> <method> [args...]` call from Omarchy's CLI.
   *  The shell answers it with an `answer` request carrying `call`. */
  | { event: "shell"; call: number; target: string; method: string; args: string[] }
  /** A terminal some program started (xdg-terminal-exec runs Pocket Term). */
  | { event: "termOpened"; sid: number; title: string }
  /** Rows that changed (every row when full), and the cursor. */
  | { event: "termRows"; sid: number; rows: TermRow[]; cursor: Cursor; full: boolean }
  | { event: "termTitle"; sid: number; title: string }
  | { event: "termExit"; sid: number; code: number | null };

export type DaemonMessage = Reply | Event;
