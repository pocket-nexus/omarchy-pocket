#!/usr/bin/env bun
// Omarchy Pocket on the ClockworkPi uConsole (Raspberry Pi CM4) over its
// Raspberry Pi OS (Debian), as one Debian package, omarchy-pocket-uconsole
// (docs/clockwork-uconsole.md):
//
//   bun tools/uconsole.ts libs <ssh-host>    Mesa's libEGL, libGLESv2 and libgbm from the device, for the linker
//   bun tools/uconsole.ts host               omarchy-pocket-host for the uConsole's profile (feature mesa)
//   bun tools/uconsole.ts shell              the shell package for the uConsole's profile (uconsole/pocket.host.json)
//   bun tools/uconsole.ts applets [names]    the applets for the uConsole's profile
//   bun tools/uconsole.ts deb                the package, from what the steps above and `bun tools/build.ts
//                                            daemon` built: dist/uconsole/<version>/omarchy-pocket-uconsole_<version>_arm64.deb
//   bun tools/uconsole.ts install <ssh-host> [--root <omarchy-pocket-root.tar.zst>]
//                                            the package on the device (apt), and the root from the archive
//                                            given instead of the release's download
//   bun tools/uconsole.ts push <ssh-host> [host] [shell] [daemon] [applets] [files]
//                                            what changed, into the installed package's places, and restart
//                                            (a build from source between packages; all parts when none are named)
//   bun tools/uconsole.ts session <ssh-host> on|off|boot|desktop|status
//                                            omarchy-pocket-session on the device: the shell or the Raspberry
//                                            Pi desktop, now or at every boot
//   bun tools/uconsole.ts exec <ssh-host> <command>   a command in Omarchy's root as the user
//   bun tools/uconsole.ts release            every step, then dist/uconsole/<version>/ with the package and SHA256SUMS
//   bun tools/uconsole.ts all <ssh-host>     libs, every step, the package, install
//
// The version and the root the package installs (its URL, SHA-256 and size)
// are uconsole/release.json's; the root is the AYN Thor's release root
// (`bun tools/android.ts rootfs`). The daemon and its shims are tools/build.ts's:
// one build serves every device.
import { $ } from "bun";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { OUTPUTS as BUILT, SHIM_NAMES } from "./build.ts";

const ROOT = resolve(import.meta.dir, "..");
const POCKETJS = join(ROOT, "vendor", "pocketjs");
const CACHE = join(ROOT, ".cache", "uconsole");
const CONFIG = "uconsole/pocket.host.config.ts";
const PROFILE_RS = join(CACHE, "profile", "pocket_profile.rs");
const LIBS = join(CACHE, "gl-libs");
const TARGET = "aarch64-unknown-linux-gnu";
const ROOTFS = join(ROOT, "uconsole", "rootfs");
const DEBIAN = join(ROOT, "uconsole", "debian");
const RELEASE = JSON.parse(readFileSync(join(ROOT, "uconsole", "release.json"), "utf8")) as { version: string; root: { url: string; sha256: string; bytes: number } };
const PACKAGE = "omarchy-pocket-uconsole";
/** what the package carries for Omarchy's root, which omarchy-root copies in at each start */
const OVERLAY = "/usr/lib/omarchy-pocket/overlay";
export const OUTPUTS = {
  host: join(CACHE, "cargo", TARGET, "release", "omarchy-pocket-host"),
  shell: join(CACHE, "omarchy-pocket.pocket"),
  applets: join(CACHE, "applets", "out"),
  dist: join(ROOT, "dist", "uconsole", RELEASE.version),
  deb: join(ROOT, "dist", "uconsole", RELEASE.version, `${PACKAGE}_${RELEASE.version}_arm64.deb`),
};

const ssh = (process.env.SSH_OPTS ?? "").split(" ").filter(Boolean);
const remote = (host: string, command: string) => $`ssh ${ssh} ${host} ${command}`;

async function libs(host: string) {
  mkdirSync(LIBS, { recursive: true });
  for (const [lib, link] of [["libEGL.so.1", "libEGL.so"], ["libGLESv2.so.2", "libGLESv2.so"], ["libgbm.so.1", "libgbm.so"]]) {
    const path = (await remote(host, `readlink -f /usr/lib/aarch64-linux-gnu/${lib}`).text()).trim();
    if (!path) throw new Error(`${host} has no ${lib}`);
    await $`scp -q ${ssh} ${host}:${path} ${join(LIBS, lib!)}`;
    rmSync(join(LIBS, link!), { force: true });
    await $`ln -s ${lib} ${join(LIBS, link!)}`;
  }
  console.log(`libs: ${LIBS}`);
}

