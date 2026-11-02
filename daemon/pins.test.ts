import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pinsPath, readPins, writePins } from "./pins.ts";

describe("pins", () => {
  test("no file reads as nothing chosen, and a written list reads back", () => {
    const home = mkdtempSync(join(tmpdir(), "pins-"));
    expect(readPins(home)).toBeNull();
    writePins(home, ["apps.terminal", "apps.youtube", "apps.terminal", 7, ""]);
    expect(readPins(home)).toEqual(["apps.terminal", "apps.youtube"]);
    writePins(home, []);
    expect(readPins(home)).toEqual([]);
  });

  test("a file that is not a list of strings reads as nothing chosen", () => {
    const home = mkdtempSync(join(tmpdir(), "pins-"));
    mkdirSync(dirname(pinsPath(home)), { recursive: true });
    writeFileSync(pinsPath(home), '{"apps":1}');
    expect(readPins(home)).toBeNull();
    writeFileSync(pinsPath(home), "not json");
    expect(readPins(home)).toBeNull();
  });
});
