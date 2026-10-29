// The Omarchy bridge protocol between the shell (a PocketJS realm in
// omarchy-pocket-host) and omarchy-pocketd: one JSON object per line over
// $XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock. Both processes run as the
// Omarchy user. The shell sends requests; the daemon sends one reply per
// request (matched by id) and events whenever it has them.

export const BRIDGE_DIRECTORY = "omarchy-pocket";
export const BRIDGE_SOCKET = "bridge.sock";

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
  | { id: number; method: "answer"; call: number; handled: boolean; output?: string };

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
  | { event: "shell"; call: number; target: string; method: string; args: string[] };

export type DaemonMessage = Reply | Event;
