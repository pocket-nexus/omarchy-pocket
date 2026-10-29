#!/usr/bin/env bun
// Reads both panels of a running Omarchy Pocket back from the GPU and stacks
// them into one PNG, the device as it is held (top panel over bottom panel):
//
//   bun tools/screenshot.ts <ssh-host> [out.png]
//
// The host program answers `/tmp/pocket-shot` (created by the shell's user)
// with glReadPixels of each panel's next frame in /tmp/pocket-shot-<panel>.rgba,
// RGBA rows bottom first. SSH_OPTS adds options to ssh.
import { $ } from "bun";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodePNG } from "../vendor/pocketjs/tools/png.ts";

const [W, H] = [1024, 768];
const [target, out = "pocket-shot.png"] = process.argv.slice(2);
if (!target) throw new Error("usage: bun tools/screenshot.ts <ssh-host> [out.png]");
const ssh = (process.env.SSH_OPTS ?? "").split(" ").filter(Boolean);
const user = process.env.OMARCHY_POCKET_USER ?? "omarchy";

await $`ssh ${ssh} ${target} ${`rm -f /tmp/pocket-shot-*.rgba; runuser -u ${user} -- touch /tmp/pocket-shot; for i in $(seq 50); do [ -f /tmp/pocket-shot-1.rgba ] && [ ! -e /tmp/pocket-shot ] && break; sleep 0.1; done; sleep 0.2`}`;
const dir = mkdtempSync(join(tmpdir(), "pocket-shot-"));
await $`scp -q ${ssh} ${target}:/tmp/pocket-shot-0.rgba ${target}:/tmp/pocket-shot-1.rgba ${dir}/`;
const rgba = new Uint8Array(W * H * 2 * 4);
for (const panel of [0, 1]) {
  const raw = readFileSync(join(dir, `pocket-shot-${panel}.rgba`));
  for (let y = 0; y < H; y++) {
    const from = (H - 1 - y) * W * 4;
    rgba.set(raw.subarray(from, from + W * 4), (panel * H + y) * W * 4);
  }
}
for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
writeFileSync(resolve(out), encodePNG(rgba, W, H * 2));
console.log(resolve(out));
