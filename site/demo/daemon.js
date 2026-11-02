// omarchy-pocketd for the browser: answers the shell's bridge requests
// (daemon/protocol.ts) from memory. The shell above it is the same bundle as on
// the device; what this file answers is a fixture. Nothing leaves the page.
const W = 1024, H = 768, TILE = 512;

const PROMPT_DIR = "~";
const FS = {
  "~": ["Documents", "Pictures", "Work", "README.md"],
  "~/Documents": ["Notes"],
  "~/Documents/Notes": ["welcome.md"],
  "~/Pictures": [],
  "~/Work": ["omarchy-pocket"],
  "~/Work/omarchy-pocket": ["applets", "daemon", "host", "shell", "site"],
};
const FILES = {
  "README.md": [
    "Omarchy Pocket, running in your browser.",
    "",
    "This window is the real shell: the same bundle as on the device,",
    "on PocketJS's core compiled to WebAssembly. Only the daemon under it is a",
    "stand-in, so this terminal is a small script, not bash.",
    "",
    "Try: L1 + D-pad to move focus, R1 + D-pad to swap windows, L1 + A for the menu.",
  ],
};
const FETCH = [
  ["               ", "omarchy@rgds"],
  ["    ▄▄▄▄▄▄▄    ", "------------"],
  ["   █ ▄▄▄▄▄ █   ", "OS: Arch Linux ARM aarch64"],
  ["   █ █   █ █   ", "Host: Anbernic RG DS Plus"],
  ["   █ ▀▀▀▀▀ █   ", "Kernel: 6.1.141"],
  ["   ▀▀▀▀▀▀▀▀▀   ", "Shell: bash"],
  ["   ▄▄▄▄▄▄▄▄▄   ", "WM: omarchy-pocket-host"],
  ["   █ ▄▄▄▄▄ █   ", "CPU: Rockchip RK3568 (4) @ 1.99 GHz"],
  ["   █ █▄▄▄█ █   ", "GPU: Mali-G52, GLES 3.2"],
  ["   █ ▀▀▀▀▀ █   ", "Memory: 194 MiB / 953 MiB"],
  ["   ▀▀▀▀▀▀▀▀▀   ", "Display: 1024x768 x 2, DSI"],
];
const DEVICE_ONLY = { btop: "btop", nvim: "Neovim", vim: "Vim", codex: "Codex", "omarchy-agent": "the coding agent", tailscale: "Tailscale", mihomo: "mihomo" };

function hexToInt(hex) { return parseInt(String(hex).slice(1), 16); }

