#!/usr/bin/env bun
// Omarchy Pocket for the Android handhelds, as one Android app (android/):
// the AYN Thor and the Retroid Pocket Duo Lite (HANDHELDS). The app carries a
// shell package and applets for each, and chooses by the device it runs on.
//
//   bun tools/android.ts lib        libomarchy_pocket.so (host/ for aarch64-linux-android), every handheld's profile in it
//   bun tools/android.ts shell      the shell package for each handheld's profile (android/handhelds/<id>/pocket.host.json)
//   bun tools/android.ts applets    the applets for each handheld's profile
//   bun tools/android.ts proot      proot, its talloc and its loader from Termux's packages (pinned)
//   bun tools/android.ts daemon     omarchy-pocketd and its shims, which the app installs into its root
//   bun tools/android.ts apk        the app, with what the steps above built [--debug]
//   bun tools/android.ts install    adb install the app and start it [--debug]
//   bun tools/android.ts rootfs [--from <rgds-root.tar.zst>]
//                                   the app's Linux root, from the RG DS Plus image
//                                   (image/build-root.ts) without what only that device uses
//   bun tools/android.ts push-rootfs   adb push the root where the app installs it from
//   bun tools/android.ts exec <command>  run a command in the app's root as the Omarchy user,
//                                   through run-as (a debuggable build: apk --debug), as SSH
//                                   reaches the RG DS Plus
//   bun tools/android.ts all        lib, proot, daemon, shell, applets, apk, install
//   bun tools/android.ts release    lib, proot, daemon, shell, applets, apk, rootfs, then the
//                                   release's files in dist/android/<version>/: the APK
//                                   signed with the release key, the root, SHA256SUMS
//
// `shell` and `applets` take --handheld <id> to build one handheld's. adb
// reaches the device ANDROID_SERIAL names when more than one is attached.
//
// Outputs:
//   android/app/src/main/jniLibs/arm64-v8a/libomarchy_pocket.so   (ignored)
//   android/app/src/main/assets/handhelds/<id>/omarchy-pocket.pocket     (ignored)
//   android/app/src/main/assets/handhelds/<id>/applets/<name>.pocket     (ignored)
//   android/app/src/main/jniLibs/arm64-v8a/libproot.so, libproot-loader.so, libtalloc.so, libandroid-shmem.so (ignored)
//   android/app/src/main/assets/linux/                            (ignored: omarchy-pocketd.js, ghostty-vt.wasm, shim.js)
//   android/app/build/outputs/apk/release/app-release.apk
//   .cache/android/omarchy-pocket-root.tar.zst
//   dist/android/<version>/omarchy-pocket-<version>.apk, omarchy-pocket-root.tar.zst, SHA256SUMS
//
// Needs the Android SDK and NDK (ANDROID_HOME, ANDROID_NDK_HOME or their
// Homebrew places), cargo-ndk, the aarch64-linux-android Rust target and
// libclang (rquickjs's bindings for Android come from bindgen).
import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const POCKETJS = join(ROOT, "vendor", "pocketjs");
const CACHE = join(ROOT, ".cache", "android");
const APP = join(ROOT, "android", "app");
const TARGET = "aarch64-linux-android";
const JNI = join(APP, "src", "main", "jniLibs", "arm64-v8a");
const ASSETS = join(APP, "src", "main", "assets");
const DEBUG = process.argv.includes("--debug");

/** The handhelds the app runs on, by profile id: each has its host profile
 *  in android/handhelds/<id>/ (pocket.host.json and the pocket.host.config.ts
 *  `pocket compile` reads), and the app's Handheld.java names the same ids. */
