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
//   omarchy-pocket-term   the terminal xdg-terminal-exec runs (omarchy-pocket-term.desktop):
//              `[--app-id=ID] [--title=T] [--dir=D] [-e cmd args...]` opens a
//              Pocket Term session in the shell through omarchy-pocketd
import { basename } from "node:path";
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

switch (name) {
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