class Terminal {
  constructor(sid, title, emit, accent) {
    this.sid = sid; this.title = title; this.emit = emit; this.accent = accent;
    this.cols = 80; this.rows = 26; this.lines = []; this.input = ""; this.history = []; this.at = 0; this.cwd = PROMPT_DIR;
  }
  /** a line is a list of [text, fg] */
  print(text = "", fg = -1) { this.lines.push([[text, fg]]); }
  prompt() { return [[`${this.cwd} `, this.accent()], [") ", this.accent()], [this.input, -1]]; }
  redraw() {
    const rows = [];
    const wrap = (line) => {
      let col = 0, row = [];
      const out = [row];
      for (let [text, fg] of line) {
        while (text.length) {
          const room = this.cols - col;
          if (room <= 0) { row = []; out.push(row); col = 0; continue; }
          const piece = text.slice(0, room);
          if (piece.length) row.push([col, piece, fg, -1]);
          col += piece.length; text = text.slice(piece.length);
        }
      }
      return { out, col };
    };
    for (const line of this.lines) rows.push(...wrap(line).out);
    const tail = wrap(this.prompt());
    rows.push(...tail.out);
    const first = Math.max(0, rows.length - this.rows);
    const visible = rows.slice(first);
    const payload = [];
    for (let y = 0; y < this.rows; y++) payload.push([y, visible[y] ?? []]);
    this.lines = this.lines.slice(-200);
    this.emit({ event: "termRows", sid: this.sid, rows: payload, cursor: [tail.col, visible.length - 1, 1], full: true });
  }
  run(command) {
    const [name, ...args] = command.trim().split(/\s+/);
    const dir = args[0] ? (args[0].startsWith("~") ? args[0] : `${this.cwd}/${args[0]}`).replace(/\/$/, "") : this.cwd;
    switch (name) {
      case "": break;
      case "clear": this.lines = []; break;
      case "help": this.print("ls  cd  cat  pwd  echo  date  uname  whoami  fastfetch  clear  exit"); break;
      case "ls":
        if (FS[dir]) this.lines.push(FS[dir].map((e) => [`${e}  `, FS[`${dir}/${e}`] ? this.accent() : -1]));
        else this.print(`ls: cannot access '${args[0]}': No such file or directory`);
        break;
      case "cd":
        if (!args[0]) this.cwd = "~";
        else if (args[0] === "..") this.cwd = this.cwd.includes("/") ? this.cwd.slice(0, this.cwd.lastIndexOf("/")) : "~";
        else if (FS[dir]) this.cwd = dir;
        else this.print(`bash: cd: ${args[0]}: No such file or directory`);
        break;
      case "pwd": this.print(this.cwd.replace("~", "/home/omarchy")); break;
      case "cat":
        if (FILES[args[0]]) FILES[args[0]].forEach((l) => this.print(l));
        else this.print(`cat: ${args[0] ?? ""}: No such file or directory`);
        break;
      case "echo": this.print(args.join(" ")); break;
      case "date": this.print(new Date().toString().replace(/ \(.*/, "")); break;
      case "whoami": this.print("omarchy"); break;
      case "uname": this.print(args.includes("-a") ? "Linux rgds 6.1.141 #1 SMP aarch64 GNU/Linux" : "Linux"); break;
      case "fastfetch":
      case "neofetch":
        for (const [art, text] of FETCH) this.lines.push(this.cols >= 58 ? [[art, this.accent()], ["  ", -1], [text, -1]] : [[text, -1]]);
        break;
      case "exit": this.emit({ event: "termExit", sid: this.sid, code: 0 }); return false;
      default:
        if (DEVICE_ONLY[name]) this.print(`${DEVICE_ONLY[name]} runs on the device. This browser demo has no Linux under it.`);
        else this.print(`bash: ${name}: command not found. Try help.`);
    }
    return true;
  }
  enter() {
    this.lines.push(this.prompt());
    const command = this.input;
    this.input = "";
    if (command.trim()) this.history.push(command);
    this.at = this.history.length;
    if (this.run(command)) this.redraw();
  }
  text(text) {
    for (const ch of text) {
      if (ch === "\r" || ch === "\n") this.enter();
      else if (ch === "\x7f" || ch === "\b") this.input = this.input.slice(0, -1);
      else if (ch >= " ") this.input += ch;
    }
    this.redraw();
  }
  key(key, m = {}) {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (m.ctrl && k === "c") { this.lines.push([...this.prompt(), ["^C", -1]]); this.input = ""; return this.redraw(); }
    if (m.ctrl && k === "l") { this.lines = []; return this.redraw(); }
    if (m.ctrl && k === "d") { this.emit({ event: "termExit", sid: this.sid, code: 0 }); return; }
    switch (key) {
      case "Enter": return this.enter();
      case "Backspace": this.input = this.input.slice(0, -1); break;
      case "Up": if (this.at > 0) this.input = this.history[--this.at] ?? ""; break;
      case "Down": this.at = Math.min(this.history.length, this.at + 1); this.input = this.history[this.at] ?? ""; break;
      case "Tab": {
        const hit = (FS[this.cwd] ?? []).find((e) => this.input.split(" ").pop() && e.startsWith(this.input.split(" ").pop()));
        if (hit) this.input = this.input.replace(/\S*$/, hit);
        break;
      }
      default: if (key.length === 1 && !m.ctrl && !m.alt) this.input += key;
    }
    this.redraw();
  }
}

export function createDaemon({ emit, themes, wallBase, screensaver, onStorage }) {
  const slugs = Object.keys(themes);
  let current = "tokyo-night";
  const pixels = new Map();
  const walls = new Map();
  const sessions = new Map();
  let nextSid = 1, nextCall = 1;
  const notes = new Map([["welcome.md", "This note lives in this page's memory.\nOn the device, notes are files in ~/Documents/Notes.\n"]]);
  const state = {
    battery: { percent: 83, charging: false },
    network: { kind: "wifi", name: "Pocket", signal: 78 },
    audio: { volume: 45, muted: false },
    bluetooth: { powered: true },
    powerProfile: "balanced",
    proxy: { running: true },
    tailscale: { state: "Running", ip: "100.64.0.8" },
    theme: { name: themes[current].name, colors: themes[current].colors },
    bar: { position: "top", background: "opaque", clock: "dddd HH:mm", hidden: false },
    idle: { screensaver: 0, lock: 0, screensaverOff: true, stayAwake: false },
  };
  const panels = {
    audio: { outputs: [{ name: "speaker", label: "Speakers", volume: 45, muted: false, current: true }, { name: "jack", label: "Headphones", volume: 40, muted: false, current: false }], inputs: [{ name: "mic", label: "Microphone", volume: 60, muted: false, current: true }] },
    network: { enabled: true, networks: [{ ssid: "Pocket", signal: 78, secure: true, active: true, known: true }, { ssid: "Cafe", signal: 52, secure: false, active: false, known: false }], address: "10.0.0.8" },
    power: { profiles: ["performance", "balanced", "power-saver"], profile: "balanced", brightness: 60 },
    bluetooth: { adapter: true, powered: true, devices: [] },
    proxy: { installed: true, running: true, mode: "rule", groups: [{ name: "Proxy", now: "Tokyo", all: ["Tokyo", "Hong Kong", "Singapore", "DIRECT"], delay: 48 }] },
    tailscale: { installed: true, running: true, state: "Running", authUrl: "", self: { name: "rgds", ip: "100.64.0.8", dns: "rgds.tailnet.example" }, tailnet: "tailnet.example", peers: [{ name: "desktop", ip: "100.64.0.2", online: true, os: "linux" }, { name: "laptop", ip: "100.64.0.3", online: false, os: "macOS" }] },
  };
  const accent = () => hexToInt(themes[current].colors.accent);
  const pushState = () => emit({ event: "state", state: { ...state } });
  const shell = (target, method, ...args) => emit({ event: "shell", call: nextCall++, target, method, args });

  async function decode(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`no background at ${url}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(W, H);
    const c = canvas.getContext("2d", { willReadFrequently: true });
    c.drawImage(bitmap, 0, 0, W, H);
    return c.getImageData(0, 0, W, H).data;
  }
  /** Cuts a background into the textures the daemon's wallpaper.ts makes. */
  async function tiles(path) {
    const url = path ?? `${wallBase}/${current}.webp`;
    if (walls.has(url)) return walls.get(url);
    const data = await decode(url);
    const list = [];
    for (let row = 0; row * TILE < H; row++) for (let col = 0; col * TILE < W; col++) {
      const w = Math.min(TILE, W - col * TILE), h = Math.min(TILE, H - row * TILE);
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) out.set(data.subarray(((row * TILE + y) * W + col * TILE) * 4, ((row * TILE + y) * W + col * TILE + w) * 4), y * w * 4);
      const file = `${url}#${col}.${row}`;
      pixels.set(file, out);
      list.push({ file, x: col * TILE, y: row * TILE, w, h });
    }
    walls.set(url, list);
    return list;
  }