export const HANDHELDS = ["ayn-thor", "retroid-pocket-duo-lite"] as const;
export type HandheldId = (typeof HANDHELDS)[number];
/** Build.MODEL on each handheld, as android/app's Handheld.java matches it */
const MODELS: Record<string, HandheldId> = { "AYN Thor": "ayn-thor", "Retroid Pocket Duo Lite": "retroid-pocket-duo-lite" };
const handheldDir = (id: HandheldId) => join(ROOT, "android", "handhelds", id);
/** the host contract `pocket compile` reads, relative to the repository */
const config = (id: HandheldId) => `android/handhelds/${id}/pocket.host.config.ts`;
const hostProfile = (id: HandheldId) => JSON.parse(readFileSync(join(handheldDir(id), "pocket.host.json"), "utf8"));
const profileRs = (id: HandheldId) => join(CACHE, "profile", id, "pocket_profile.rs");
/** --handheld <id>: one handheld's shell or applets; every handheld's otherwise */
const chosen = ((): readonly HandheldId[] => {
  const at = process.argv.indexOf("--handheld");
  if (at < 0) return HANDHELDS;
  const id = process.argv[at + 1] as HandheldId;
  if (!HANDHELDS.includes(id)) throw new Error(`--handheld ${id}: not one of ${HANDHELDS.join(", ")}`);
  return [id];
})();

export const OUTPUTS = {
  lib: join(JNI, "libomarchy_pocket.so"),
  proot: join(JNI, "libproot.so"),
  linux: join(ASSETS, "linux"),
  rootfs: join(CACHE, "omarchy-pocket-root.tar.zst"),
  shell: (id: HandheldId) => join(ASSETS, "handhelds", id, "omarchy-pocket.pocket"),
  applets: (id: HandheldId) => join(ASSETS, "handhelds", id, "applets"),
  apk: DEBUG ? join(APP, "build", "outputs", "apk", "debug", "app-debug.apk") : join(APP, "build", "outputs", "apk", "release", "app-release.apk"),
};
export const PACKAGE = "dev.pocketnexus.omarchy";
/** Where the app looks for a root to install: its external files directory,
 *  which adb can write to without any permission. */
export const ROOTFS_ON_DEVICE = `/sdcard/Android/data/${PACKAGE}/files/omarchy-pocket-root.tar.zst`;

const HOMEBREW_SDK = "/opt/homebrew/share/android-commandlinetools";
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? HOMEBREW_SDK;
function ndk(): string {
  if (process.env.ANDROID_NDK_HOME) return process.env.ANDROID_NDK_HOME;
  const versions = existsSync(join(sdk, "ndk")) ? readdirSync(join(sdk, "ndk")).sort() : [];
  if (!versions.length) throw new Error(`no NDK under ${sdk}/ndk; set ANDROID_NDK_HOME`);
  return join(sdk, "ndk", versions.at(-1)!);
}
function libclang(): string {
  if (process.env.LIBCLANG_PATH) return process.env.LIBCLANG_PATH;
  for (const dir of ["/Library/Developer/CommandLineTools/usr/lib", "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib"]) {
    if (existsSync(join(dir, "libclang.dylib"))) return dir;
  }
  throw new Error("no libclang; set LIBCLANG_PATH");
}

/** Each handheld's profile, exported for the library (build.rs). */
async function profiles() {
  for (const id of HANDHELDS) {
    await $`bun ${join(POCKETJS, "tools", "pocket.ts")} host export --config ${config(id)} --out ${join(CACHE, "profile", id)}`.cwd(ROOT).quiet();
  }
}

async function lib() {
  await profiles();
  const home = ndk();
  const prebuilt = join(home, "toolchains", "llvm", "prebuilt");
  const sysroot = join(prebuilt, readdirSync(prebuilt)[0]!, "sysroot");
  await $`cargo ndk -t arm64-v8a --platform 29 build --release -p omarchy-pocket-host --lib --target-dir ${join(CACHE, "cargo")}`.cwd(ROOT).env({
    ...process.env,
    ANDROID_NDK_HOME: home,
    LIBCLANG_PATH: libclang(),
    BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android: `--sysroot=${sysroot} -I${join(sysroot, "usr", "include", TARGET)}`,
    OMARCHY_POCKET_PROFILES: HANDHELDS.map(profileRs).join(";"),
    POCKET_WORKER_CARGO_MANIFEST: join(ROOT, "Cargo.toml"),
  });
  mkdirSync(join(OUTPUTS.lib, ".."), { recursive: true });
  await $`cp ${join(CACHE, "cargo", TARGET, "release", "libomarchy_pocket.so")} ${OUTPUTS.lib}`;
  console.log(`lib: ${OUTPUTS.lib}`);
}