async function profile() {
  await $`bun ${join(POCKETJS, "tools", "pocket.ts")} host export --config ${CONFIG} --out ${join(CACHE, "profile")}`.cwd(ROOT).quiet();
}

async function host() {
  if (!existsSync(join(LIBS, "libgbm.so"))) throw new Error(`no ${LIBS}; run: bun tools/uconsole.ts libs <ssh-host>`);
  await profile();
  await $`cargo zigbuild --release -p omarchy-pocket-host --bin omarchy-pocket-host --features mesa --target ${TARGET}.2.36 --target-dir ${join(CACHE, "cargo")}`
    .cwd(ROOT)
    .env({ ...process.env, POCKETJS_PROFILE_RS: PROFILE_RS, OMARCHY_POCKET_GL_LIBS: LIBS, POCKET_WORKER_CARGO_MANIFEST: join(ROOT, "Cargo.toml") });
  console.log(`host: ${OUTPUTS.host}`);
}

/** shell/pocket.app.json with the uConsole's surfaces: the stage, and the
 *  auxiliary surface no panel shows (the applets' touch surfaces' host). */
function manifest(): string {
  const host = JSON.parse(readFileSync(join(ROOT, "uconsole", "pocket.host.json"), "utf8"));
  const app = JSON.parse(readFileSync(join(ROOT, "shell", "pocket.app.json"), "utf8"));
  app.app.viewport.fixed.logical = host.display.logicalViewports[0];
  app.app.surfaces.auxiliary.fixed.logical = host.display.auxiliary.logicalViewports[0];
  // the keyboard's text events (host/src/uconsole.rs)
  app.engine.capabilities.enhances = [...new Set([...(app.engine.capabilities.enhances ?? []), "input.text"])];
  const path = join(ROOT, "shell", ".pocket.app.uconsole.json");
  writeFileSync(path, JSON.stringify(app, null, 2) + "\n");
  return path;
}

async function shell() {
  if (!existsSync(join(ROOT, "shell", "src", "generated", "menu.ts"))) throw new Error("no generated menu; run: bun tools/omarchy-assets.ts");
  mkdirSync(CACHE, { recursive: true });
  await $`bun ${join(POCKETJS, "tools", "pocket.ts")} compile --manifest ${manifest()} --project-root . --host-config ${CONFIG} --plan-dir ${join(CACHE, "shell-plan")} --output ${OUTPUTS.shell}`.cwd(ROOT);
  console.log(`shell: ${OUTPUTS.shell}`);
}

/** The applets of pocket-nexus/applets for the uConsole's host contract, as
 *  tools/android.ts builds the Thor's: from a copy of vendor/applets whose
 *  contracts name the uConsole's stage (Omarchy Pocket shows an applet's
 *  touch surface only, in a window). The Store and Spotify stay
 *  omarchy-pocket's (vendor/applets ONLY). */
async function applets(names: string[]) {
  process.env.POCKETJS_ROOT = POCKETJS;
  const { APPS, ONLY, appContract } = await import("../vendor/applets/tools/apps.ts");
  const { ROOT: APPLETS, VENDOR } = await import("../vendor/applets/tools/paths.ts");
  const host = JSON.parse(readFileSync(join(ROOT, "uconsole", "pocket.host.json"), "utf8"));
  const out = join(CACHE, "applets");
  const source = join(out, "src");
  mkdirSync(out, { recursive: true });
  await $`rsync -a --delete --exclude dist --exclude .pocket --exclude node_modules ${APPLETS}/ ${source}/`;
  rmSync(join(source, "node_modules"), { force: true, recursive: true });
  await $`ln -s ${join(APPLETS, "node_modules")} ${join(source, "node_modules")}`;
  mkdirSync(OUTPUTS.applets, { recursive: true });
  const failed: string[] = [];
  for (const name of names.length ? names : APPS) {
    if (ONLY[name]) {
      console.log(`applet: ${name} left out: ${ONLY[name].because}`);
      continue;
    }
    const contract = JSON.parse(readFileSync(appContract(name), "utf8"));
    if (contract.app?.viewport?.fixed) contract.app.viewport.fixed.logical = [host.display.logicalViewports[0]];
    const manifest = join(source, name, "pocket.app.json");
    writeFileSync(manifest, JSON.stringify(contract, null, 2));
    const output = join(OUTPUTS.applets, `${name === "appstore" ? "store" : name}.pocket`);
    const result = await $`bun ${join(VENDOR, "tools", "pocket.ts")} compile --manifest ${manifest} --project-root ${source} --host-config ${join(ROOT, CONFIG)} --outdir ${join(out, "build", name)} --plan-dir ${join(out, "plans", name)} --output ${output}`
      .cwd(source).env({ ...process.env, POCKETJS_FRAMEWORK_ROOT: VENDOR }).quiet().nothrow();
    if (result.exitCode !== 0) {
      const text = `${result.stdout}${result.stderr}`;
      const refusal = /(missing required capabilit[^\n]*|does not (?:provide|admit)[^\n]*|the pak is \d+ bytes; the budget is \d+)/i.exec(text);
      if (refusal) console.log(`applet: ${name} left out: ${refusal[1]}`);
      else {
        failed.push(name);
        console.error(`${name}: ${text.split("\n").filter((l) => /error|Error/.test(l)).slice(0, 6).join("\n") || text.slice(-800)}`);
      }
      continue;
    }
    console.log(`applet: ${name}`);
  }
  if (failed.length) throw new Error(`applets that did not compile: ${failed.join(" ")}`);
}

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, base) : [relative(base, path)];
  });
}

