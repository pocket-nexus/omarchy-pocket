#!/usr/bin/env bun
// omarchy-pocketd: the Omarchy side of Omarchy Pocket. It runs as the Omarchy
// user in that user's systemd manager (omarchy-pocketd.service) and is the
// shell's only way into the system:
//
//   $XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock   the shell's bridge (protocol.ts):
//       run commands, evaluate menu conditions, push SystemState
//   org.freedesktop.Notifications on the session bus (notifications.ts)
//   $XDG_RUNTIME_DIR/omarchy-shell-<id>.sock      the socket Omarchy's
//       `omarchy-shell` CLI talks to, served in place of Quickshell's; each
//       call goes to the shell as a `shell` event and the shell's answer
//       goes back to the CLI, except the targets the daemon serves itself
//       (`pocket.term`: the terminals, term.ts)
//
// Commands run as `bash -c` with this process's environment, which the unit
// sets to Omarchy's (OMARCHY_PATH, PATH with $OMARCHY_PATH/bin).
import type { Socket, UnixSocketListener } from "bun";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { bridgePath, shellPath } from "./paths.ts";
import type { AppNetLine, DaemonMessage, Request, RunResult, SystemState } from "./protocol.ts";
import { AppNet } from "./companion.ts";
import { CLOSED, Notifications } from "./notifications.ts";
import { Terminals, type OpenOptions } from "./term.ts";
import { wallpaper } from "./wallpaper.ts";
import * as panels from "./panels.ts";
import { checkPassword, watchSleep } from "./session.ts";
import { Glyphs } from "./glyphs.ts";
import { commonHanzi, Ime } from "./ime.ts";
import { apps } from "./apps.ts";
import { Bar } from "./bar.ts";
import * as applets from "./applets.ts";
import { RUNTIME } from "./paths.ts";

if (process.argv[2] === "bake") {
  await (await import("./glyphs.ts")).bakeMain(process.argv[3]!);
  process.exit(0);
}
if (process.argv[2] === "atlas-baker") {
  await (await import("./glyphs.ts")).atlasBakerMain();
  process.exit(0);
}

const HOME = process.env.HOME ?? "/home/omarchy";
const OUTPUT_LIMIT = 64 * 1024;
const LINE_LIMIT = 4 * 1024 * 1024;
const STATE_EVERY_MS = 15_000;
const ANSWER_TIMEOUT_MS = 1_500;
const CONDITION_JOBS = 4;

const log = (...parts: unknown[]) => console.error("omarchy-pocketd:", ...parts);

// ---- commands -------------------------------------------------------------

/** Keeps the last `limit` bytes of a stream. */
async function tail(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.length;
    while (size - chunks[0]!.length >= limit) size -= chunks.shift()!.length;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > limit ? text.slice(-limit) : text;
}

async function run(command: string): Promise<RunResult> {
  const child = Bun.spawn(["bash", "-c", command], { stdin: "ignore", stdout: "pipe", stderr: "pipe", cwd: HOME });
  const [stdout, stderr, code] = await Promise.all([tail(child.stdout, OUTPUT_LIMIT), tail(child.stderr, OUTPUT_LIMIT), child.exited]);
  return { code, stdout, stderr };
}

async function succeeds(command: string): Promise<boolean> {
  const child = Bun.spawn(["bash", "-c", command], { stdin: "ignore", stdout: "ignore", stderr: "ignore", cwd: HOME });
  return (await child.exited) === 0;
}

async function conditions(commands: string[]): Promise<boolean[]> {
  const results = new Array<boolean>(commands.length).fill(false);
  let next = 0;
  const worker = async () => {
    while (next < commands.length) {
      const index = next++;
      results[index] = await succeeds(commands[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONDITION_JOBS, commands.length) }, worker));
  return results;
}

// ---- system state ---------------------------------------------------------

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

async function output(argv: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? text.trim() : null;
  } catch {
    return null;
  }
}