/** Termux's proot (termux/proot, GPL-2.0), the talloc it links and the
 *  loader it maps guest programs with, from Termux's aarch64 repository,
 *  pinned by sha256. Android extracts an app's lib*.so files into a
 *  directory it may execute from, so each goes in jniLibs under such a
 *  name; proot's NEEDED libtalloc.so.2 is rewritten in place to
 *  libtalloc.so (the app sets LD_LIBRARY_PATH to that directory). */
const TERMUX = "https://packages.termux.dev/apt/termux-main/pool/main";
const PROOT_PACKAGES = [
  { url: `${TERMUX}/p/proot/proot_5.1.107.102_aarch64.deb`, sha256: "10a394b585c2fc2b2c8502544f4e5f1be581dc8bfff79e8ba62f16207423e030", files: { "usr/bin/proot": "libproot.so", "usr/libexec/proot/loader": "libproot-loader.so" } },
  { url: `${TERMUX}/libt/libtalloc/libtalloc_2.5.0_aarch64.deb`, sha256: "556591f43bb773ad8777e1a29522640866a55f95dab71914418b94a8c58ad5a7", files: { "usr/lib/libtalloc.so.2.5.0": "libtalloc.so" } },
  { url: `${TERMUX}/liba/libandroid-shmem/libandroid-shmem_0.7_aarch64.deb`, sha256: "0da3a24d558b93c92bcf8d611e0826a99ff96e396b148e6cdf33b47c47c57ff6", files: { "usr/lib/libandroid-shmem.so": "libandroid-shmem.so" } },
];

async function proot() {
  const dir = join(CACHE, "termux");
  mkdirSync(JNI, { recursive: true });
  for (const pkg of PROOT_PACKAGES) {
    const deb = join(dir, pkg.url.split("/").pop()!);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(deb)) await $`curl --retry 3 -fsSL -o ${deb} ${pkg.url}`;
    const sum = new Bun.CryptoHasher("sha256").update(readFileSync(deb)).digest("hex");
    if (sum !== pkg.sha256) throw new Error(`${deb}: sha256 ${sum}, expected ${pkg.sha256}`);
    const out = join(dir, "x", pkg.url.split("/").pop()!.replace(/\.deb$/, ""));
    mkdirSync(out, { recursive: true });
    // bsdtar reads the deb's ar container, then its data member
    await $`tar xf ${deb} -C ${out} && tar xf ${join(out, "data.tar.xz")} -C ${out}`;
    for (const [from, to] of Object.entries(pkg.files)) {
      const bytes = readFileSync(join(out, "data", "data", "com.termux", "files", from));
      if (to === "libproot.so") {
        const needed = Buffer.from("libtalloc.so.2\0");
        const at = bytes.indexOf(needed);
        if (at < 0 || bytes.indexOf(needed, at + 1) >= 0) throw new Error("proot: expected one libtalloc.so.2 in its dynamic strings");
        Buffer.from("libtalloc.so\0\0\0").copy(bytes, at);
      }
      writeFileSync(join(JNI, to), bytes, { mode: 0o755 });
    }
  }
  console.log(`proot: ${OUTPUTS.proot}`);
}

/** omarchy-pocketd and its shims as tools/build.ts builds them, in the
 *  app's assets: the app installs them into its root at each update, so the
 *  daemon matches the app whatever root it runs in. */
async function daemon() {
  await $`bun ${join(ROOT, "tools", "build.ts")} daemon`.cwd(ROOT);
  mkdirSync(OUTPUTS.linux, { recursive: true });
  const built = join(ROOT, ".cache", "daemon");
  for (const name of ["omarchy-pocketd.js", "ghostty-vt.wasm", "shim.js"]) await $`cp ${join(built, name)} ${join(OUTPUTS.linux, name)}`;
  await $`cp ${join(ROOT, "android", "linux", "start.sh")} ${join(OUTPUTS.linux, "start.sh")}`;
  console.log(`daemon: ${OUTPUTS.linux}`);
}

/** What only the RG DS Plus uses: its GPU blob, the host program and the
 *  package it runs, its boot and device services, the RG DS Plus's applet
 *  builds (the app carries the handhelds'), voice input's model (proot reaches
 *  no microphone), and documentation. And the secret half of the pacman
 *  keyring's local master key, which pacman-key --init made when the image
 *  was built: a published root would give every device the same one.
 *  Signature checks need only the public keyring and trustdb, which stay;
 *  pacman-key --init makes a device its own key. */