const PARTS = ["host", "shell", "daemon", "applets", "files"] as const;
type Part = (typeof PARTS)[number];

/** The package's files under `stage`, as they install: the parts named. */
function stage(dir: string, parts: Set<Part>) {
  const put = (from: string, to: string, mode: number) => {
    if (!existsSync(from)) throw new Error(`${from} is missing; build it first`);
    mkdirSync(join(dir, to, ".."), { recursive: true });
    cpSync(from, join(dir, to));
    chmodSync(join(dir, to), mode);
  };
  if (parts.has("host")) put(OUTPUTS.host, "usr/bin/omarchy-pocket-host", 0o755);
  if (parts.has("shell")) put(OUTPUTS.shell, "usr/share/pocketjs/omarchy-pocket.pocket", 0o644);
  if (parts.has("daemon")) {
    put(BUILT.daemon, `${OVERLAY}/usr/lib/omarchy-pocket/omarchy-pocketd.js`, 0o644);
    put(BUILT.wasm, `${OVERLAY}/usr/lib/omarchy-pocket/ghostty-vt.wasm`, 0o644);
    for (const name of SHIM_NAMES) put(BUILT.shim, `${OVERLAY}/usr/local/bin/${name}`, 0o755);
  }
  if (parts.has("applets")) {
    const built = existsSync(OUTPUTS.applets) ? readdirSync(OUTPUTS.applets).filter((f) => f.endsWith(".pocket")) : [];
    if (!built.length) throw new Error(`no applets in ${OUTPUTS.applets}; run: bun tools/uconsole.ts applets`);
    for (const file of built) put(join(OUTPUTS.applets, file), `${OVERLAY}/usr/share/omarchy-pocket/applets/${file}`, 0o644);
  }
  if (parts.has("files")) {
    for (const file of files(ROOTFS)) put(join(ROOTFS, file), file, statSync(join(ROOTFS, file)).mode & 0o777);
    mkdirSync(join(dir, "usr/lib/omarchy-pocket"), { recursive: true });
    writeFileSync(
      join(dir, "usr/lib/omarchy-pocket/root.conf"),
      `# the root this package installs (omarchy-root install): the release's\nROOT_URL=${RELEASE.root.url}\nROOT_SHA256=${RELEASE.root.sha256}\nROOT_BYTES=${RELEASE.root.bytes}\n`,
    );
    put(join(DEBIAN, "copyright"), `usr/share/doc/${PACKAGE}/copyright`, 0o644);
  }
}

async function deb() {
  const dir = join(CACHE, "deb", `${PACKAGE}_${RELEASE.version}_arm64`);
  rmSync(dir, { recursive: true, force: true });
  stage(dir, new Set(PARTS));
  mkdirSync(join(dir, "DEBIAN"), { recursive: true });
  const kib = Math.ceil(Number((await $`du -sk ${dir}`.text()).split(/\s/)[0]));
  writeFileSync(join(dir, "DEBIAN", "control"), readFileSync(join(DEBIAN, "control.in"), "utf8").replace("@VERSION@", RELEASE.version).replace("@SIZE@", String(kib)));
  for (const script of ["postinst", "prerm", "postrm"]) {
    cpSync(join(DEBIAN, script), join(dir, "DEBIAN", script));
    await $`chmod 755 ${join(dir, "DEBIAN", script)}`;
  }
  cpSync(join(DEBIAN, "conffiles"), join(dir, "DEBIAN", "conffiles"));
  // the tree's modes, not the umask's; root owns everything
  await $`find ${dir} -type d -exec chmod 755 {} +`;
  mkdirSync(OUTPUTS.dist, { recursive: true });
  await $`COPYFILE_DISABLE=1 dpkg-deb --root-owner-group -Zxz --build ${dir} ${OUTPUTS.deb}`.quiet();
  console.log(`deb: ${OUTPUTS.deb} (${(statSync(OUTPUTS.deb).size / 1048576).toFixed(1)} MiB)`);
}

