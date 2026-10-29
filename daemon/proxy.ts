// The Proxy panel's side in omarchy-pocketd: mihomo, the core Clash Verge Rev
// runs on a Mac, as `mihomo.service` with its configuration in /etc/mihomo
// (built from the Mac's Clash Verge profile; neither is in this repository).
// The unit starts and stops through systemd (a polkit rule lets the Omarchy
// user manage that one unit); the mode, the selector groups and their nodes
// go through mihomo's controller on 127.0.0.1:9097, whose secret the device
// keeps in /etc/omarchy-pocket/mihomo.secret (root:omarchy, 0640).
//
// The daemon itself reaches Discord and YouTube through mihomo
// (HTTPS_PROXY in its unit's drop-in); while mihomo is stopped the daemon
// drops those variables, so the applets' requests go out directly.
import { existsSync, readFileSync } from "node:fs";
import type { ProxyPanel } from "./protocol.ts";

const CONTROLLER = "http://127.0.0.1:9097";
const SECRET_FILE = "/etc/omarchy-pocket/mihomo.secret";
const UNIT = "mihomo.service";
const DELAY_URL = "https://www.gstatic.com/generate_204";
const DELAY_TIMEOUT_MS = 3000;
const MODES = ["rule", "global", "direct"] as const;

/** the proxy variables the unit gave the daemon, restored while mihomo runs */
const PROXY_ENV = Object.fromEntries(["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));

export const installed = () => existsSync("/etc/mihomo/config.yaml") || existsSync("/usr/local/bin/mihomo") || existsSync("/usr/bin/mihomo");

function secret(): string {
  try {
    return readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CONTROLLER}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${secret()}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(DELAY_TIMEOUT_MS + 2000),
  });
  if (!response.ok) throw new Error(`mihomo answered ${response.status}${response.status === 401 ? ` (no secret in ${SECRET_FILE})` : ""}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function active(): Promise<boolean> {
  const child = Bun.spawn(["systemctl", "is-active", "--quiet", UNIT], { stdout: "ignore", stderr: "ignore" });
  return (await child.exited) === 0;
}

/** Keeps the daemon's own proxy variables in step with the unit. */
function followUnit(running: boolean) {
  for (const [key, value] of Object.entries(PROXY_ENV)) {
    if (running) process.env[key] = value;
    else delete process.env[key];
  }
}

interface Proxy {
  name: string;
  type: string;
  now?: string;
  all?: string[];
  history?: { delay: number }[];
}

export async function proxy(): Promise<ProxyPanel> {
  if (!installed()) return { installed: false, running: false, mode: "", groups: [] };
  const running = await active();
  followUnit(running);
  if (!running) return { installed: true, running, mode: "", groups: [] };
  const [configs, proxies] = await Promise.all([api<{ mode?: string }>("/configs"), api<{ proxies: Record<string, Proxy> }>("/proxies")]);
  const mode = configs.mode ?? "rule";
  const delayOf = (name: string) => proxies.proxies[name]?.history?.at(-1)?.delay || null;
  const groups = Object.values(proxies.proxies)
    // GLOBAL is the group global mode uses; the rules use the others
    .filter((p) => p.type === "Selector" && p.all?.length && (p.name !== "GLOBAL" || mode === "global"))
    .map((p) => ({ name: p.name, now: p.now ?? "", all: p.all!, delay: p.now ? delayOf(p.now) : null }));
  return { installed: true, running, mode, groups };
}

export async function proxySet(change: { running?: boolean; mode?: string; group?: string; node?: string; test?: string }) {
  if (change.running !== undefined) {
    const child = Bun.spawn(["systemctl", "--no-ask-password", change.running ? "start" : "stop", UNIT], { stdout: "ignore", stderr: "pipe" });
    const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(error.trim().split("\n")[0] || `systemctl exited ${code}`);
    followUnit(change.running);
  }
  if (change.mode) {
    if (!(MODES as readonly string[]).includes(change.mode)) throw new Error(`no mode ${change.mode}`);
    await api("/configs", { method: "PATCH", body: JSON.stringify({ mode: change.mode }) });
  }
  if (change.group && change.node) await api(`/proxies/${encodeURIComponent(change.group)}`, { method: "PUT", body: JSON.stringify({ name: change.node }) });
  // a group's latency test: every node in it, the delays land in each node's history
  if (change.test) await api(`/group/${encodeURIComponent(change.test)}/delay?url=${encodeURIComponent(DELAY_URL)}&timeout=${DELAY_TIMEOUT_MS}`).catch(() => undefined);
}