const ROOTFS_EXCLUDE = [
  "./boot/*", "./usr/lib/mali", "./usr/bin/omarchy-pocket-host", "./usr/share/pocketjs", "./usr/lib/pocket-rgds",
  "./usr/share/omarchy-pocket/applets/*", "./usr/lib/omarchy-pocket/asr", "./usr/lib/modules", "./usr/lib/firmware",
  "./var/cache/pacman/pkg/*", "./usr/share/doc/*", "./usr/share/man/*", "./usr/share/info/*", "./usr/share/gtk-doc/*",
  "./etc/pacman.d/gnupg/private-keys-v1.d/*", "./etc/pacman.d/gnupg/openpgp-revocs.d/*", "./etc/pacman.d/gnupg/secring.gpg",
];

async function rootfs() {
  const from = (() => {
    const at = process.argv.indexOf("--from");
    if (at >= 0) return resolve(process.argv[at + 1]!);
    return join(ROOT, ".cache", "rgds-root.tar.zst");
  })();
  if (!existsSync(from)) throw new Error(`no ${from}; build it with image/build-root.ts or pass --from <rgds-root.tar.zst>`);
  mkdirSync(CACHE, { recursive: true });
  const partial = `${OUTPUTS.rootfs}.partial`;
  const excludes = ROOTFS_EXCLUDE.flatMap((p) => ["--exclude", p]);
  await $`zstd -dc < ${from} | bsdtar -c -f - ${excludes} @- | zstd -q -T0 -15 -o ${partial} -f`;
  // a pipe whose first stage failed still ends: a root is hundreds of MB
  if (Bun.file(partial).size < 64 * 1024 * 1024) throw new Error(`${partial}: ${Bun.file(partial).size} bytes; reading ${from} failed`);
  await $`mv ${partial} ${OUTPUTS.rootfs}`;
  console.log(`rootfs: ${OUTPUTS.rootfs}`);
}

async function pushRootfs() {
  if (!existsSync(OUTPUTS.rootfs)) throw new Error(`no ${OUTPUTS.rootfs}; run: bun tools/android.ts rootfs`);
  await $`adb shell mkdir -p ${ROOTFS_ON_DEVICE.slice(0, ROOTFS_ON_DEVICE.lastIndexOf("/"))}`;
  await $`adb push ${OUTPUTS.rootfs} ${ROOTFS_ON_DEVICE}.partial`;
  await $`adb shell mv ${ROOTFS_ON_DEVICE}.partial ${ROOTFS_ON_DEVICE}`;
  console.log(`rootfs: ${ROOTFS_ON_DEVICE}; the app installs it at its next start`);
}

/** The applets of pocket-nexus/applets (vendor/applets) for each handheld's
 *  host contract, into the app's assets; the app installs its handheld's into
 *  its root's /usr/share/omarchy-pocket/applets. A package is admitted on the
 *  profile it was compiled for, so each handheld has its own. They build
 *  from a copy of that tree in .cache/android/applets-src with two changes
 *  for density 3:
 *
 *  - each contract fixes its primary viewport at the 3DS's or the RG DS
 *    Plus's size; Omarchy Pocket shows an applet's touch surface only, so
 *    the copy names the handheld's stage (640 x 360 on both);
 *  - a package texture is at most 512 texels a side (TEX_MAX_DIM), so an SVG
 *    may be 170 points wide at density 3: the kit's 256 x 64 pinstripes
 *    (ui/art/stripes.svg) bake from a 170 x 42 raster of the same viewBox.
 *
 *  The Store and Spotify stay omarchy-pocket's (vendor/applets ONLY): the
 *  Store installs the RG DS Plus's variants, Spotify's speaker plays into
 *  PipeWire. An applet whose pak passes the applet rules' 3 MiB budget at
 *  density 3 is left out (GitHub and Weather, 4.2 and 4.4 MB). */
