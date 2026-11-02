// The apps pinned under the Home map (shell/src/deck/pins.ts): a list of the
// Apps rows' ids in ~/.local/state/omarchy-pocket/pins.json. No file, or one
// that is not a list of strings, reads as null: nothing has been chosen, and
// the shell pins its defaults.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** more than the shell shows; a longer list is cut here */
const LIMIT = 32;

export const pinsPath = (home: string) => join(home, ".local", "state", "omarchy-pocket", "pins.json");

export function readPins(home: string): string[] | null {
  try {
    const value: unknown = JSON.parse(readFileSync(pinsPath(home), "utf8"));
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) return null;
    return value.slice(0, LIMIT);
  } catch {
    return null;
  }
}

/** Writes the list whole: a new file renamed over the old one. */
export function writePins(home: string, ids: readonly unknown[]) {
  const path = pinsPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256))].slice(0, LIMIT);
  writeFileSync(`${path}.new`, JSON.stringify(clean) + "\n");
  renameSync(`${path}.new`, path);
}
