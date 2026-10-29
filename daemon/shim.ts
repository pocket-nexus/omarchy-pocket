#!/usr/bin/env bun
// Stand-ins for the desktop-session commands Omarchy's scripts call, for a
// system without Hyprland or uwsm. Installed as a copy under each name
// in /usr/local/bin; the name it is called by picks the command.
//
//   hyprctl    answers queries with the two panels and no windows; dispatches
//              and keywords succeed without effect, except exec
//   uwsm       `stop` ends the shell's session (systemd starts a new one);
//              `check is-active` succeeds; `app -- cmd` runs cmd
//   uwsm-app   runs the command after `--`
//   omasnap    Omarchy's screenshot tool (omarchy-capture-screenshot): both panels
//              from the GPU readback, top over bottom, as a PNG in the
//              screenshot directory, announced by a notification
//   omarchy-pocket-term   the terminal xdg-terminal-exec runs (omarchy-pocket-term.desktop):
//              `[--app-id=ID] [--title=T] [--dir=D] [-e cmd args...]` opens a
//              Pocket Term session in the shell through omarchy-pocketd
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { shellPath } from "./paths.ts";

const name = basename(process.argv[1] ?? "");
const args = process.argv.slice(2);

const PANELS = [
  { id: 0, name: "DSI-1", description: "RG DS Plus top panel", focused: true, y: 0 },
  { id: 1, name: "DSI-2", description: "RG DS Plus bottom panel", focused: false, y: 384 },
].map((panel) => ({
  ...panel,
  make: "Anbernic",
  model: "RG DS Plus",
  serial: "",
  width: 1024,
  height: 768,
  refreshRate: 60,
  x: 0,
  scale: 2,
  transform: 0,
  activeWorkspace: { id: 1, name: "1" },
  specialWorkspace: { id: 0, name: "" },
  reserved: [0, 0, 0, 0],
  dpmsStatus: true,
  vrr: false,
  disabled: false,
}));
const WORKSPACE = { id: 1, name: "1", monitor: "DSI-1", monitorID: 0, windows: 0, hasfullscreen: false, lastwindow: "0x0", lastwindowtitle: "" };

/** Starts argv in its own session (setsid -f returns once it forked). */
function run(argv: string[]): never {
  if (!argv.length) process.exit(2);
  const child = Bun.spawnSync(["setsid", "-f", ...argv], { stdio: ["ignore", "ignore", "inherit"] });
  process.exit(child.exitCode ?? 1);
}

async function hyprctl(argv: string[]) {
  const json = argv.includes("-j");
  const words = argv.filter((a) => !a.startsWith("-"));
  const print = (value: unknown, text: string) => console.log(json ? JSON.stringify(value) : text);
  switch (words[0]) {
    case "monitors":
      return print(PANELS, PANELS.map((p) => `Monitor ${p.name} (ID ${p.id}):\n\t${p.width}x${p.height}@60 at ${p.x}x${p.y}`).join("\n\n"));
    case "clients":
      return print([], "");
    case "activewindow":
      return print({}, "Invalid");
    case "activeworkspace":
      return print(WORKSPACE, "workspace ID 1 (1) on monitor DSI-1");
    case "workspaces":
      return print([WORKSPACE], "workspace ID 1 (1) on monitor DSI-1");
    case "devices":
      return print({ mice: [], keyboards: [], tablets: [], touch: [], switches: [] }, "");
    case "getoption":
      return print({ option: words[1] ?? "", int: 0, set: false }, "int: 0\nset: false");
    case "version":
      return print({ branch: "", commit: "", version: "omarchy-pocket" }, "Hyprland: none (Omarchy Pocket)");
    case "dispatch": {
      // `dispatch exec <cmd>` and the 0.56 form `hl.dsp.exec_cmd([[cmd]])` start a program
      const rest = words.slice(1).join(" ");
      const lua = /^hl\.dsp\.exec_cmd\(\[\[(?:\[[^\]]*\]\s*)?([\s\S]*)\]\]\)$/.exec(rest);
      if (words[1] === "exec") run(["bash", "-c", words.slice(2).join(" ").replace(/^\[[^\]]*\]\s*/, "")]);
      if (lua) run(["bash", "-c", lua[1]!]);
      return console.log("ok");
    }
    default:
      return console.log("ok");
  }
}