async function applets(names: string[]) {
  process.env.POCKETJS_ROOT = POCKETJS;
  const { ROOT: APPLETS } = await import("../vendor/applets/tools/paths.ts");
  const source = join(CACHE, "applets-src");
  await $`rsync -a --delete --exclude dist --exclude .pocket --exclude node_modules ${APPLETS}/ ${source}/`;
  // node_modules holds links relative to the submodule: the copy reaches it there
  rmSync(join(source, "node_modules"), { force: true, recursive: true });
  await $`ln -s ${join(APPLETS, "node_modules")} ${join(source, "node_modules")}`;
  const stripes = join(source, "ui", "art", "stripes.svg");
  if (existsSync(stripes)) writeFileSync(stripes, readFileSync(stripes, "utf8").replace('<svg width="256" height="64"', '<svg width="170" height="42"'));
  for (const id of chosen) await appletsFor(id, names, source);
}

async function appletsFor(id: HandheldId, names: string[], source: string) {
  const { APPS, ONLY, appContract } = await import("../vendor/applets/tools/apps.ts");
  const { VENDOR } = await import("../vendor/applets/tools/paths.ts");
  const host = hostProfile(id);
  const out = join(CACHE, "applets", id);
  if (!names.length) rmSync(OUTPUTS.applets(id), { recursive: true, force: true });
  mkdirSync(OUTPUTS.applets(id), { recursive: true });
  const failed: string[] = [];
  for (const name of names.length ? names : APPS) {
    if (ONLY[name]) {
      console.log(`applet: ${id}: ${name} left out: ${ONLY[name].because}`);
      continue;
    }
    const contract = JSON.parse(readFileSync(appContract(name), "utf8"));
    if (contract.app?.viewport?.fixed) contract.app.viewport.fixed.logical = [host.display.logicalViewports[0]];
    const manifest = join(source, name, "pocket.app.json");
    writeFileSync(manifest, JSON.stringify(contract, null, 2));
    const output = join(out, `${name}.pocket`);
    const result = await $`bun ${join(VENDOR, "tools", "pocket.ts")} compile --manifest ${manifest} --project-root ${source} --host-config ${join(ROOT, config(id))} --outdir ${join(out, "build", name)} --plan-dir ${join(out, "plans", name)} --output ${output}`
      .cwd(source).env({ ...process.env, POCKETJS_FRAMEWORK_ROOT: VENDOR }).quiet().nothrow();
    if (result.exitCode !== 0) {
      const text = `${result.stdout}${result.stderr}`;
      // a capability the handheld lacks, or the applet rules' 3 MiB pak
      // budget, which density 3's atlases pass (GitHub, Weather): left out
      const refusal = /(missing required capabilit[^\n]*|does not (?:provide|admit)[^\n]*|the pak is \d+ bytes; the budget is \d+)/i.exec(text);
      if (refusal) console.log(`applet: ${id}: ${name} left out: ${refusal[1]}`);
      else {
        failed.push(name);
        console.error(`${name}: ${text.split("\n").filter((l) => /error|Error/.test(l)).slice(0, 6).join("\n") || text.slice(-800)}`);
      }
      continue;
    }
    await $`cp ${output} ${join(OUTPUTS.applets(id), `${name}.pocket`)}`;
    console.log(`applet: ${id}: ${name}`);
  }
  if (failed.length) throw new Error(`${id}: applets that did not compile: ${failed.join(" ")}`);
}

/** The command line the app's LinuxService runs (Linux.java command()),
 *  around `command`: run-as gives it the app's uid and SELinux domain. */