/** The RG DS Plus has two Battery supplies: the CW2015 fuel gauge and the
 * charger's estimate; the gauge is the one to show. */
function battery(): SystemState["battery"] {
  const root = "/sys/class/power_supply";
  let names: string[];
  try {
    names = readdirSync(root).filter((name) => read(join(root, name, "type")) === "Battery");
  } catch {
    return null;
  }
  const name = names.find((n) => n.startsWith("cw2015")) ?? names[0];
  if (!name) return null;
  const percent = Number(read(join(root, name, "capacity")));
  const status = read(join(root, name, "status"));
  return Number.isFinite(percent) ? { percent, charging: status === "Charging" || status === "Full" } : null;
}

async function network(): Promise<SystemState["network"]> {
  const devices = (await output(["nmcli", "-t", "-f", "TYPE,STATE,CONNECTION", "device", "status"])) ?? "";
  for (const kind of ["ethernet", "wifi"] as const) {
    const line = devices.split("\n").find((l) => l.startsWith(`${kind}:connected:`));
    if (!line) continue;
    const name = line.slice(`${kind}:connected:`.length).replace(/\\:/g, ":");
    if (kind === "ethernet") return { kind, name, signal: null };
    const list = (await output(["nmcli", "-t", "-f", "IN-USE,SIGNAL", "device", "wifi", "list", "--rescan", "no"])) ?? "";
    const signal = Number(list.split("\n").find((l) => l.startsWith("*:"))?.slice(2));
    return { kind, name, signal: Number.isFinite(signal) ? signal : null };
  }
  return { kind: "none", name: "", signal: null };
}