  function setTheme(name) {
    const slug = slugs.find((s) => s === name || themes[s].name === name);
    if (!slug) return false;
    current = slug;
    state.theme = { name: themes[slug].name, colors: themes[slug].colors };
    pushState();
    shell("background", "refresh");
    return true;
  }
  function runCommand(command) {
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (command.startsWith("omarchy-theme-switcher")) return ok(slugs.map((s) => `${wallBase}/${s}.webp\t${wallBase}/${s}.webp`).join("\n"));
    if (command.includes("current/theme.name")) return ok(current);
    const set = /omarchy-theme-set '?([^']+)'?/.exec(command);
    if (set) { setTheme(set[1].trim()); return ok(); }
    if (command === "omarchy-toggle-bar") { state.bar = { ...state.bar, hidden: !state.bar.hidden }; pushState(); return ok(); }
    if (command === "omarchy-theme-bg-next") { emit({ event: "notify", notice: notice("One background per theme in this demo.") }); return ok(); }
    if (/^: >|^printf|^true$/.test(command)) return ok();
    // anything else needs the Linux under the real daemon
    if (command.trim()) emit({ event: "notify", notice: notice("That runs on the device. This browser demo has no Linux under it.") });
    return ok();
  }
  /** Home's pinned app ids, or null while nothing has been chosen */
  let pins = null;
  let noticeId = 1;
  function notice(body) {
    const id = noticeId++;
    setTimeout(() => emit({ event: "notifyClosed", notice: id, reason: 1 }), 3200);
    return { id, app: "Omarchy Pocket", summary: "Browser demo", body, glyph: "\u{f02fc}", icon: "", urgency: 0, actions: [] };
  }

  const handlers = {
    state: () => state,
    run: (r) => runCommand(r.command),
    // the menu's `when` commands: a row shows unless its command needs real hardware
    conditions: (r) => r.commands.map(() => false),
    answer: () => null,
    wallpaper: (r) => tiles(r.path),
    termOpen: (r) => {
      const sid = nextSid++;
      const title = r.title ?? "bash";
      const term = new Terminal(sid, title, emit, accent);
      sessions.set(sid, term);
      if (r.argv) { term.print("The coding agent runs on the device, in this window, with your login."); term.print("omarchy agent opens Codex in a tiled window like this one."); }
      else { term.print("This terminal is a small script. Type help."); }
      setTimeout(() => term.redraw(), 0);
      return sid;
    },
    termInput: (r) => sessions.get(r.sid)?.text(r.text) ?? null,
    termKey: (r) => sessions.get(r.sid)?.key(r.key, r) ?? null,
    termPaste: (r) => sessions.get(r.sid)?.text(r.text) ?? null,
    termClose: (r) => { sessions.delete(r.sid); emit({ event: "termExit", sid: r.sid, code: 0 }); return null; },
    termResize: (r) => { const t = sessions.get(r.sid); if (t) { t.cols = r.cols; t.rows = r.rows; t.redraw(); } return null; },
    termList: () => [...sessions.keys()],
    notifyInvoke: () => null, notifyDismiss: () => null, notifyList: () => [],
    screensaver: () => screensaver,
    systemStats: () => {
      const cpu = Math.round(6 + Math.random() * 7);
      return { cpu, cores: [cpu + 4, cpu - 2, cpu + 1, cpu - 3].map((v) => Math.max(0, v)), mhz: 1416, memTotal: 953 * 1024, memUsed: 194 * 1024, temps: [{ name: "soc", celsius: 42 }], rx: 1200, tx: 400, uptime: 86400, load: "0.21 0.34 0.30" };
    },
    processes: () => [
      { pid: 412, cpu: 11, rssKb: 73 * 1024, name: "omarchy-pocket-host" },
      { pid: 398, cpu: 2, rssKb: 37 * 1024, name: "omarchy-pocketd" },
      { pid: 301, cpu: 0.4, rssKb: 28 * 1024, name: "mihomo" },
      { pid: 288, cpu: 0.2, rssKb: 24 * 1024, name: "tailscaled" },
      { pid: 1, cpu: 0, rssKb: 9 * 1024, name: "systemd" },
    ],
    pictures: () => slugs.map((s) => ({ name: themes[s].name, path: `${wallBase}/${s}.webp`, group: "Backgrounds" })),
    notes: () => [...notes.keys()],
    noteRead: (r) => notes.get(r.name) ?? "",
    noteWrite: (r) => { notes.set(r.name, r.text); return null; },
    network: () => panels.network,
    wifiConnect: () => null, wifiDisconnect: () => null, wifiForget: () => null,
    wifiPower: (r) => { panels.network.enabled = r.on; return null; },
    audio: () => panels.audio,
    audioSet: (r) => {
      const list = r.kind === "sink" ? panels.audio.outputs : panels.audio.inputs;
      for (const d of list) {
        if (r.current) d.current = d.name === r.name;
        if (d.name === r.name && r.volume !== undefined) d.volume = r.volume;
        if (d.name === r.name && r.muted !== undefined) d.muted = r.muted;
      }
      const out = panels.audio.outputs.find((d) => d.current);
      state.audio = { volume: out.volume, muted: out.muted };
      pushState();
      return null;
    },
    power: () => panels.power,
    powerSet: (r) => { if (r.profile) { panels.power.profile = r.profile; state.powerProfile = r.profile; pushState(); } if (r.brightness !== undefined) { panels.power.brightness = r.brightness; onStorage?.brightness?.(r.brightness); } return null; },
    proxy: () => panels.proxy,
    proxySet: (r) => {
      if (r.running !== undefined) { panels.proxy.running = r.running; state.proxy = { running: r.running }; pushState(); }
      if (r.mode) panels.proxy.mode = r.mode;
      if (r.group && r.node) panels.proxy.groups.find((g) => g.name === r.group).now = r.node;
      return null;
    },
    tailscale: () => panels.tailscale,
    tailscaleSet: (r) => {
      if (r.up !== undefined) { panels.tailscale.state = r.up ? "Running" : "Stopped"; state.tailscale = r.up ? { state: "Running", ip: "100.64.0.8" } : { state: "Stopped", ip: "" }; pushState(); }
      if (r.running !== undefined) panels.tailscale.running = r.running;
      return null;
    },
    bluetooth: () => panels.bluetooth,
    bluetoothPower: (r) => { panels.bluetooth.powered = r.on; state.bluetooth = { powered: r.on }; pushState(); return null; },
    bluetoothConnect: () => null, bluetoothDisconnect: () => null, bluetoothForget: () => null,
    glyphs: () => false,
    atlases: () => [],
    apps: () => [],
    // Home's pins live in this page only: nothing chosen until the visitor pins
    pins: () => pins,
    pinsSet: (r) => { pins = r.ids; return null; },
    ime: () => { throw new Error("Pinyin runs on the device: Rime is not in this demo."); },
    checkPassword: () => true,
    appNet: () => null,
  };

  return {
    /** a line from the shell (bridge.ts) */
    async request(line) {
      const r = JSON.parse(line);
      try {
        const handler = handlers[r.method];
        if (r.method === "voiceStart") throw new Error("Voice input runs on the device");
        if (!handler) throw new Error(`${r.method} is not in this demo`);
        const result = await handler(r);
        emit({ id: r.id, ok: true, result: result ?? null });
      } catch (error) {
        emit({ id: r.id, ok: false, error: String(error?.message ?? error) });
      }
    },
    shell,
    setTheme,
    get theme() { return current; },
    texture: (file) => pixels.get(file) ?? null,
    start() { emit({ event: "hello" }); pushState(); },
  };
}