async function exec(command: string) {
  const dump = await $`adb shell pm dump ${PACKAGE}`.text();
  const lib = /legacyNativeLibraryDir=(\S+)/.exec(dump)?.[1];
  if (!lib) throw new Error(`${PACKAGE} is not installed`);
  const libs = `${lib}/arm64`;
  const root = `/data/user/0/${PACKAGE}/files/linux/rootfs`;
  const passwd = await $`adb shell run-as ${PACKAGE} cat ${root}/etc/passwd`.text();
  const [uid, gid] = /^omarchy:[^:]*:(\d+):(\d+):/m.exec(passwd)?.slice(1) ?? ["1000", "1000"];
  const model = (await $`adb shell getprop ro.product.model`.text()).trim();
  const handheld = MODELS[model] ?? "ayn-thor";
  const env = ["HOME=/home/omarchy", "USER=omarchy", "LOGNAME=omarchy", "SHELL=/bin/bash", "TERM=xterm-256color", "LANG=C.UTF-8", "PATH=/usr/local/bin:/usr/bin:/bin", `XDG_RUNTIME_DIR=/run/user/${uid}`, "TMPDIR=/tmp", "OMARCHY_POCKET_PLATFORM=android", "OMARCHY_POCKET_DENSITY=3", `OMARCHY_POCKET_HANDHELD=${handheld}`];
  const inner = `LD_LIBRARY_PATH=${libs} PROOT_LOADER=${libs}/libproot-loader.so PROOT_TMP_DIR=/data/user/0/${PACKAGE}/cache/proot ${libs}/libproot.so -i ${uid}:${gid} -r ${root} -b /dev -b /proc -b /sys -b ${root}/tmp:/dev/shm -w /home/omarchy /usr/bin/env -i ${env.join(" ")} /usr/bin/bash -lc ${shellQuote(command)}`;
  const result = await $`adb shell run-as ${PACKAGE} sh -c ${shellQuote(inner)}`.nothrow();
  process.exit(result.exitCode);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** shell/pocket.app.json with a handheld's surfaces: the manifest names the
 *  logical sizes the package is laid out for, and the shell reads them at
 *  run time (shell/src/screen.ts). */
function manifest(id: HandheldId): string {
  const host = hostProfile(id);
  const app = JSON.parse(readFileSync(join(ROOT, "shell", "pocket.app.json"), "utf8"));
  app.app.viewport.fixed.logical = host.display.logicalViewports[0];
  app.app.surfaces.auxiliary.fixed.logical = host.display.auxiliary.logicalViewports[0];
  const path = join(ROOT, "shell", `.pocket.app.${id}.json`);
  writeFileSync(path, JSON.stringify(app, null, 2) + "\n");
  return path;
}

async function shell() {
  if (!existsSync(join(ROOT, "shell", "src", "generated", "menu.ts"))) throw new Error("no generated menu; run: bun tools/omarchy-assets.ts");
  // the shell imports solid-js from the project root, where the compiler resolves
  // it; the copy is PocketJS's own (vendor/pocketjs, after its bun install)
  const solid = join(ROOT, "node_modules", "solid-js");
  if (!existsSync(join(POCKETJS, "node_modules", "solid-js"))) throw new Error("no solid-js in vendor/pocketjs; run bun install there");
  if (!existsSync(solid)) {
    mkdirSync(join(ROOT, "node_modules"), { recursive: true });
    symlinkSync(join("..", "vendor", "pocketjs", "node_modules", "solid-js"), solid);
  }
  for (const id of chosen) {
    const path = manifest(id);
    mkdirSync(join(OUTPUTS.shell(id), ".."), { recursive: true });
    await $`bun ${join(POCKETJS, "tools", "pocket.ts")} compile --manifest ${path} --project-root . --host-config ${config(id)} --plan-dir ${join(CACHE, "shell", id, "plan")} --output ${OUTPUTS.shell(id)}`.cwd(ROOT);
    console.log(`shell: ${OUTPUTS.shell(id)}`);
  }
}

async function apk() {
  if (!existsSync(OUTPUTS.lib)) throw new Error(`no ${OUTPUTS.lib}; run: bun tools/android.ts lib`);
  for (const id of HANDHELDS) {
    if (!existsSync(OUTPUTS.shell(id))) throw new Error(`no ${OUTPUTS.shell(id)}; run: bun tools/android.ts shell`);
    if (!existsSync(OUTPUTS.applets(id))) throw new Error(`no ${OUTPUTS.applets(id)}; run: bun tools/android.ts applets`);
  }
  // the single handheld's places before the app carried several
  rmSync(join(ASSETS, "omarchy-pocket.pocket"), { force: true });
  rmSync(join(ASSETS, "applets"), { recursive: true, force: true });
  if (!existsSync(OUTPUTS.proot)) throw new Error(`no ${OUTPUTS.proot}; run: bun tools/android.ts proot`);
  if (!existsSync(join(OUTPUTS.linux, "omarchy-pocketd.js"))) throw new Error(`no daemon in ${OUTPUTS.linux}; run: bun tools/android.ts daemon`);
  await $`./gradlew --quiet ${DEBUG ? "assembleDebug" : "assembleRelease"}`.cwd(join(ROOT, "android")).env({ ...process.env, ANDROID_HOME: sdk });
  console.log(`apk: ${OUTPUTS.apk}`);
}

/** The release key's properties file (android/app/build.gradle.kts reads the same one). */
const SIGNING = process.env.OMARCHY_POCKET_SIGNING ?? join(process.env.HOME ?? "", ".config", "omarchy-pocket", "signing.properties");

/** The SHA-256 of the certificate that signs an APK, from apksigner. */
async function signer(apk: string): Promise<string> {
  const tools = join(sdk, "build-tools");
  const version = readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const out = await $`${join(tools, version!, "apksigner")} verify --print-certs ${apk}`.text();
  const digest = out.match(/certificate SHA-256 digest: ([0-9a-f]{64})/)?.[1];
  if (!digest) throw new Error(`apksigner printed no certificate for ${apk}`);
  return digest;
}

/** A release's files: every step from source, the APK signed with the release
 *  key, the root, and their SHA-256 sums, in dist/android/<version>/. The
 *  version is the app's versionName. */
async function release() {
  if (DEBUG) throw new Error("a release is the release build; drop --debug");
  if (!existsSync(SIGNING)) throw new Error(`no ${SIGNING}: the release key's properties (storeFile, storePassword, keyAlias, keyPassword)`);
  const gradle = readFileSync(join(APP, "build.gradle.kts"), "utf8");
  const version = gradle.match(/versionName = "([^"]+)"/)?.[1];
  if (!version) throw new Error("no versionName in android/app/build.gradle.kts");
  await lib();
  await proot();
  await daemon();
  await shell();
  await applets([]);
  await apk();
  await rootfs();
  const debugKey = join(process.env.HOME ?? "", ".android", "debug.keystore");
  const cert = await signer(OUTPUTS.apk);
  if (existsSync(debugKey)) {
    const debugCert = (await $`keytool -exportcert -keystore ${debugKey} -alias androiddebugkey -storepass android`.arrayBuffer());
    const digest = new Bun.CryptoHasher("sha256").update(new Uint8Array(debugCert)).digest("hex");
    if (digest === cert) throw new Error("the APK is signed with the debug key; check the release key's properties");
  }
  const out = join(ROOT, "dist", "android", version);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = [`omarchy-pocket-${version}.apk`, "omarchy-pocket-root.tar.zst"];
  await $`cp ${OUTPUTS.apk} ${join(out, files[0]!)}`;
  await $`cp ${OUTPUTS.rootfs} ${join(out, files[1]!)}`;
  await $`shasum -a 256 ${files} > SHA256SUMS`.cwd(out);
  console.log(`release ${version}: ${out}`);
  console.log(`  signer certificate SHA-256: ${cert}`);
  console.log((await $`cat SHA256SUMS`.cwd(out).text()).trimEnd());
}

async function install() {
  await $`adb install -r ${OUTPUTS.apk}`;
  await $`adb shell am start -n ${PACKAGE}/.MainActivity`;
}

const [command] = process.argv.slice(2);
switch (command) {
  case "lib": await lib(); break;
  case "proot": await proot(); break;
  case "daemon": await daemon(); break;
  case "shell": await shell(); break;
  case "applets": await applets(process.argv.slice(3).filter((a) => !a.startsWith("--"))); break;
  case "apk": await apk(); break;
  case "install": await install(); break;
  case "rootfs": await rootfs(); break;
  case "push-rootfs": await pushRootfs(); break;
  case "release": await release(); break;
  case "exec": await exec(process.argv.slice(3).filter((a) => a !== "--debug").join(" ")); break;
  case "all":
    await lib();
    await proot();
    await daemon();
    await shell();
    await applets([]);
    await apk();
    await install();
    break;
  default:
    console.error("usage: bun tools/android.ts lib|proot|daemon|shell|applets|apk|install|rootfs|push-rootfs|exec|all|release [--debug]");
    process.exit(2);
}
