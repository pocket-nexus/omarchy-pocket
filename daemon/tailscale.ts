// The Tailscale panel's side in omarchy-pocketd: tailscaled as
// `tailscaled.service` (Arch's package), driven through the `tailscale` CLI,
// which the Omarchy user may run because the operator is set to that user
// (`tailscale set --operator=omarchy`, device/rootfs
// omarchy-pocket-tailscale-operator.service). The unit starts and stops
// through systemd (a polkit rule lets the Omarchy user manage that one
// unit).
//
// The device's kernel (Rockchip 6.1.141) has no TUN device and no nftables,
// so tailscaled runs with `--tun=userspace-networking` (/etc/default/
// tailscaled): the node is reachable from the tailnet (SSH, the bridge) and
// reaches other nodes through its SOCKS5/HTTP proxy on 127.0.0.1:1055.
//
// A login: `tailscale up` is started and left running; while it waits,
// `tailscale status --json` carries the login URL (AuthURL), which the panel
// shows as a QR code on the stage; once the browser side finishes, the node
// comes up and the process ends.
import { existsSync } from "node:fs";
import type { SystemState, TailscalePanel } from "./protocol.ts";

const UNIT = "tailscaled.service";
const CLI_TIMEOUT_MS = 8000;

export const installed = () => existsSync("/usr/bin/tailscale");

async function run(args: string[], timeoutMs = CLI_TIMEOUT_MS): Promise<{ code: number; out: string; err: string }> {
  const child = Bun.spawn(["tailscale", ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out, err };
}

async function active(): Promise<boolean> {
  const child = Bun.spawn(["systemctl", "is-active", "--quiet", UNIT], { stdout: "ignore", stderr: "ignore" });
  return (await child.exited) === 0;
}

interface Node {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[] | null;
  Online?: boolean;
}

interface Status {
  BackendState?: string;
  AuthURL?: string;
  Self?: Node;
  Peer?: Record<string, Node>;
  CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string };
}

async function status(): Promise<Status | null> {
  const result = await run(["status", "--json"]);
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.out) as Status;
  } catch {
    return null;
  }
}

const trimDns = (name: string) => name.replace(/\.$/, "");

/** `tailscale up`, left running while it waits for a browser login. */
let login: ReturnType<typeof Bun.spawn> | null = null;

function startLogin() {
  if (login && login.exitCode === null) return;
  login = Bun.spawn(["tailscale", "up"], { stdout: "ignore", stderr: "ignore" });
  void login.exited.then(() => {
    login = null;
  });
}

function stopLogin() {
  if (login && login.exitCode === null) login.kill();
  login = null;
}

/** The node's state for the bar and the home layout, null while tailscale is not installed. */
export async function state(): Promise<SystemState["tailscale"]> {
  if (!installed()) return null;
  if (!(await active())) return { state: "Stopped", ip: "" };
  const s = await status();
  return { state: s?.BackendState ?? "NoState", ip: s?.Self?.TailscaleIPs?.[0] ?? "" };
}

export async function tailscale(): Promise<TailscalePanel> {
  const empty: TailscalePanel = { installed: false, running: false, state: "", authUrl: "", self: null, tailnet: "", peers: [] };
  if (!installed()) return empty;
  const running = await active();
  if (!running) return { ...empty, installed: true, state: "Stopped" };
  const s = await status();
  if (!s) return { ...empty, installed: true, running, state: "NoState" };
  const self = s.Self ? { name: s.Self.HostName ?? "", ip: s.Self.TailscaleIPs?.[0] ?? "", dns: trimDns(s.Self.DNSName ?? "") } : null;
  const peers = Object.values(s.Peer ?? {})
    .map((p) => ({ name: p.HostName || trimDns(p.DNSName ?? "").split(".")[0] || "?", ip: p.TailscaleIPs?.[0] ?? "", online: p.Online === true, os: p.OS ?? "" }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return { installed: true, running, state: s.BackendState ?? "NoState", authUrl: s.AuthURL ?? "", self, tailnet: s.CurrentTailnet?.Name ?? "", peers };
}

export async function tailscaleSet(change: { running?: boolean; up?: boolean; logout?: boolean }) {
  if (change.running !== undefined) {
    if (!change.running) stopLogin();
    const child = Bun.spawn(["systemctl", "--no-ask-password", change.running ? "start" : "stop", UNIT], { stdout: "ignore", stderr: "pipe" });
    const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(error.trim().split("\n")[0] || `systemctl exited ${code}`);
  }
  if (change.up === true) {
    // Logged in: up returns at once. Not logged in: it waits for the browser
    // login, so it runs on and the status carries the URL meanwhile.
    const s = await status();
    if (s?.BackendState === "NeedsLogin") startLogin();
    else {
      const result = await run(["up", "--timeout=10s"], 15_000);
      if (result.code !== 0) throw new Error(result.err.trim().split("\n")[0] || "tailscale up failed");
    }
  } else if (change.up === false) {
    stopLogin();
    const result = await run(["down"]);
    if (result.code !== 0) throw new Error(result.err.trim().split("\n")[0] || "tailscale down failed");
  }
  if (change.logout) {
    stopLogin();
    const result = await run(["logout"]);
    if (result.code !== 0) throw new Error(result.err.trim().split("\n")[0] || "tailscale logout failed");
  }
}
