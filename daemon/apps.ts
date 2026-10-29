// The Apps menu's rows: PocketJS applets (packages built for this device's
// profile, in /usr/share/omarchy-pocket/applets or ~/.local/share/
// omarchy-pocket/applets), which the host program runs in place of the
// shell, and desktop entries that run in a terminal (Terminal=true, or an
// Exec through xdg-terminal-exec), which xdg-terminal-exec opens in Pocket Term.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./protocol.ts";

/** Desktop entry field codes (%f %U %i ...) carry nothing for a terminal launch. */
const stripCodes = (exec: string) => exec.replace(/\s+%[a-zA-Z]/g, "").trim();

/** "pocket-motions.pocket" -> "Pocket Motions" */
const title = (file: string) =>
  file
    .replace(/\.pocket$/, "")
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

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
      out.push({ id: file, name: title(file), command: "", applet: join(dir, file) });
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