async function audio(): Promise<SystemState["audio"]> {
  const text = await output(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"]);
  const match = text && /Volume:\s*([\d.]+)/.exec(text);
  return match ? { volume: Math.round(Number(match[1]) * 100), muted: text.includes("[MUTED]") } : null;
}

async function bluetooth(): Promise<SystemState["bluetooth"]> {
  const text = await output(["busctl", "--system", "get-property", "org.bluez", "/org/bluez/hci0", "org.bluez.Adapter1", "Powered"]);
  return text ? { powered: text === "b true" } : null;
}

async function systemState(): Promise<SystemState> {
  const [net, sound, bt, profile] = await Promise.all([network(), audio(), bluetooth(), output(["powerprofilesctl", "get"])]);
  return {
    battery: battery(),
    network: net,
    audio: sound,
    bluetooth: bt,
    powerProfile: profile,
    theme: theme(),
    bar: bar.settings(),
    idle: bar.idle(),
  };
}

const bar = new Bar(HOME);
const appNet = new AppNet(HOME, RUNTIME, log);

/** omarchy-theme-set keeps the current theme in ~/.local/state/omarchy/current. */
function theme(): SystemState["theme"] {
  const current = join(HOME, ".local", "state", "omarchy", "current");
  const name = read(join(current, "theme.name"));
  const toml = read(join(current, "theme", "colors.toml"));
  if (!name || !toml) return null;
  const colors: Record<string, string> = {};
  for (const line of toml.split("\n")) {
    const match = /^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(line.trim());
    if (match) colors[match[1]!] = match[2]!.toLowerCase();
  }
  return { name, colors };
}

let state: SystemState | null = null;
let stateText = "";
let refreshing: Promise<SystemState> | null = null;

function refresh(): Promise<SystemState> {
  refreshing ??= systemState()
    .then((next) => {
      const text = JSON.stringify(next);
      state = next;
      if (text !== stateText) {
        stateText = text;
        broadcast({ event: "state", state: next });
      }
      return next;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

// ---- the bridge -----------------------------------------------------------

interface Peer {
  incoming: string;
  outgoing: Buffer[];
}
const peers = new Set<Socket<Peer>>();

function write(socket: Socket<Peer>) {
  const data = socket.data;
  while (data.outgoing.length) {
    const chunk = data.outgoing[0]!;
    const n = socket.write(chunk);
    if (n < chunk.length) {
      data.outgoing[0] = chunk.subarray(n);
      return; // drain() continues
    }
    data.outgoing.shift();
  }
}

function send(socket: Socket<Peer>, message: DaemonMessage) {
  socket.data.outgoing.push(Buffer.from(JSON.stringify(message) + "\n"));
  write(socket);
}

/** A line that is not a DaemonMessage: an app's `@net` reply. */
function sendLine(socket: Socket<Peer>, line: string) {
  socket.data.outgoing.push(Buffer.from(line + "\n"));
  write(socket);
}

function broadcast(message: DaemonMessage) {
  for (const peer of peers) send(peer, message);
}

async function handle(socket: Socket<Peer>, request: Request) {
  try {
    let result: unknown;
    switch (request.method) {
      case "run":
        result = await run(request.command);
        break;
      case "conditions":
        result = await conditions(request.commands);
        break;
      case "state":
        result = state ?? (await refresh());
        break;
      case "answer":
        answered(request.call, request.handled, request.output ?? "");
        result = null;
        break;
      case "termOpen":
        result = openTerminal({ argv: request.argv?.length ? request.argv : ["bash", "-l"], title: request.title ?? "" }, false);
        break;
      case "termInput":
        terminals.get(request.sid).input(request.text);
        result = null;
        break;
      case "termKey":
        terminals.get(request.sid).key(request.key, !!request.ctrl, !!request.alt, !!request.shift);
        result = null;
        break;
      case "termPaste":
        terminals.get(request.sid).paste(request.text);
        result = null;
        break;
      case "termClose":
        terminals.get(request.sid).kill();
        result = null;
        break;
      case "termResize":
        terminals.get(request.sid).resize(request.cols, request.rows);
        result = null;
        break;
      case "termList":
        result = terminals.list();
        for (const { sid } of terminals.list()) terminals.get(sid).attach();
        break;
      case "notifyInvoke":
        notifications.invoke(request.notice, request.action);
        result = null;
        break;
      case "notifyDismiss":
        notifications.close(request.notice, CLOSED.dismissed);
        result = null;
        break;
      case "notifyList":
        result = notifications.list();
        break;
      case "wallpaper":
        result = await wallpaper(RUNTIME, HOME, request.path, request.fit);
        break;
      case "screensaver":
        result = applets.screensaverText(HOME);
        glyphs.want(result as string);
        break;
      case "systemStats":
        result = applets.systemStats();
        break;
      case "processes":
        result = await applets.processes(request.sort);
        break;
      case "pictures":
        result = applets.pictures(HOME);
        break;
      case "notes":
        result = applets.notes(HOME);
        break;
      case "noteRead":
        result = applets.noteRead(HOME, request.name);
        break;
      case "noteWrite":
        applets.noteWrite(HOME, request.name, request.text);
        result = null;
        break;
      case "network":
        result = await panels.network(!!request.rescan);
        break;
      case "wifiConnect":
        await panels.wifiConnect(request.ssid, request.password);
        void refresh();
        result = null;
        break;
      case "wifiDisconnect":
        await panels.wifiDisconnect();
        void refresh();
        result = null;
        break;
      case "wifiForget":
        await panels.wifiForget(request.ssid);
        result = null;
        break;
      case "wifiPower":
        await panels.wifiPower(request.on);
        void refresh();
        result = null;
        break;
      case "audio":
        result = await panels.audio();
        break;
      case "audioSet":
        await panels.audioSet(request.kind, request.name, request);
        void refresh();
        result = null;
        break;
      case "power":
        result = await panels.power();
        break;
      case "powerSet":
        await panels.powerSet(request);
        void refresh();
        result = null;
        break;
      case "bluetooth":
        result = await panels.bluetooth(!!request.scan);
        break;
      case "bluetoothPower":
        await panels.bluetoothPower(request.on);
        void refresh();
        result = null;
        break;
      case "bluetoothConnect":
        await panels.bluetoothConnect(request.mac);
        result = null;
        break;
      case "bluetoothDisconnect":
        await panels.bluetoothDisconnect(request.mac);
        result = null;
        break;
      case "bluetoothForget":
        await panels.bluetoothForget(request.mac);
        result = null;
        break;
      case "glyphs":
        result = glyphs.want(request.text);
        break;
      case "atlases":
        result = glyphs.atlases();
        break;
      case "apps":
        result = apps(HOME);
        break;
      case "ime": {
        const snapshot = await ime.compose(request.keys);
        glyphs.want(snapshot.preedit + snapshot.candidates.join("") + snapshot.commit);
        result = snapshot;
        break;
      }
      case "checkPassword":
        result = await checkPassword(request.password);
        break;
      default:
        throw new Error(`unknown method ${(request as { method: string }).method}`);
    }
    send(socket, { id: request.id, ok: true, result });
  } catch (error) {
    send(socket, { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function listen(path: string, handlers: Parameters<typeof Bun.listen<Peer>>[0]["socket"]): UnixSocketListener<Peer> {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  if (existsSync(path)) unlinkSync(path);
  // omarchy-shell's socat shuts its write side once the request is out and
  // waits for the reply on the read side. Bun keeps such a socket open only
  // with allowHalfOpen and an end handler (Bun 1.4).
  const listener = Bun.listen<Peer>({ unix: path, allowHalfOpen: true, socket: { end() {}, ...handlers } });
  chmodSync(path, 0o600);
  return listener;
}

// ---- run-time glyphs ------------------------------------------------------

const glyphs = new Glyphs(join(RUNTIME, "omarchy-pocket", "glyphs"), join(HOME, ".cache", "omarchy-pocket", "glyphs"), (atlases) =>
  broadcast({ event: "atlas", atlases }),
);
// the 3,755 common characters, once at start, so pinyin candidates and most
// Chinese text never wait for a bake
glyphs.want(commonHanzi());

// ---- Chinese input --------------------------------------------------------

const ime = new Ime(join(HOME, ".local", "share", "omarchy-pocket", "ime"));
// build the dictionary now, not on the first keystroke
ime.prepare().catch((error) => log("ime:", error instanceof Error ? error.message : error));

// ---- terminals ------------------------------------------------------------

const terminals = new Terminals({
  want: (text) => glyphs.want(text),
  rows: (sid, rows, cursor, full) => broadcast({ event: "termRows", sid, rows, cursor, full }),
  title: (sid, title) => broadcast({ event: "termTitle", sid, title }),
  exit: (sid, code) => broadcast({ event: "termExit", sid, code }),
});

/** A new session; one some program started is announced so the shell shows it. */
function openTerminal(options: OpenOptions, announce: boolean): number {
  const sid = terminals.open({ cwd: HOME, ...options });
  if (announce) broadcast({ event: "termOpened", sid, title: terminals.get(sid).title });
  return sid;
}

// ---- notifications --------------------------------------------------------

const notifications = new Notifications({
  shown: (notice) => broadcast({ event: "notify", notice }),
  closed: (notice, reason) => broadcast({ event: "notifyClosed", notice, reason }),
});
notifications.start().catch((error) => log("notifications:", error instanceof Error ? error.message : error));
watchSleep(() => broadcast({ event: "sleep" })).catch((error) => log("logind:", error instanceof Error ? error.message : error));

listen(bridgePath, {
  open(socket) {
    socket.data = { incoming: "", outgoing: [] };
    peers.add(socket);
    log("shell connected");
    send(socket, { event: "hello" });
    if (state) send(socket, { event: "state", state });
  },
  data(socket, chunk) {
    const data = socket.data;
    data.incoming += chunk.toString("utf8");
    if (data.incoming.length > LINE_LIMIT) {
      log("bridge line exceeds 4 MiB; closing");
      socket.end();
      return;
    }
    let end: number;
    while ((end = data.incoming.indexOf("\n")) >= 0) {
      const line = data.incoming.slice(0, end);
      data.incoming = data.incoming.slice(end + 1);
      if (!line) continue;
      let request: Request | AppNetLine;
      try {
        request = JSON.parse(line);
      } catch {
        log("bridge line is not JSON");
        continue;
      }
      if (request.method === "appNet") void appNet.request(request, (reply) => sendLine(socket, reply));
      else if (request.method === "appNetCancel") appNet.cancel(request.h);
      else void handle(socket, request);
    }
  },
  drain: write,
  close(socket) {
    peers.delete(socket);
    log("shell disconnected");
  },
  error(_, error) {
    log("bridge:", error.message);
  },
});

// ---- omarchy-shell --------------------------------------------------------


interface Call {
  socket: Socket<Peer>;
  timer: ReturnType<typeof setTimeout>;
}
const calls = new Map<number, Call>();
let nextCall = 1;

function reply(socket: Socket<Peer>, text: string) {
  socket.data.outgoing.push(Buffer.from(text));
  write(socket);
  socket.end();
}

function answered(call: number, handled: boolean, text: string) {
  const pending = calls.get(call);
  if (!pending) return;
  calls.delete(call);
  clearTimeout(pending.timer);
  // SKIP makes omarchy-shell fall back to `qs ipc`, which reports the target missing
  reply(pending.socket, handled ? `OK\x1f${text}\x1e` : "SKIP\x1e");
}

function shellCall(socket: Socket<Peer>, args: string[]) {
  const [target = "", method = "", ...rest] = args;
  if (target === "shell" && method === "ping") return reply(socket, "OK\x1fpong\x1e");
  // the bar's settings live in shell.json, which the daemon reads and writes
  if ((target === "omarchy.bar" && method === "syncHidden") || (target === "shell" && method === "reloadConfig")) {
    void refresh();
    return reply(socket, "OK\x1fok\x1e");
  }
  if (target === "shell" && method === "setBarWidget") {
    let result: string;
    try {
      result = bar.set(rest[0] ?? "", rest[1] ?? "", rest[2] ?? "null");
    } catch (error) {
      result = String(error);
    }
    void refresh();
    return reply(socket, `OK\x1f${result}\x1e`);
  }
  if (target === "shell" && (method === "putBarWidget" || method === "moveBarWidget")) return reply(socket, "OK\x1fok\x1e");
  if (target === "omarchy.indicators" && method === "refresh") {
    void refresh();
    return reply(socket, "OK\x1f\x1e");
  }
  if (target === "pocket.term" && method === "open") {
    // `omarchy-pocket-term` (shim.ts), which xdg-terminal-exec runs
    try {
      const options = JSON.parse(rest[0] ?? "{}") as OpenOptions;
      if (!Array.isArray(options.argv) || !options.argv.length) options.argv = ["bash", "-l"];
      return reply(socket, `OK\x1f${openTerminal(options, true)}\x1e`);
    } catch (error) {
      log("pocket.term open:", error);
      return reply(socket, "SKIP\x1e");
    }
  }
  const shell = peers.values().next().value;
  if (!shell) return reply(socket, "SKIP\x1e");
  const call = nextCall++;
  calls.set(call, { socket, timer: setTimeout(() => answered(call, false, ""), ANSWER_TIMEOUT_MS) });
  send(shell, { event: "shell", call, target, method, args: rest });
}

listen(shellPath, {
  open(socket) {
    socket.data = { incoming: "", outgoing: [] };
  },
  data(socket, chunk) {
    socket.data.incoming += chunk.toString("utf8");
    const end = socket.data.incoming.indexOf("\x1e");
    if (end >= 0) shellCall(socket, socket.data.incoming.slice(0, end).split("\x1f"));
    else if (socket.data.incoming.length > LINE_LIMIT) socket.end();
  },
  drain: write,
  error(_, error) {
    log("omarchy-shell:", error.message);
  },
});

void refresh();
setInterval(() => void refresh(), STATE_EVERY_MS);
bar.watch(() => void refresh());
log(`bridge ${bridgePath}, omarchy-shell ${shellPath}`);
