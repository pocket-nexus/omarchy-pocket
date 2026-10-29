#!/usr/bin/env bun
// Stacks a --shot frame's two panels (DIR/<tick>-top.xrgb over
// DIR/<tick>-bottom.xrgb, 1024x768 little-endian XRGB8888 each) into
// DIR/<tick>.png, the device as it is held.
//   bun tools/xrgb-png.ts DIR
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePNG } from "../vendor/pocketjs/tools/png.ts";

const [W, H] = [1024, 768];
const dir = process.argv[2];
if (!dir) throw new Error("usage: bun tools/xrgb-png.ts DIR");
for (const name of readdirSync(dir).filter((n) => n.endsWith("-top.xrgb"))) {
  const tick = name.slice(0, -"-top.xrgb".length);
  const rgba = new Uint8Array(W * H * 2 * 4);
  [`${tick}-top.xrgb`, `${tick}-bottom.xrgb`].forEach((file, panel) => {
    const raw = readFileSync(join(dir, file));
    for (let i = 0; i < W * H; i++) {
      const o = (panel * W * H + i) * 4;
      rgba[o] = raw[i * 4 + 2]!;
      rgba[o + 1] = raw[i * 4 + 1]!;
      rgba[o + 2] = raw[i * 4]!;
      rgba[o + 3] = 255;
    }
  });
  writeFileSync(join(dir, `${tick}.png`), encodePNG(rgba, W, H * 2));
}
