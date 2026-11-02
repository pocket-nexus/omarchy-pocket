// SPDX-License-Identifier: GPL-3.0-or-later
// `pocket-applet check <name>`: the rules an applet is held to, with what to do
// instead. `run` and `build` stop on an error; `publish` also stops on a warning.
//
// A file that draws a game or a map opens with a line
//   // pocket-applet: draws its own pixels because <reason>
// and the layout rules leave it alone.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { packMock } from "./mock.ts";

export interface Finding {
  level: "error" | "warning";
  file: string;
  line: number;
  message: string;
}

const CUSTOM = /^\/\/ pocket-applet: draws its own pixels because \S/m;
const ROWS = "a page is rows, not positioned views: use listPage and rows.cell/section/text/strip/message (../kit/README.md)";

/** Rules for pages: a file that draws its own pixels is exempt. */
const LAYOUT: [RegExp, string][] = [
  [/from\s+["']@pocketjs\/framework\/components["']/, ROWS],
  [/<(View|Text|Image)\b/, ROWS],
  [/\b(insetL|insetT|bgColor|textColor)\b|\bclass=/, ROWS],
  [/["'`]#[0-9a-fA-F]{3,8}["'`]/, "a colour of your own: pages take their colours from the kit (rows' tones, ICONS' colours); a pill's colour is hex without the #"],
  [/from\s+["']\.\.\/ui\/(?!window|keep)/, "../ui is what the kit is built from: use ../kit (only ../ui/window.tsx and ../ui/keep.ts are for apps)"],
  [/createNavStack|createTouchRouter|createPress\b|createOsk\b/, "createApp already has the stack, touch and keys; a typed value is app.compose (../kit/README.md)"],
];

/** Rules for every file. */
const ANYWHERE: [RegExp, string][] = [
  [/\bsetTimeout\b|\bsetInterval\b/, "there are no timers: after() from @pocketjs/framework/clock"],
  [/\bTextDecoder\b|\blocalStorage\b|\bdocument\.|(?<![/.])\bwindow\./, "this is QuickJS with no browser: no DOM, no storage; keep settings in the store service"],
  [/["'`][^"'`]*\p{Extended_Pictographic}[^"'`]*["'`]/u, "an emoji in the interface: use an icon from ICONS"],
];

const STRIP = (line: string) => line.replace(/\/\/ (?!shown, not fetched).*$/, "");
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "art" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

export function checkApplet(dir: string, template?: string): Finding[] {
  const out: Finding[] = [];
  const manifestPath = join(dir, "pocket.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const hosts = new Set<string>(manifest.applet?.hosts ?? []);
  const services = new Set<string>(manifest.applet?.services ?? []);
  const add = (level: Finding["level"], file: string, line: number, message: string) => out.push({ level, file, line, message });

  for (const path of sources(dir)) {
    const file = relative(dir, path);
    const text = readFileSync(path, "utf8");
    const custom = CUSTOM.test(text);
    const lines = text.split("\n");
    lines.forEach((raw, index) => {
      if (isComment(raw)) return;
      const line = STRIP(raw);
      const at = index + 1;
      if (!custom) for (const [rule, message] of LAYOUT) if (rule.test(line)) add("error", file, at, message);
      for (const [rule, message] of ANYWHERE) if (rule.test(line)) add("error", file, at, message);
      const shown = index > 0 && lines[index - 1]!.includes("shown, not fetched");
      for (const match of line.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
        const host = match[1]!;
        if (!shown && !line.includes("shown, not fetched") && !hosts.has(host)) add("error", file, at, `${host} is not in applet.hosts in pocket.json: list it, or the device refuses the request once the app is published`);
      }
      for (const match of line.matchAll(/companionService\(\s*["'`]([a-z-]+)["'`]/g)) {
        if (!services.has(match[1]!)) add("error", file, at, `the service ${match[1]} is not in applet.services in pocket.json`);
      }
      if (/\bavatar:/.test(line) && !services.has("images")) add("error", file, at, "an avatar comes through the images service: add \"images\" to applet.services, and its host to applet.hosts");
    });
    if (/\bqueries\.query\b/.test(text) && !/\bqueryRows\b/.test(text) && !/\.error\(\)/.test(text)) add("error", file, 1, "a query can fail: draw it with queryRows from ../kit/page.ts, which shows the failure and a retry");
    if (/\bqueries\.paged\b/.test(text) && !/\bpagedRows\b/.test(text) && !/\.error\(\)/.test(text)) add("error", file, 1, "a list can be empty or fail: draw it with pagedRows from ../kit/page.ts");
    if (/\bonEnd\b/.test(text) === false && /\bqueries\.paged\b/.test(text)) add("warning", file, 1, "a paged list without onEnd never loads its next page: pass onEnd: list.more to listPage");
    if (/\/\/ TEMPLATE\b/.test(text)) add("warning", file, 1, "still the template: replace it with what the app does");
  }

  const svg = join(dir, "icon.svg");
  if (!existsSync(svg) && !existsSync(join(dir, "icon.png"))) add("error", "icon.svg", 1, "an app needs a 128 px icon");
  if (existsSync(svg)) {
    const icon = readFileSync(svg, "utf8");
    if (/<text\b/.test(icon)) add("error", "icon.svg", 1, "an icon is a picture of what the app is, never letters");
    if (template && existsSync(join(template, "icon.svg")) && icon === readFileSync(join(template, "icon.svg"), "utf8")) add("warning", "icon.svg", 1, "still the template's icon: draw a concise picture of what the app is");
  }
  const sample = packMock(dir);
  if (Array.isArray(sample)) for (const problem of sample) add("error", "mock/mock.json", 1, `${problem} (sdk/mock.ts says what sample data holds)`);
  const summary = String(manifest.applet?.summary ?? "");
  if (/ for Omarchy Pocket\.$/.test(summary)) add("warning", "pocket.json", 1, "applet.summary says nothing yet: say in one line what the app does");
  return out;
}

export function printFindings(findings: Finding[]): void {
  for (const f of findings) console.log(`${f.level === "error" ? "error" : "warning"} ${f.file}:${f.line} ${f.message}`);
}
