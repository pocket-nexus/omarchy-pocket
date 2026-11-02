// Builds /demo: the shell's bundle and pak for the browser (compiled with the
// device's own profile), PocketJS's core in WebAssembly, the page's host, one
// background per Omarchy theme.
//
//   bun site/build-demo.ts        (pocketjs needs Bun 1.4.2 for the compile: BUN142=<path>)
import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dir, "..");
const POCKETJS = join(ROOT, "vendor", "pocketjs");
const OUT = join(ROOT, "site", "public", "demo");
const CACHE = join(ROOT, ".cache", "web-sim");
const THEMES = join(ROOT, ".cache", "omarchy", "omarchy-4.5.0rc2-1-aarch64", "usr", "share", "omarchy", "themes");
const SKEL = join(ROOT, ".cache", "omarchy", "omarchy-settings-4.5.0rc2-1-aarch64", "etc", "skel", ".config", "omarchy", "branding", "screensaver.txt");
const BUN = process.env.BUN142 ?? `${process.env.HOME}/.bun/install/cache/@oven/bun-darwin-aarch64@1.4.2@@@1/bin/bun`;

mkdirSync(join(OUT, "walls"), { recursive: true });
mkdirSync(CACHE, { recursive: true });

if (!process.argv.includes("--skip-shell")) {
  await $`${BUN} ${join(POCKETJS, "tools", "pocket.ts")} compile --manifest shell/pocket.app.json --project-root . --host-config host/pocket.host.config.ts --outdir ${CACHE}`.cwd(ROOT).quiet();
  await $`${BUN} ${join(POCKETJS, "tools", "wasm.ts")}`.cwd(POCKETJS).quiet();
}
writeFileSync(join(OUT, "shell.js"), readFileSync(join(CACHE, "omarchy-pocket-main.js")));
writeFileSync(join(OUT, "shell.pak.gz"), gzipSync(readFileSync(join(CACHE, "omarchy-pocket-main.pak")), { level: 9 }));
writeFileSync(join(OUT, "pocketjs.wasm"), readFileSync(join(POCKETJS, "platforms", "web", "pocketjs.wasm")));
writeFileSync(join(OUT, "screensaver.txt"), readFileSync(SKEL));

const built = await Bun.build({
  entrypoints: [join(ROOT, "site", "demo", "host.js")], target: "browser", format: "esm", minify: true,
  plugins: [{
    name: "auxiliary-at-scale",
    // wasm-ops.js rasterizes the auxiliary surface at scale 1 only; this host needs density 2
    setup(build) {
      build.onLoad({ filter: /wasm-ops\.js$/ }, () => ({
        contents: readFileSync(join(POCKETJS, "platforms", "web", "wasm-ops.js"), "utf8").replace(
          `renderAuxiliary(){if(!auxiliary)throw new Error("No auxiliary display");return capture(1,4);}`,
          `renderAuxiliary(scale=1){if(!auxiliary)throw new Error("No auxiliary display");return capture(scale,4);}`,
        ),
        loader: "js",
      }));
    },
  }],
});
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
writeFileSync(join(OUT, "host.js"), await built.outputs[0]!.text());

const parse = (toml: string) => Object.fromEntries([...toml.matchAll(/^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)].map((m) => [m[1], m[2]!.toLowerCase()]));
const title = (slug: string) => slug.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
const themes: Record<string, { name: string; colors: Record<string, string> }> = {};
const FIRST: Record<string, string> = { "tokyo-night": "1-winding-road.webp" };
for (const slug of readdirSync(THEMES).sort()) {
  const dir = join(THEMES, slug);
  if (!existsSync(join(dir, "colors.toml"))) continue;
  themes[slug] = { name: title(slug), colors: parse(readFileSync(join(dir, "colors.toml"), "utf8")) };
  const out = join(OUT, "walls", `${slug}.webp`);
  if (existsSync(out)) continue;
  const backgrounds = readdirSync(join(dir, "backgrounds")).sort();
  const pick = FIRST[slug] ?? backgrounds[0]!;
  await $`magick ${join(dir, "backgrounds", pick)} -resize 1024x768^ -gravity center -extent 1024x768 -quality 72 ${out}`.quiet();
}
writeFileSync(join(OUT, "themes.json"), JSON.stringify(themes));
console.log(Object.keys(themes).length, "themes", (readdirSync(OUT).map((f) => f)).join(" "));
