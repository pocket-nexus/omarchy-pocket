// What the shell's Network, Audio and Power panels show and change, through
// the CLIs Omarchy's own panels use underneath: nmcli, pactl/wpctl,
// powerprofilesctl and brightnessctl. Arguments go to the programs as argv,
// never through a shell, so an SSID or a password is only ever data.
import { readFileSync, writeFileSync } from "node:fs";
import type { AudioDevice, AudioPanel, BluetoothDevice, BluetoothPanel, NetworkPanel, PowerPanel, WifiNetwork } from "./protocol.ts";

async function exec(argv: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(argv, { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}

async function must(argv: string[]): Promise<string> {
  const result = await exec(argv);
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").pop() || `${argv[0]} exited ${result.code}`);
  return result.stdout;
}

/** nmcli -t escapes ':' and '\' with a backslash. */
function fields(line: string): string[] {
  const out: string[] = [];
  let field = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) field += line[++i];
    else if (c === ":") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

export async function network(rescan: boolean): Promise<NetworkPanel> {
  const enabled = (await exec(["nmcli", "-t", "-f", "WIFI", "general"])).stdout.trim() === "enabled";
  const known = new Set(
    (await exec(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])).stdout
      .split("\n")
      .map(fields)
      .filter((f) => f[1] === "802-11-wireless")
      .map((f) => f[0]!),
  );
  const list = enabled
    ? (await exec(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", rescan ? "yes" : "auto"])).stdout
    : "";
  const bySsid = new Map<string, WifiNetwork>();
  for (const line of list.split("\n")) {
    if (!line) continue;
    const [inUse, ssid, signal, security] = fields(line);
    if (!ssid) continue;
    const network: WifiNetwork = { ssid, signal: Number(signal) || 0, secure: !!security && security !== "--", active: inUse === "*", known: known.has(ssid) };
    const seen = bySsid.get(ssid);
    if (!seen || network.active || (!seen.active && network.signal > seen.signal)) bySsid.set(ssid, network);
  }
  const networks = [...bySsid.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.signal - a.signal);
  const device = (await exec(["nmcli", "-t", "-f", "IP4.ADDRESS", "device", "show", "wlan0"])).stdout.split("\n")[0] ?? "";
  return { enabled, networks, address: fields(device)[1]?.split("/")[0] ?? "" };
}

export async function wifiConnect(ssid: string, password?: string): Promise<void> {
  const known = (await exec(["nmcli", "-t", "-f", "NAME", "connection", "show"])).stdout.split("\n").map((l) => fields(l)[0]);
  if (known.includes(ssid) && !password) {
    await must(["nmcli", "connection", "up", "id", ssid]);
    return;
  }
  await must(["nmcli", "device", "wifi", "connect", ssid, ...(password ? ["password", password] : [])]);
}

export async function wifiDisconnect(): Promise<void> {
  await must(["nmcli", "device", "disconnect", "wlan0"]);
}

export async function wifiForget(ssid: string): Promise<void> {
  await must(["nmcli", "connection", "delete", "id", ssid]);
}

export async function wifiPower(on: boolean): Promise<void> {
  await must(["nmcli", "radio", "wifi", on ? "on" : "off"]);
}

interface PactlDevice {
  name: string;
  description: string;
  mute: boolean;
  volume: Record<string, { value_percent: string }>;
}

/** The RG DS Plus's two outputs share one PipeWire description; their ALSA
 *  devices tell them apart: the AW883xx amplifier drives the speakers, the
 *  RK817 codec the headphone jack and the microphone. */
const RG_DS_PLUS: [RegExp, string][] = [
  [/^alsa_output\.platform-aw883x/, "Speakers"],
  [/^alsa_output\.platform-rk817/, "Headphones"],
  [/^alsa_input\.platform-rk817/, "Microphone"],
];

function devices(json: string, fallback: string): AudioDevice[] {
  const list = JSON.parse(json || "[]") as PactlDevice[];
  return list
    .filter((d) => !d.name.endsWith(".monitor"))
    .map((d) => {
      const levels = Object.values(d.volume ?? {}).map((v) => parseInt(v.value_percent, 10));
      return {
        name: d.name,
        label: RG_DS_PLUS.find(([pattern]) => pattern.test(d.name))?.[1] ?? (d.description || d.name),
        volume: levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 0,
        muted: d.mute,
        current: d.name === fallback,
      };
    });
}

export async function audio(): Promise<AudioPanel> {
  const [sinks, sources, sink, source] = await Promise.all([
    exec(["pactl", "-f", "json", "list", "sinks"]),
    exec(["pactl", "-f", "json", "list", "sources"]),
    exec(["pactl", "get-default-sink"]),
    exec(["pactl", "get-default-source"]),
  ]);
  return { outputs: devices(sinks.stdout, sink.stdout.trim()), inputs: devices(sources.stdout, source.stdout.trim()) };
}

export async function audioSet(kind: "sink" | "source", name: string, change: { volume?: number; muted?: boolean; current?: boolean }) {
  // wpctl talks to PipeWire itself; pactl goes through pipewire-pulse and answers later
  if (change.volume !== undefined) await must(["wpctl", "set-volume", name, `${Math.max(0, Math.min(150, Math.round(change.volume)))}%`]);
  if (change.muted !== undefined) await must(["pactl", `set-${kind}-mute`, name, change.muted ? "1" : "0"]);
  if (change.current) await must(["pactl", `set-default-${kind}`, name]);
}

/** Both panels' backlights move together. The daemon reads and writes
 *  their sysfs files itself (no process per step): a udev rule gives the
 *  video group the brightness files (device/rootfs/etc/udev/rules.d). Where
 *  the write is refused, brightnessctl sets it through logind. */
const BACKLIGHTS = ["backlight", "backlight1"];
const backlightFile = (device: string, name: string) => `/sys/class/backlight/${device}/${name}`;
const readNumber = (path: string) => {
  try {
    return Number(readFileSync(path, "utf8").trim());
  } catch {
    return NaN;
  }
};

/** The first backlight's level as a percentage, or null without one. */
export function brightness(): number | null {
  const max = readNumber(backlightFile(BACKLIGHTS[0]!, "max_brightness"));
  const now = readNumber(backlightFile(BACKLIGHTS[0]!, "brightness"));
  return Number.isFinite(max) && Number.isFinite(now) && max > 0 ? Math.round((now * 100) / max) : null;
}

export async function power(): Promise<PowerPanel> {
  const [list, current] = await Promise.all([exec(["powerprofilesctl", "list"]), exec(["powerprofilesctl", "get"])]);
  const profiles = [...list.stdout.matchAll(/^[* ] ([\w-]+):$/gm)].map((m) => m[1]!);
  return { profiles, profile: current.stdout.trim(), brightness: brightness() };
}

async function setBacklight(device: string, percent: number) {
  const max = readNumber(backlightFile(device, "max_brightness"));
  if (!Number.isFinite(max)) return;
  const raw = String(Math.max(1, Math.round((max * percent) / 100)));
  try {
    writeFileSync(backlightFile(device, "brightness"), raw);
  } catch {
    await must(["brightnessctl", "-q", "-d", device, "set", `${percent}%`]);
  }
}

export async function powerSet(change: { profile?: string; brightness?: number }) {
  if (change.profile) await must(["powerprofilesctl", "set", change.profile]);
  if (change.brightness !== undefined) {
    const percent = Math.max(5, Math.min(100, Math.round(change.brightness)));
    await Promise.all(BACKLIGHTS.map((device) => setBacklight(device, percent)));
  }
}

/** `bluetoothctl devices [filter]`: "Device <mac> <name>" lines. */
async function btDevices(filter?: string): Promise<Map<string, string>> {
  const out = (await exec(["bluetoothctl", "devices", ...(filter ? [filter] : [])])).stdout;
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^Device ([0-9A-F:]{17}) (.*)$/.exec(line.trim());
    if (m) map.set(m[1]!, m[2]!);
  }
  return map;
}

export async function bluetooth(scan: boolean): Promise<BluetoothPanel> {
  const show = await exec(["bluetoothctl", "show"]);
  if (show.code !== 0 || !/Controller/.test(show.stdout)) return { adapter: false, powered: false, devices: [] };
  const powered = /Powered: yes/.test(show.stdout);
  if (scan && powered) await exec(["bluetoothctl", "--timeout", "8", "scan", "on"]);
  const [all, paired, connected] = await Promise.all([btDevices(), btDevices("Paired"), btDevices("Connected")]);
  const devices: BluetoothDevice[] = [...all].map(([mac, name]) => ({ mac, name, paired: paired.has(mac), connected: connected.has(mac) }));
  devices.sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name));
  return { adapter: true, powered, devices };
}

export async function bluetoothPower(on: boolean) {
  await must(["bluetoothctl", "power", on ? "on" : "off"]);
}

/** Pairs (Just Works: no PIN on either side), trusts and connects. */
export async function bluetoothConnect(mac: string) {
  const paired = await btDevices("Paired");
  if (!paired.has(mac)) {
    await must(["bluetoothctl", "--agent", "NoInputNoOutput", "--timeout", "20", "pair", mac]);
    await must(["bluetoothctl", "trust", mac]);
  }
  await must(["bluetoothctl", "--timeout", "15", "connect", mac]);
}

export async function bluetoothDisconnect(mac: string) {
  await must(["bluetoothctl", "disconnect", mac]);
}

export async function bluetoothForget(mac: string) {
  await must(["bluetoothctl", "remove", mac]);
}