async function uwsm(argv: string[]) {
  switch (argv[0]) {
    case "stop": {
      // the shell's session is the user's display session
      const user = process.env.USER ?? "omarchy";
      const session = (await Bun.$`loginctl show-user ${user} -p Display --value`.nothrow().text()).trim();
      if (!session) process.exit(1);
      await Bun.$`loginctl terminate-session ${session}`;
      return;
    }
    case "check":
      return;
    case "app":
      return run(argv.slice(argv.indexOf("--") + 1));
    default:
      return;
  }
}

/** Sends one omarchy-shell request to omarchy-pocketd and returns its output. */
async function shellCall(args: string[]): Promise<string> {
  let reply = "";
  await new Promise<void>((resolve, reject) => {
    Bun.connect({
      unix: shellPath,
      socket: {
        open: (socket) => void socket.write(args.join("\x1f") + "\x1e"),
        data: (_, chunk) => void (reply += chunk.toString()),
        close: () => resolve(),
        error: (_, error) => reject(error),
      },
    }).catch(reject);
  });
  if (!reply.startsWith("OK\x1f")) throw new Error("omarchy-pocketd did not open the terminal");
  return reply.slice(3, reply.indexOf("\x1e"));
}

async function pocketTerm(argv: string[]) {
  const options: { argv: string[]; title?: string; cwd?: string; env: Record<string, string> } = { argv: [], env: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-e") {
      options.argv = argv.slice(i + 1);
      break;
    }
    if (arg.startsWith("--title=")) options.title = arg.slice(8);
    else if (arg.startsWith("--dir=")) options.cwd = arg.slice(6);
  }
  // the caller's environment, as a terminal it started would inherit it
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) options.env[key] = value;
  console.log(await shellCall(["pocket.term", "open", JSON.stringify(options)]));
}

/** The host program reads each panel's next frame back into
 *  /tmp/pocket-shot-<panel>.rgba (RGBA, bottom row first) while /tmp/pocket-shot exists. */
async function readback(): Promise<Uint8Array> {
  const [W, H] = [1024, 768];
  const frames = [0, 1].map((p) => `/tmp/pocket-shot-${p}.rgba`);
  for (const f of frames) rmSync(f, { force: true });
  writeFileSync("/tmp/pocket-shot", "");
  for (let i = 0; i < 50 && !(frames.every(existsSync) && !existsSync("/tmp/pocket-shot")); i++) await Bun.sleep(100);
  if (!frames.every(existsSync)) throw new Error("the shell did not read its panels back");
  await Bun.sleep(100);
  const out = new Uint8Array(W * H * 2 * 4);
  frames.forEach((file, panel) => {
    const raw = readFileSync(file);
    for (let y = 0; y < H; y++) out.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), (panel * H + y) * W * 4);
  });
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

async function omasnap(argv: string[]) {
  const home = process.env.HOME ?? "/home/omarchy";
  const dir = process.env.OMASNAP_SCREENSHOT_DIR || process.env.XDG_PICTURES_DIR || join(home, "Pictures");
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
  const file = join(dir, `screenshot-${stamp}.png`);
  const raw = `${file}.rgba`;
  writeFileSync(raw, await readback());
  const vips = Bun.spawnSync(["vips", "rawload", raw, file, "1024", "1536", "4"], { env: { ...process.env, VIPS_WARNING: "0" } });
  rmSync(raw, { force: true });
  if (vips.exitCode !== 0 || !statSync(file).size) throw new Error("vips could not write the screenshot");
  console.log(file);
  if (argv.includes("--notify")) {
    Bun.spawnSync(["omarchy-notification-send", "-g", "\u{f0100}", "Screenshot saved", file.replace(home, "~")]);
  }
}

switch (name) {
  case "omasnap":
    await omasnap(args);
    break;
  case "omarchy-pocket-term":
    await pocketTerm(args);
    break;
  case "hyprctl":
    await hyprctl(args);
    break;
  case "uwsm":
    await uwsm(args);
    break;
  case "uwsm-app":
    run(args.includes("--") ? args.slice(args.indexOf("--") + 1) : args);
    break;
  default:
    console.error(`omarchy-pocket shim: unknown name ${name}`);
    process.exit(2);
}
