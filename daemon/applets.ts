// What the shell's applets read from the system: CPU, memory, temperature
// and network figures (Activity), the busiest processes, the pictures in
// ~/Pictures and the theme's backgrounds (Pictures), the note files in
// ~/Documents/Notes (Notes), and the screensaver's text.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Picture, Process, SystemStats } from "./protocol.ts";

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

interface Sample {
  at: number;
  cpu: number[][]; // per line of /proc/stat: [busy, total]
  rx: number;
  tx: number;
}
let last: Sample | null = null;

function sample(): Sample {
  const cpu = read("/proc/stat")
    .split("\n")
    .filter((l) => /^cpu\d* /.test(l))
    .map((l) => {
      const v = l.trim().split(/\s+/).slice(1).map(Number);
      const idle = (v[3] ?? 0) + (v[4] ?? 0);
      const total = v.reduce((a, b) => a + b, 0);
      return [total - idle, total];
    });
  let rx = 0;
  let tx = 0;
  for (const line of read("/proc/net/dev").split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || name!.trim() === "lo") continue;
    const v = rest.trim().split(/\s+/).map(Number);
    rx += v[0] ?? 0;
    tx += v[8] ?? 0;
  }
  return { at: Date.now(), cpu, rx, tx };
}

export function systemStats(): SystemStats {
  const now = sample();
  const before = last ?? now;
  last = now;
  const seconds = Math.max(0.001, (now.at - before.at) / 1000);
  const percent = (i: number) => {
    const [busy, total] = now.cpu[i] ?? [0, 0];
    const [busy0, total0] = before.cpu[i] ?? [0, 0];
    return total - total0 > 0 ? Math.round(((busy - busy0) * 100) / (total - total0)) : 0;
  };
  const mem = Object.fromEntries(
    read("/proc/meminfo")
      .split("\n")
      .map((l) => /^(\w+):\s+(\d+)/.exec(l))
      .filter((m) => m !== null)
      .map((m) => [m![1], Number(m![2])]),
  ) as Record<string, number>;
  const temps: { name: string; celsius: number }[] = [];
  try {
    for (const zone of readdirSync("/sys/class/thermal").filter((z) => z.startsWith("thermal_zone"))) {
      const t = Number(read(`/sys/class/thermal/${zone}/temp`));
      if (t) temps.push({ name: read(`/sys/class/thermal/${zone}/type`).trim(), celsius: Math.round(t / 100) / 10 });
    }
  } catch {}
  const freq = Number(read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")) / 1000;
  return {
    cpu: percent(0),
    cores: now.cpu.slice(1).map((_, i) => percent(i + 1)),
    mhz: Math.round(freq) || 0,
    memTotal: mem.MemTotal ?? 0,
    memUsed: (mem.MemTotal ?? 0) - (mem.MemAvailable ?? 0),
    temps,
    rx: Math.round((now.rx - before.rx) / seconds),
    tx: Math.round((now.tx - before.tx) / seconds),
    uptime: Math.round(Number(read("/proc/uptime").split(" ")[0])),
    load: read("/proc/loadavg").split(" ").slice(0, 3).join(" "),
  };
}

export async function processes(sort: "cpu" | "mem" = "cpu"): Promise<Process[]> {
  const child = Bun.spawn(["ps", "-eo", "pid=,pcpu=,rss=,comm=", sort === "mem" ? "--sort=-rss" : "--sort=-pcpu"], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(child.stdout).text();
  return text
    .split("\n")
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => {
      const [pid, cpu, rss, ...name] = line.trim().split(/\s+/);
      return { pid: Number(pid), cpu: Number(cpu), rssKb: Number(rss), name: name.join(" ") };
    });
}

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function pictures(home: string): Picture[] {
  const out: Picture[] = [];
  const dirs = [
    { dir: join(home, "Pictures"), group: "Pictures" },
    { dir: join(home, ".local", "state", "omarchy", "current", "theme", "backgrounds"), group: "Backgrounds" },
  ];
  for (const { dir, group } of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => IMAGE.test(n));
    } catch {
      continue;
    }
    const entries = names.map((name) => ({ name, path: join(dir, name), group, at: statSync(join(dir, name)).mtimeMs }));
    entries.sort((a, b) => (group === "Pictures" ? b.at - a.at : a.name.localeCompare(b.name)));
    out.push(...entries.map(({ name, path, group }) => ({ name, path, group })));
  }
  return out;
}

/** Notes live as Markdown files in ~/Documents/Notes; a name is a bare file name. */
function notePath(home: string, name: string): string {
  const dir = join(home, "Documents", "Notes");
  const path = resolve(dir, basename(name));
  if (!path.startsWith(dir) || !path.endsWith(".md")) throw new Error(`not a note: ${name}`);
  return path;
}

export function notes(home: string): string[] {
  const dir = join(home, "Documents", "Notes");
  mkdirSync(dir, { recursive: true });
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
}

export function noteRead(home: string, name: string): string {
  return read(notePath(home, name));
}

export function noteWrite(home: string, name: string, text: string) {
  const path = notePath(home, name);
  mkdirSync(join(home, "Documents", "Notes"), { recursive: true });
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** Omarchy's screensaver text, as omarchy-screensaver hands it to ttfx;
 *  Omarchy's logo when the branding file is missing. */
export function screensaverText(home: string): string {
  const text = read(join(home, ".config", "omarchy", "branding", "screensaver.txt")) || read("/usr/share/omarchy/logo.txt");
  return text.replace(/\s+$/, "");
}
