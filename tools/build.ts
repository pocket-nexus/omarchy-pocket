#!/usr/bin/env bun
// Builds Omarchy Pocket's three programs into .cache/ (ignored):
//
//   bun tools/build.ts libs <ssh-host>   copy libmali from the device for the linker
//   bun tools/build.ts host              omarchy-pocket-host for aarch64 Linux (glibc 2.36)
//   bun tools/build.ts shell             the shell package (run tools/omarchy-assets.ts first)
//   bun tools/build.ts daemon            omarchy-pocketd as one Bun script
//   bun tools/build.ts spotify           omarchy-pocket-spotify (spotify/) for aarch64 Linux (glibc 2.36)
//   bun tools/build.ts applets [names]   applets/<name>/pocket.json as .cache/applets/<name>.pocket
//   bun tools/build.ts sdk               what pocket-applet needs on the device, as .cache/sdk
//   bun tools/build.ts asr               voice input: sherpa-onnx, its Paraformer model and pocket-asr, as .cache/asr/out
//   bun tools/build.ts all               host, shell, daemon, spotify and the applets
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
const CONFIG = "host/pocket.host.config.ts";
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
  /** the Spotify applet's sign-in, internal API and speaker (daemon/spotify.ts runs it) */
  spotify: join(CACHE, "spotify", "cargo", TARGET, "release", "omarchy-pocket-spotify"),
};
/** The names daemon/shim.ts is installed under, in /usr/local/bin */
export const SHIM_NAMES = ["hyprctl", "uwsm", "uwsm-app", "omarchy-pocket-term", "omasnap", "omarchy-launch-screensaver"];
const [W, H] = [1024, 768];

const argv = process.argv.slice(2);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

async function profile() {
  await $`bun ${join(POCKETJS, "tools", "pocket.ts")} host export --config ${CONFIG} --out ${join(CACHE, "host", "profile")}`.cwd(ROOT).quiet();
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
    .env({ ...process.env, POCKETJS_PROFILE_RS: PROFILE_RS, OMARCHY_POCKET_GL_LIBS: LIBS, POCKET_WORKER_CARGO_MANIFEST: join(ROOT, "Cargo.toml") });
  console.log(`host: ${OUTPUTS.host}`);
}

/** omarchy-pocket-spotify: its own workspace (spotify/Cargo.toml), pure Rust
 *  with rustls, so zig links it with no sysroot. */
async function spotify() {
  await $`cargo zigbuild --release --target ${TARGET}.2.36 --target-dir ${join(CACHE, "spotify", "cargo")}`.cwd(join(ROOT, "spotify"));
  console.log(`spotify: ${OUTPUTS.spotify}`);
}

async function shell() {
  if (!existsSync(join(ROOT, "shell", "src", "generated", "menu.ts"))) throw new Error("no generated menu; run: bun tools/omarchy-assets.ts");
  await $`bun ${join(POCKETJS, "tools", "pocket.ts")} compile --manifest shell/pocket.app.json --project-root . --host-config ${CONFIG} --plan-dir ${join(CACHE, "shell", "plan")} --output ${OUTPUTS.shell}`.cwd(ROOT);
  console.log(`shell: ${OUTPUTS.shell}`);
}

