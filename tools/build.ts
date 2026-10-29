#!/usr/bin/env bun
// Builds Omarchy Pocket's three programs into .cache/ (ignored):
//
//   bun tools/build.ts libs <ssh-host>   copy libmali from the device for the linker
//   bun tools/build.ts host              omarchy-pocket-host for aarch64 Linux (glibc 2.36)
//   bun tools/build.ts shell             the shell package (run tools/omarchy-assets.ts first)
//   bun tools/build.ts daemon            omarchy-pocketd as one Bun script
//   bun tools/build.ts all               host, shell and daemon
//   bun tools/build.ts shot --script "30:shot 40:DOWN 50:shot" [--out <dir>]
//
// `shot` runs the shell package with the host built for this computer, the CPU
// raster renderer and no bridge, and writes each `shot` event of the script
// as <out>/<tick>.png, the top panel over the bottom one. Layout work only:
// the device renders on the GPU.
//
// Outputs:
//   .cache/host/cargo/aarch64-unknown-linux-gnu/release/omarchy-pocket-host
//   .cache/shell/omarchy-pocket.pocket
//   .cache/daemon/omarchy-pocketd.js, ghostty-vt.wasm, shim.js (hyprctl, uwsm, uwsm-app, omarchy-pocket-term)
import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePNG } from "../vendor/pocketjs/tools/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const POCKETJS = join(ROOT, "vendor", "pocketjs");
const CACHE = join(ROOT, ".cache");
const CONFIG = "host/pocket.runtime-config.ts";
const PROFILE_RS = join(CACHE, "host", "profile", "pocket_profile.rs");
const LIBS = join(CACHE, "host", "gl-libs");
const TARGET = "aarch64-unknown-linux-gnu";
export const OUTPUTS = {
  host: join(CACHE, "host", "cargo", TARGET, "release", "omarchy-pocket-host"),
  shell: join(CACHE, "shell", "omarchy-pocket.pocket"),
  daemon: join(CACHE, "daemon", "omarchy-pocketd.js"),
  shim: join(CACHE, "daemon", "shim.js"),
  /** libghostty's VT core, which omarchy-pocketd loads from beside itself */
  wasm: join(CACHE, "daemon", "ghostty-vt.wasm"),
};
/** The names daemon/shim.ts is installed under, in /usr/local/bin */
export const SHIM_NAMES = ["hyprctl", "uwsm", "uwsm-app", "omarchy-pocket-term", "omasnap"];
const [W, H] = [1024, 768];

const argv = process.argv.slice(2);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

async function profile() {
  await $`bun ${join(POCKETJS, "tools", "pocket.ts")} profile export --config ${CONFIG} --out ${join(CACHE, "host", "profile")}`.cwd(ROOT).quiet();
}

async function libs(host: string) {
  mkdirSync(LIBS, { recursive: true });
  const ssh = (process.env.SSH_OPTS ?? "").split(" ").filter(Boolean);
  const path = (await $`ssh ${ssh} ${host} 'ls /usr/lib/mali/libmali.so.1.9.0 /usr/lib/libmali.so.1.9.0 2>/dev/null | head -1'`.text()).trim();
  if (!path) throw new Error(`${host} has no libmali.so.1.9.0`);
  await $`scp -q ${ssh} ${host}:${path} ${join(LIBS, "libmali.so.1.9.0")}`;
  for (const name of ["libmali.so.1", "libmali.so"]) {
    const link = join(LIBS, name);
    if (existsSync(link)) unlinkSync(link);
    symlinkSync("libmali.so.1.9.0", link);
  }
  console.log(`libs: ${path} -> ${LIBS}`);
}

async function host() {
  if (!existsSync(join(LIBS, "libmali.so"))) throw new Error(`no ${join(LIBS, "libmali.so")}; run: bun tools/build.ts libs <ssh-host>`);
  await profile();
  await $`cargo zigbuild --release -p omarchy-pocket-host --target ${TARGET}.2.36 --target-dir ${join(CACHE, "host", "cargo")}`
    .cwd(ROOT)
    .env({ ...process.env, POCKETJS_PROFILE_RS: PROFILE_RS, OMARCHY_POCKET_GL_LIBS: LIBS });
  console.log(`host: ${OUTPUTS.host}`);
}

async function shell() {
  if (!existsSync(join(ROOT, "shell", "src", "generated", "menu.ts"))) throw new Error("no generated menu; run: bun tools/omarchy-assets.ts");
  await $`bun ${join(POCKETJS, "tools", "pocket.ts")} compile --manifest shell/pocket.json --project-root . --runtime-config ${CONFIG} --plan-dir ${join(CACHE, "shell", "plan")} --output ${OUTPUTS.shell}`.cwd(ROOT);
  console.log(`shell: ${OUTPUTS.shell}`);
}

async function daemon() {
  rmSync(join(CACHE, "daemon"), { recursive: true, force: true });
  const wasm = join(ROOT, "daemon", "node_modules", "@wterm", "ghostty", "wasm", "ghostty-vt.wasm");
  if (!existsSync(wasm)) await $`bun install --frozen-lockfile`.cwd(join(ROOT, "daemon"));
  if (!existsSync(join(ROOT, "vendor", "pocket-term", "host", "grid.ts"))) throw new Error("no vendor/pocket-term; run: git submodule update --init vendor/pocket-term");
  // dbus-next tries usocket (native) and x11 at run time and falls back without them
  await $`bun build daemon/main.ts --target=bun --external usocket --external x11 --outfile ${OUTPUTS.daemon}`.cwd(ROOT).quiet();
  await $`cp ${wasm} ${OUTPUTS.wasm}`;
  await $`bun build daemon/shim.ts --target=bun --outfile ${OUTPUTS.shim}`.cwd(ROOT).quiet();
  const shim = readFileSync(OUTPUTS.shim, "utf8");
  if (!shim.startsWith("#!")) writeFileSync(OUTPUTS.shim, `#!/usr/bin/env bun\n${shim}`);
  console.log(`daemon: ${OUTPUTS.daemon} ${OUTPUTS.shim}`);
}

async function shot() {
  const script = option("--script");
  if (!script) throw new Error("shot needs --script");
  const dir = resolve(option("--out") ?? join(CACHE, "shots"));
  await profile();
  const targetDir = join(CACHE, "host", "native");
  await $`cargo build -p omarchy-pocket-host --target-dir ${targetDir}`.cwd(ROOT).env({ ...process.env, POCKETJS_PROFILE_RS: PROFILE_RS });
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await $`${join(targetDir, "debug", "omarchy-pocket-host")} --package ${OUTPUTS.shell} --shot ${dir} --script ${script}`;
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
  console.log(`shot: frames in ${dir}`);
}

if (import.meta.main) {
  switch (argv[0]) {
    case "libs":
      if (!argv[1]) throw new Error("libs needs an SSH host, e.g. root@23.23.23.28");
      await libs(argv[1]);
      break;
    case "host":
      await host();
      break;
    case "shell":
      await shell();
      break;
    case "daemon":
      await daemon();
      break;
    case "all":
      await host();
      await shell();
      await daemon();
      break;
    case "shot":
      await shot();
      break;
    default:
      console.error("usage: bun tools/build.ts libs <ssh-host> | host | shell | daemon | all | shot --script <events> [--out <dir>]");
      process.exit(2);
  }
}