async function install(host: string, root?: string) {
  if (!existsSync(OUTPUTS.deb)) throw new Error(`${OUTPUTS.deb} is missing; run: bun tools/uconsole.ts deb`);
  if (root) {
    await remote(host, "sudo install -d -m 755 /var/cache/omarchy-pocket && sudo chown $(id -u) /var/cache/omarchy-pocket");
    await $`scp -q ${ssh} ${root} ${host}:/var/cache/omarchy-pocket/omarchy-pocket-root.tar.zst`;
  }
  await $`scp -q ${ssh} ${OUTPUTS.deb} ${host}:/tmp/${basename(OUTPUTS.deb)}`;
  await remote(host, `sudo apt-get install -y --reinstall /tmp/${basename(OUTPUTS.deb)} && rm -f /tmp/${basename(OUTPUTS.deb)}`);
}

/** A build from source into the installed package's places: what changed,
 *  then the services restart (the daemon copies the overlay into the root). */
async function push(host: string, named: string[]) {
  if (named.some((p) => !PARTS.includes(p as Part))) throw new Error(`parts: ${PARTS.join(" ")}`);
  const parts = new Set<Part>(named.length ? (named as Part[]) : [...PARTS]);
  const dir = join(CACHE, "push");
  rmSync(dir, { recursive: true, force: true });
  stage(dir, parts);
  const list = files(dir);
  console.log(list.map((f) => `  /${f}`).join("\n"));
  const after = ["systemctl daemon-reload"];
  if (parts.has("daemon") || parts.has("applets") || parts.has("files")) after.push("systemctl try-restart omarchy-pocketd.service");
  if (parts.has("host") || parts.has("shell") || parts.has("files")) after.push("systemctl try-restart omarchy-pocket.service");
  const command = ["sudo tar -C / --no-same-owner -xpf -", ...after.map((c) => `sudo ${c}`)].join(" && ");
  await $`cd ${dir} && COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --uid 0 --gid 0 -cf - ${list} | ssh ${ssh} ${host} ${command}`;
  console.log(`pushed ${[...parts].join(", ")} to ${host}`);
}

async function session(host: string, what: string) {
  if (!["on", "off", "boot", "desktop", "status"].includes(what)) throw new Error("session on|off|boot|desktop|status");
  await remote(host, `omarchy-pocket-session ${what}`);
}

async function build() {
  await host();
  await shell();
  await applets([]);
  await $`bun ${join(ROOT, "tools", "build.ts")} daemon`.cwd(ROOT);
}

const [command, ...rest] = process.argv.slice(2);
const needHost = () => {
  if (!rest[0]) throw new Error(`usage: bun tools/uconsole.ts ${command} <ssh-host> ...`);
  return rest[0];
};
switch (command) {
  case "libs":
    await libs(needHost());
    break;
  case "host":
    await host();
    break;
  case "shell":
    await shell();
    break;
  case "applets":
    await applets(rest);
    break;
  case "deb":
    await deb();
    break;
  case "install": {
    const at = rest.indexOf("--root");
    await install(needHost(), at >= 0 ? rest[at + 1] : undefined);
    break;
  }
  case "push":
    await push(needHost(), rest.slice(1));
    break;
  case "session":
    await session(needHost(), rest[1] ?? "");
    break;
  case "exec":
    await $`ssh ${ssh} -t ${needHost()} ${`sudo /usr/lib/omarchy-pocket/omarchy-root run ${JSON.stringify(rest.slice(1).join(" "))}`}`.nothrow();
    break;
  case "release": {
    await build();
    await deb();
    await $`shasum -a 256 ${basename(OUTPUTS.deb)} > SHA256SUMS`.cwd(OUTPUTS.dist);
    console.log(`release ${RELEASE.version}: ${OUTPUTS.dist}`);
    console.log((await $`cat SHA256SUMS`.cwd(OUTPUTS.dist).text()).trimEnd());
    break;
  }
  case "all": {
    const target = needHost();
    await libs(target);
    await build();
    await deb();
    await install(target);
    break;
  }
  default:
    console.error("usage: bun tools/uconsole.ts libs|host|shell|applets|deb|install|push|session|exec|release|all ...");
    process.exit(2);
}