async function daemon() {
  rmSync(join(CACHE, "daemon"), { recursive: true, force: true });
  const wasm = join(ROOT, "daemon", "node_modules", "@wterm", "ghostty", "wasm", "ghostty-vt.wasm");
  if (!existsSync(wasm)) await $`bun install --frozen-lockfile`.cwd(join(ROOT, "daemon"));
  if (!existsSync(join(ROOT, "vendor", "pocket-term", "host", "grid.ts"))) throw new Error("no vendor/pocket-term; run: git submodule update --init vendor/pocket-term");
  const built = await Bun.build({
    entrypoints: [join(ROOT, "daemon", "main.ts")],
    target: "bun",
    // dbus-next tries usocket (native) and x11 at run time and falls back without them
    external: ["usocket", "x11"],
    plugins: [
      {
        // opentype.js's ESM build has no default export; PocketJS's bake-font.ts
        // imports the default, which its UMD build (package main) provides
        name: "opentype-umd",
        setup(build) {
          build.onResolve({ filter: /^opentype\.js$/ }, () => ({ path: join(ROOT, "daemon", "node_modules", "opentype.js", "dist", "opentype.js") }));
        },
      },
    ],
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  mkdirSync(join(CACHE, "daemon"), { recursive: true });
  writeFileSync(OUTPUTS.daemon, await built.outputs[0]!.text());
  await $`cp ${wasm} ${OUTPUTS.wasm}`;
  // PocketJS's Rime helper and schema, which the image compiles and installs
  mkdirSync(join(CACHE, "daemon", "ime"), { recursive: true });
  for (const f of ["rime.c", "pocket_pinyin.schema.yaml"]) await $`cp ${join(POCKETJS, "tools", "ime", f)} ${join(CACHE, "daemon", "ime", f)}`;
  await $`bun build daemon/shim.ts --target=bun --outfile ${OUTPUTS.shim}`.cwd(ROOT).quiet();
  const shim = readFileSync(OUTPUTS.shim, "utf8");
  if (!shim.startsWith("#!")) writeFileSync(OUTPUTS.shim, `#!/usr/bin/env bun\n${shim}`);
  console.log(`daemon: ${OUTPUTS.daemon} ${OUTPUTS.shim}`);
}

/** The applets this device ships, from pocket-nexus/applets (vendor/applets),
 *  compiled for this host contract by that repository's build: one package
 *  each in .cache/applets, named for its directory (the Store client's is
 *  store.pocket), all of them or the names given. One that fails is reported
 *  and the rest are built. */
async function applets(names: string[]) {
  process.env.OMARCHY_POCKET_ROOT = ROOT;
  // the applets build with this repository's PocketJS, the same commit theirs pins
  process.env.POCKETJS_ROOT = POCKETJS;
  const { APPS } = await import("../vendor/applets/tools/apps.ts");
  const { buildFor, DEVICES } = await import("../vendor/applets/tools/build.ts");
  const device = DEVICES.find((d) => d.name === "omarchy-pocket")!;
  mkdirSync(join(CACHE, "applets"), { recursive: true });
  const failed: string[] = [];
  for (const name of names.length ? names : APPS) {
    try {
      const result = await buildFor(device, name);
      if (!("path" in result)) continue; // Camera, Photos and Notes need what this device has not
      const file = join(CACHE, "applets", `${name === "appstore" ? "store" : name}.pocket`);
      await $`cp ${result.path} ${file}`;
      console.log(`applet: ${file}`);
    } catch (error) {
      failed.push(name);
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
  if (failed.length) throw new Error(`applets that did not compile: ${failed.join(" ")}`);
}

/** The compiler, the UI kit and the examples for making applets on the device
 *  (sdk/pocket-applet.ts), laid out as this repository is. The packages are
 *  installed for the device's platform: the Vue compiler's one native module. */
async function sdk() {
  const out = join(CACHE, "sdk");
  const vendor = join(out, "vendor", "pocketjs");
  const lock = join(CACHE, "sdk-node_modules");
  const packageJson = JSON.parse(readFileSync(join(POCKETJS, "package.json"), "utf8"));
  for (const key of ["devDependencies", "workspaces", "scripts"]) delete packageJson[key];
  const manifest = JSON.stringify(packageJson, null, 1);
  if (!existsSync(join(lock, "package.json")) || readFileSync(join(lock, "package.json"), "utf8") !== manifest) {
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "package.json"), manifest);
    await $`bun install --production --linker hoisted --os linux --cpu arm64`.cwd(lock).quiet();
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(vendor, { recursive: true });
  await $`COPYFILE_DISABLE=1 tar cf - framework contracts tools assets microts hosts docs/HIG.md docs/APPLETS.md | tar xf - -C ${vendor}`.cwd(POCKETJS).nothrow();
  writeFileSync(join(vendor, "package.json"), manifest);
  await $`cp -R ${join(lock, "node_modules")} ${join(vendor, "node_modules")}`;
  await $`rm -rf ${join(vendor, "node_modules/@vue-jsx-vapor/compiler-rs-linux-arm64-musl")}`;
  mkdirSync(join(out, "host"));
  for (const file of ["pocket.host.config.ts", "pocket.host.json"]) await $`cp ${join(ROOT, "host", file)} ${join(out, "host")}`;
  // pocket-nexus/applets as the device needs it: the kit, the rules, the
  // template, the player and some finished applets to read
  const applets = join(out, "vendor", "applets");
  const from = join(ROOT, "vendor", "applets");
  mkdirSync(applets, { recursive: true });
  for (const name of ["ui", "lib", "kit", "template", "github", "weather", "hn", "podcasts", "maps", "appstore", "package.json", "README.md"]) await $`cp -RP ${join(from, name)} ${applets}`;
  mkdirSync(join(applets, "tools"));
  for (const name of ["check.ts", "mock.ts"]) await $`cp ${join(from, "tools", name)} ${join(applets, "tools")}`;
  mkdirSync(join(applets, "store", "src"), { recursive: true });
  mkdirSync(join(applets, "store", "play"), { recursive: true });
  mkdirSync(join(applets, "store", "site"), { recursive: true });
  await $`cp ${join(from, "store", "src", "shared.ts")} ${join(applets, "store", "src")}`;
  // the store website's player, for `pocket-applet web`
  await $`cp ${join(from, "store", "play", "serve.ts")} ${join(applets, "store", "play")}`;
  await $`cp -R ${join(from, "store", "site", "play")} ${join(applets, "store", "site")}`;
  // imports of ../vendor/pocketjs from inside vendor/applets resolve to the SDK's
  symlinkSync("..", join(applets, "vendor"));
  await $`cp -R ${join(ROOT, "sdk")} ${out}`;
  await $`chmod 755 ${join(out, "sdk", "pocket-applet.ts")}`;
  mkdirSync(join(out, "node_modules", "@pocketjs"), { recursive: true });
  symlinkSync("../../vendor/pocketjs", join(out, "node_modules", "@pocketjs", "framework"));
  for (const name of ["solid-js", "typescript", "opentype.js"]) symlinkSync(`../vendor/pocketjs/node_modules/${name}`, join(out, "node_modules", name));
  console.log(`sdk: ${out} ${(await $`du -sh ${out}`.text()).split("\t")[0]}`);
}

async function shot() {
  const script = option("--script");
  if (!script) throw new Error("shot needs --script");
  const dir = resolve(option("--out") ?? join(CACHE, "shots"));
  await profile();
  const targetDir = join(CACHE, "host", "native");
  // release: a debug build's native frames exhaust QuickJS's stack while the shell mounts
  await $`cargo build --release -p omarchy-pocket-host --target-dir ${targetDir}`.cwd(ROOT).env({ ...process.env, POCKETJS_PROFILE_RS: PROFILE_RS });
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await $`${join(targetDir, "release", "omarchy-pocket-host")} --package ${OUTPUTS.shell} --shot ${dir} --script ${script}`;
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

/** Voice input: sherpa-onnx's prebuilt runtime, the small Paraformer model and
 *  pocket-asr, which links them. Downloads stay in .cache/asr. */
const SHERPA = "v2.0.1";
const ASR_MODEL = "sherpa-onnx-paraformer-zh-small-2024-03-09";
async function asr() {
  const dir = join(CACHE, "asr");
  const runtime = `sherpa-onnx-${SHERPA}-linux-aarch64-shared-cpu`;
  mkdirSync(join(dir, "include"), { recursive: true });
  const fetch = async (name: string, url: string) => {
    if (existsSync(join(dir, name))) return;
    await $`curl -sSLf -o ${join(dir, `${name}.tar.bz2`)} ${url}`;
    await $`tar xjf ${join(dir, `${name}.tar.bz2`)} -C ${dir}`;
  };
  await fetch(runtime, `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA}/${runtime}.tar.bz2`);
  await fetch(ASR_MODEL, `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ASR_MODEL}.tar.bz2`);
  const header = join(dir, "include", "c-api.h");
  if (!existsSync(header)) await $`curl -sSLf -o ${header} https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/${SHERPA}/sherpa-onnx/c-api/c-api.h`;
  const out = join(dir, "out");
  mkdirSync(join(out, "lib"), { recursive: true });
  mkdirSync(join(out, "model"), { recursive: true });
  await $`zig cc -target aarch64-linux-gnu.2.28 -O2 -I${join(dir, "include")} ${join(ROOT, "daemon", "asr", "pocket-asr.c")} -L${join(dir, runtime, "lib")} -lsherpa-onnx-c-api -o ${join(out, "pocket-asr")}`;
  for (const lib of ["libonnxruntime.so", "libsherpa-onnx-c-api.so"]) await $`cp ${join(dir, runtime, "lib", lib)} ${join(out, "lib", lib)}`;
  for (const file of ["model.int8.onnx", "tokens.txt"]) await $`cp ${join(dir, ASR_MODEL, file)} ${join(out, "model", file)}`;
  console.log(`asr: ${out}`);
}

if (import.meta.main) {
  switch (argv[0]) {
    case "asr":
      await asr();
      break;
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
    case "spotify":
      await spotify();
      break;
    case "applets":
      await applets(process.argv.slice(3));
      break;
    case "sdk":
      await sdk();
      break;
    case "all":
      await host();
      await shell();
      await daemon();
      await spotify();
      await applets([]);
      break;
    case "shot":
      await shot();
      break;
    default:
      console.error("usage: bun tools/build.ts libs <ssh-host> | host | shell | daemon | spotify | applets | all | shot --script <events> [--out <dir>]");
      process.exit(2);
  }
}
