// The Apps menu's rows: desktop entries that run in a terminal (Terminal=true,
// or an Exec through xdg-terminal-exec), the applications Omarchy Pocket can
// start without a Wayland compositor. They launch through xdg-terminal-exec,
// which opens them in Pocket Term.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./protocol.ts";

/** Desktop entry field codes (%f %U %i ...) carry nothing for a terminal launch. */
const stripCodes = (exec: string) => exec.replace(/\s+%[a-zA-Z]/g, "").trim();

export function apps(home: string): App[] {
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
