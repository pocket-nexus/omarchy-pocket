// Builds the store's applet player (store/play/player.ts) as one classic
// script, and copies PocketJS's core in WebAssembly beside it. The frame that
// runs it has no origin, so neither may be a module or a fetch.
//
//   bun store/build-player.ts     (the core comes from pocketjs: bun tools/wasm.ts there)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const POCKETJS = join(ROOT, "vendor", "pocketjs");
const OUT = join(ROOT, "store", "site", "play");
mkdirSync(OUT, { recursive: true });

const built = await Bun.build({
  entrypoints: [join(ROOT, "store", "play", "player.ts")], target: "browser", format: "iife", minify: true,
  plugins: [{
    name: "auxiliary-at-scale",
    // wasm-ops.js rasterizes the auxiliary surface at scale 1 only; the player draws it at density 2
    setup(build) {
      build.onLoad({ filter: /wasm-ops\.js$/ }, () => {
        const source = readFileSync(join(POCKETJS, "platforms", "web", "wasm-ops.js"), "utf8");
        const before = `renderAuxiliary(){if(!auxiliary)throw new Error("No auxiliary display");return capture(1,4);}`;
        if (!source.includes(before)) throw new Error("wasm-ops.js changed: renderAuxiliary is not where the player expects it");
        return { contents: source.replace(before, `renderAuxiliary(scale=1){if(!auxiliary)throw new Error("No auxiliary display");return capture(scale,4);}`), loader: "js" };
      });
    },
  }],
});
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
writeFileSync(join(OUT, "player.js"), await built.outputs[0]!.text());
writeFileSync(join(OUT, "pocketjs.wasm"), readFileSync(join(POCKETJS, "platforms", "web", "pocketjs.wasm")));
console.log("player:", join(OUT, "player.js"));
