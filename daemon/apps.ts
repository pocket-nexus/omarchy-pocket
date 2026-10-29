// The Apps menu's rows: PocketJS packages built for this device's profile
// (in /usr/share/omarchy-pocket/applets or ~/.local/share/omarchy-pocket/
// applets), which open in a window of the shell, and desktop entries that run in a terminal (Terminal=true, or an
// Exec through xdg-terminal-exec), which xdg-terminal-exec opens in Pocket Term.
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./protocol.ts";

/** Desktop entry field codes (%f %U %i ...) carry nothing for a terminal launch. */
const stripCodes = (exec: string) => exec.replace(/\s+%[a-zA-Z]/g, "").trim();

/** "pocket-motions.pocket" -> "Pocket Motions" */
const fileTitle = (file: string) =>
  file
    .replace(/\.pocket$/, "")
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** The package's pocket.json: it sits after the 32-byte header
 *  (contracts/spec/pocket-package.ts), its length at byte 8. */
export function manifest(path: string): { id?: string; title?: string; applet?: unknown; app?: { surfaces?: { auxiliary?: unknown } } } {
  try {
    const fd = openSync(path, "r");
    const head = Buffer.alloc(32);
    readSync(fd, head, 0, 32, 0);
    const size = head.toString("latin1", 0, 4) === "PCKT" ? head.readUInt32LE(8) : 0;
    const manifest = Buffer.alloc(Math.min(size, 1 << 20));
    readSync(fd, manifest, 0, manifest.length, 32);
    closeSync(fd);
    return JSON.parse(manifest.toString("utf8"));
  } catch {
    return {};
  }
}

function applets(home: string): App[] {
  const out: App[] = [];
  for (const dir of [join(home, ".local", "share", "omarchy-pocket", "applets"), "/usr/share/omarchy-pocket/applets"]) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".pocket"));
    } catch {
      continue;
    }
    for (const file of files) {
      if (out.some((a) => a.id === file)) continue;
      const m = manifest(join(dir, file));
      // "PocketJS: " prefixes the pocketjs apps' titles and says nothing in this list
      const name = m.title?.replace(/^PocketJS:\s*/, "") || fileTitle(file);
      out.push({ id: file, name, command: "", applet: join(dir, file), aux: m.app?.surfaces?.auxiliary !== undefined, appletSurface: m.applet !== undefined });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function apps(home: string): App[] {
  return [...applets(home), ...terminalApps(home)];
}

function terminalApps(home: string): App[] {
  const dirs = [join(home, ".local", "share", "applications"), "/usr/share/applications"];
  const seen = new Map<string, App>();
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".desktop"));
    } catch {
      continue;
    }
    for (const file of files) {
      if (seen.has(file)) continue; // the user's entry overrides the system's
      const fields = new Map<string, string>();
      let inEntry = false;
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
        if (line.startsWith("[")) inEntry = line.trim() === "[Desktop Entry]";
        else if (inEntry) {
          const at = line.indexOf("=");
          if (at > 0 && !fields.has(line.slice(0, at))) fields.set(line.slice(0, at), line.slice(at + 1).trim());
        }
      }
      if (fields.get("Type") !== "Application" || fields.get("NoDisplay") === "true" || fields.get("Hidden") === "true") continue;
      const exec = stripCodes(fields.get("Exec") ?? "");
      const terminal = fields.get("Terminal") === "true";
      if (!exec || (!terminal && !/\bxdg-terminal-exec\b/.test(exec))) continue;
      const id = file.slice(0, -".desktop".length);
      seen.set(file, { id, name: fields.get("Name") ?? id, command: terminal ? `xdg-terminal-exec ${exec}` : exec });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
