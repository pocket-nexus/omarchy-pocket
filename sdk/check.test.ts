// SPDX-License-Identifier: GPL-3.0-or-later
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkApplet } from "./check.ts";

const ROOT = resolve(import.meta.dir, "..");
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function applet(files: Record<string, string>, applet: object = { services: ["store", "images", "glyphs"], hosts: [], summary: "Shows the tides." }) {
  const dir = mkdtempSync(join(tmpdir(), "applet-check-"));
  dirs.push(dir);
  writeFileSync(join(dir, "pocket.json"), JSON.stringify({ applet }));
  writeFileSync(join(dir, "icon.svg"), "<svg/>");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
const errors = (dir: string) => checkApplet(dir).filter((f) => f.level === "error").map((f) => f.message);

describe("pocket-applet check", () => {
  test("the template and the GitHub client pass", () => {
    const template = applet({ "app.tsx": readFileSync(join(ROOT, "sdk/template/app.tsx"), "utf8"), "main.tsx": readFileSync(join(ROOT, "sdk/template/main.tsx"), "utf8") });
    expect(errors(template)).toEqual([]);
    expect(checkApplet(template).map((f) => f.message).join()).toContain("still the template");
    expect(errors(join(ROOT, "applets/github"))).toEqual([]);
  });

  test("a positioned page is refused and told what to use", () => {
    const found = errors(applet({ "app.tsx": 'import { View } from "@pocketjs/framework/components";\nexport const A = () => <View style={{ insetL: 3, bgColor: "#123456" }} />;\n' }));
    expect(found.length).toBeGreaterThan(1);
    expect(found[0]).toContain("listPage");
  });

  test("a file that says it draws its own pixels may", () => {
    const found = errors(applet({ "game.tsx": '// pocket-applet: draws its own pixels because it is a game\nimport { View } from "@pocketjs/framework/components";\nexport const A = () => <View style={{ insetL: 3 }} />;\n' }));
    expect(found).toEqual([]);
  });

  test("the hosts and services an app uses are listed", () => {
    const code = 'const a = fetch("https://api.example.com/x");\nconst b = fetch(companionService("maps", "/tile"));\n';
    expect(errors(applet({ "a.ts": code })).join()).toContain("api.example.com");
    expect(errors(applet({ "a.ts": code })).join()).toContain("maps");
    expect(errors(applet({ "a.ts": code }, { services: ["maps"], hosts: ["api.example.com"], summary: "x" }))).toEqual([]);
  });

  test("a query with no failure state, timers and an emoji", () => {
    const found = errors(applet({ "a.tsx": 'const q = app.queries.query("x", load);\nsetTimeout(run, 10);\nconst s = "fire 🔥";\n' })).join();
    expect(found).toContain("queryRows");
    expect(found).toContain("after()");
    expect(found).toContain("emoji");
  });

  test("an icon of letters is refused", () => {
    const dir = applet({ "a.ts": "" });
    writeFileSync(join(dir, "icon.svg"), "<svg><text>GH</text></svg>");
    expect(errors(dir).join()).toContain("never letters");
  });
});
