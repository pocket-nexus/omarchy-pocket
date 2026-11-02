#!/usr/bin/env bun
// pocket-applet: make applets on Omarchy Pocket itself. The SDK at
// /usr/share/omarchy-pocket/sdk holds the PocketJS compiler and, in
// vendor/applets, pocket-nexus/applets' kit, rules, template and examples;
// ~/Applets is laid out as that repository is, so an applet's `../ui` is the kit.
//
//   pocket-applet make              ask what to make, then start the coding agent on it
//   pocket-applet new <name> [--title T]
//   pocket-applet check <name>      the rules an applet is held to, with what to do instead
//   pocket-applet build <name>      check and compile
//   pocket-applet run <name>        check, compile, install and open it in a window
//   pocket-applet shot [name]       the two panels as <name>/shot.png
//   pocket-applet log               the host's and the daemon's last lines
//   pocket-applet tap <x> <y>       click at a place on the top panel, as read off a shot
//   pocket-applet scroll <x> <y> <dy>   two fingers at that place, dy px up
//   pocket-applet key <name>        Enter, Backspace (back), Up, ... to the focused window
//   pocket-applet type <text>       text to the focused window
//   pocket-applet mock <name>       pack its sample data (mock/mock.json): what the store's page runs it on
//   pocket-applet web <name> [--port 4310]   it in a browser on its sample data, as the store's page runs it
//   pocket-applet publish <name> [--author handle]   sign it and send it to the store, with its sample data
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { bakeSvg } from "../vendor/pocketjs/framework/compiler/bake-svg.ts";
import { encodePNG } from "../vendor/pocketjs/tools/png.ts";
import { checkApplet, printFindings } from "../vendor/applets/tools/check.ts";
import { packMock } from "../vendor/applets/tools/mock.ts";
import { servePlayer } from "../vendor/applets/store/play/serve.ts";
import { base64url, HANDLE, ICON_SIDE, packageFacts, sha256, signedMessage, SUMMARY_MAX } from "../vendor/applets/store/src/shared.ts";

const SDK = resolve(import.meta.dir, "..");
const HOME = homedir();
const WORK = join(HOME, "Applets");
const INSTALLED = join(HOME, ".local", "share", "omarchy-pocket", "applets");
const CONFIG = join(HOME, ".config", "omarchy-pocket");
const STORE = process.env.POCKET_APPLETS_STORE ?? "https://applets.pocket.nexus";
/** pocket-nexus/applets, as the SDK carries it */
const APPLETS = join(SDK, "vendor", "applets");
const TEMPLATE = join(APPLETS, "template");
const [W, H] = [1024, 768];

const fail = (message: string): never => {
  console.error(`pocket-applet: ${message}`);
  process.exit(1);
};
const argv = process.argv.slice(2);
const option = (name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const positional = () => argv.slice(1).find((arg, index, all) => !arg.startsWith("--") && !all[index - 1]?.startsWith("--"));

const NAME = /^[a-z][a-z0-9-]{0,30}$/;
const titleOf = (name: string) => name.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
const dirOf = (name: string) => join(WORK, name);

/** `path` as a link to `target`; a link of an older SDK's layout is pointed again. */
function link(target: string, path: string) {
  try {
    const found = lstatSync(path);
    if (!found.isSymbolicLink() || readlinkSync(path) === target) return;
    rmSync(path);
  } catch {}
  symlinkSync(target, path);
}

/** ~/Applets as the repository's applets are laid out, against the SDK. */
function workspace() {
  mkdirSync(WORK, { recursive: true });
  link(join(APPLETS, "ui"), join(WORK, "ui"));
  // lib/ holds the worker entry each applet declares; PocketJS's type check
  // writes its config beside an entry, so lib is this user's directory of
  // links to the SDK's files rather than a link to the read-only SDK
  const lib = join(WORK, "lib");
  if (lstatSync(lib, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(lib);
  mkdirSync(lib, { recursive: true });
  for (const file of readdirSync(join(APPLETS, "lib"))) link(join(APPLETS, "lib", file), join(lib, file));
  link(join(APPLETS, "kit"), join(WORK, "kit"));
  link(APPLETS, join(WORK, "examples"));
  link(join(SDK, "vendor"), join(WORK, "vendor"));
  link(join(SDK, "host"), join(WORK, "host"));
  link(join(SDK, "node_modules"), join(WORK, "node_modules"));
  copyFileSync(join(SDK, "sdk", "AGENTS.md"), join(WORK, "AGENTS.md"));
}

function publisher(): { handle: string } | null {
  try {
    return JSON.parse(readFileSync(join(CONFIG, "publisher.json"), "utf8"));
  } catch {
    return null;
  }
}

function create(name: string, title: string, summary: string) {
  if (!NAME.test(name)) fail("a name is lower-case letters, digits and dashes, starting with a letter");
  workspace();
  const dir = dirOf(name);
  if (existsSync(dir)) fail(`${dir} exists`);
  mkdirSync(dir);
  const fill = (text: string) => text.replaceAll("__TITLE__", title).replaceAll("__NAME__", name);
  for (const file of ["main.tsx", "app.tsx", "icon.svg"]) writeFileSync(join(dir, file), fill(readFileSync(join(TEMPLATE, file), "utf8")));
  symlinkSync("../ui/art", join(dir, "art"));
  symlinkSync("../ui/images.json", join(dir, "images.json"));
  symlinkSync("../AGENTS.md", join(dir, "AGENTS.md"));
  symlinkSync("../AGENTS.md", join(dir, "CLAUDE.md"));
  const id = `oma.${publisher()?.handle ?? "me"}.${name}`;
  const manifest = JSON.parse(fill(readFileSync(join(TEMPLATE, "pocket.app.template.json"), "utf8")).replaceAll("__ID__", id).replaceAll("__SUMMARY__", summary.replaceAll('"', "'")));
  writeFileSync(join(dir, "pocket.app.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, ".gitignore"), ".build/\nshot.png\n");
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  console.log(dir);
}

/** The rules, printed. An error stops a build; with `strict` so does a warning. */
function check(name: string, strict = false) {
  const dir = dirOf(name);
  if (!existsSync(join(dir, "pocket.app.json"))) fail(`no applet at ${dir}`);
  const findings = checkApplet(dir, TEMPLATE);
  printFindings(findings);
  if (findings.some((finding) => finding.level === "error" || strict)) fail(`${name} does not meet the rules: see ../kit/README.md`);
}

async function compile(name: string): Promise<string> {
  const dir = dirOf(name);
  if (!existsSync(join(dir, "pocket.app.json"))) fail(`no applet at ${dir}`);
  workspace();
  check(name);
  const out = join(name, ".build");
  const child = Bun.spawn(
    ["bun", join("vendor", "pocketjs", "tools", "pocket.ts"), "compile", "--manifest", join(name, "pocket.app.json"), "--project-root", ".", "--host-config", join("host", "pocket.host.config.ts"),
      "--plan-dir", join(out, "plan"), "--outdir", join(out, "out"), "--output", join(out, `${name}.pocket`)],
    { cwd: WORK, stdout: "pipe", stderr: "pipe", env: { ...process.env, POCKETJS_FRAMEWORK_ROOT: join(WORK, "vendor", "pocketjs") } },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  // the baker's image and font lines say nothing when all is well
  const noise = /^\s+(image|font|tailwind|pak|pass \d|applet):|^PocketJS build|^✓ ResolvedBuildPlan/;
  const lines = `${stdout}${stderr}`.split("\n").filter((line) => line.trim() && (code !== 0 ? !/^\s+image: art\//.test(line) : !noise.test(line)));
  if (lines.length) console.log(lines.join("\n"));
  if (code !== 0) fail(`${name} did not compile`);
  return join(dir, ".build", `${name}.pocket`);
}

async function run(name: string) {
  const built = await compile(name);
  mkdirSync(INSTALLED, { recursive: true });
  const installed = join(INSTALLED, `${name}.pocket`);
  copyFileSync(built, installed);
  const title = JSON.parse(readFileSync(join(dirOf(name), "pocket.app.json"), "utf8")).title as string;
  const opened = Bun.spawnSync(["omarchy-shell", "pocket.window", "app", installed, title, "applet"], { stdout: "pipe", stderr: "pipe" });
  if (opened.exitCode !== 0) {
    // the shell answers late while it loads a package: the window says whether it opened
    await Bun.sleep(2000);
    const windows = Bun.spawnSync(["omarchy-shell", "pocket.window", "list"], { stdout: "pipe", stderr: "pipe" });
    if (!windows.stdout.toString().includes(title)) fail(`the shell did not open it: ${opened.stderr.toString().trim()}`);
  }
  console.log(`running ${installed}`);
}

async function shot(name?: string) {
  for (const panel of [0, 1]) rmSync(`/tmp/pocket-shot-${panel}.rgba`, { force: true });
  writeFileSync("/tmp/pocket-shot", "");
  const size = W * H * 4;
  for (let i = 0; i < 80; i++) {
    const ready = [0, 1].every((panel) => {
      const file = Bun.file(`/tmp/pocket-shot-${panel}.rgba`);
      return file.size === size;
    });
    if (ready) break;
    await Bun.sleep(100);
  }
  const rgba = new Uint8Array(W * H * 2 * 4);
  for (const panel of [0, 1]) {
    const path = `/tmp/pocket-shot-${panel}.rgba`;
    if (!existsSync(path)) fail("the host did not answer: is the shell running?");
    const raw = readFileSync(path);
    for (let y = 0; y < H; y++) {
      const from = (H - 1 - y) * W * 4;
      rgba.set(raw.subarray(from, from + W * 4), (panel * H + y) * W * 4);
    }
  }
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const out = name ? join(dirOf(name), "shot.png") : join(process.cwd(), "shot.png");
  writeFileSync(out, encodePNG(rgba, W, H * 2));
  console.log(out);
}

const input = (...args: string[]) => {
  const done = Bun.spawnSync(["omarchy-shell", "pocket.input", ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) fail(`the shell did not take it: ${done.stderr.toString().trim()}`);
};

function log() {
  const show = (args: string[]) => {
    const child = Bun.spawnSync(["journalctl", "--no-pager", "-o", "cat", ...args], { stdout: "pipe", stderr: "pipe" });
    console.log(child.stdout.toString().trim() || child.stderr.toString().trim());
  };
  console.log("-- host");
  show(["SYSLOG_IDENTIFIER=omarchy-pocket-host", "-n", "30"]);
  console.log("-- daemon");
  show(["--user", "-u", "omarchy-pocketd", "-n", "30"]);
}

function publisherKey(): { key: ReturnType<typeof createPrivateKey>; publicKey: string } {
  mkdirSync(CONFIG, { recursive: true, mode: 0o700 });
  const path = join(CONFIG, "publisher.pem");
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(path, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log(`made a publisher key: ${path}. Whoever holds it can update your apps, so keep a copy.`);
  }
  const key = createPrivateKey(readFileSync(path));
  const raw = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
  return { key, publicKey: base64url(new Uint8Array(raw)) };
}

/** The icon as the store takes it: icon.png as is, or icon.svg baked. */
function iconPng(dir: string): Uint8Array {
  const png = join(dir, "icon.png");
  if (existsSync(png)) return new Uint8Array(readFileSync(png));
  const svg = join(dir, "icon.svg");
  if (!existsSync(svg)) fail(`${basename(dir)} needs an icon.svg of ${ICON_SIDE} px`);
  const image = bakeSvg(readFileSync(svg, "utf8"));
  if (image.width !== ICON_SIDE || image.height !== ICON_SIDE) fail(`icon.svg must be ${ICON_SIDE} x ${ICON_SIDE}`);
  return encodePNG(image.rgba, image.width, image.height);
}

async function publish(name: string) {
  const dir = dirOf(name);
  const manifestPath = join(dir, "pocket.app.json");
  if (!existsSync(manifestPath)) fail(`no applet at ${dir}`);
  const given = option("--author");
  const handle = given ?? publisher()?.handle;
  if (!handle) fail("say who you publish as the first time: --author <handle>, 2 to 30 lower-case letters, digits or dashes");
  if (!HANDLE.test(handle!)) fail("an author is 2 to 30 lower-case letters, digits or dashes");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // an app made before a handle was chosen takes it now
  if (typeof manifest.id === "string" && manifest.id.startsWith("oma.me.")) {
    manifest.id = `oma.${handle}.${name}`;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const summary = String(manifest.applet?.summary ?? "").trim();
  if (!summary || summary.length > SUMMARY_MAX) fail(`applet.summary in pocket.app.json must be 1 to ${SUMMARY_MAX} characters`);
  const icon = iconPng(dir);
  check(name, true);
  const built = await compile(name);
  const bytes = new Uint8Array(readFileSync(built));
  const facts = packageFacts(bytes);
  if (typeof facts === "string") fail(facts);
  const { key, publicKey } = publisherKey();
  const fields = { id: manifest.id, version: manifest.version, package: await sha256(bytes), icon: await sha256(icon), author: handle!, summary };
  const form = new FormData();
  form.set("package", new File([bytes], `${name}.pocket`));
  form.set("icon", new File([icon], "icon.png"));
  form.set("key", publicKey);
  form.set("signature", base64url(new Uint8Array(sign(null, signedMessage(fields), key))));
  form.set("author", handle!);
  form.set("summary", summary);
  const sample = sampleData(name);
  if (sample) form.set("mock", new File([sample.bytes], "mock.json"));
  else console.log(`${name} has no sample data (mock/mock.json): the store's page cannot run it in a browser`);
  const response = await fetch(`${STORE}/v1/publish`, { method: "POST", body: form });
  const body = (await response.json()) as { error?: string; state?: string; version?: string };
  if (!response.ok) fail(`the store refused it: ${body.error}`);
  writeFileSync(join(CONFIG, "publisher.json"), JSON.stringify({ handle }));
  console.log(body.state === "listed"
    ? `${manifest.id} ${body.version} is in the store.`
    : `${manifest.id} ${body.version} is with the store's editors. It appears in Store once they list it.`);
}

/** The applet's sample data packed, or null; stops on data that cannot be packed. */
function sampleData(name: string) {
  const packed = packMock(dirOf(name));
  if (Array.isArray(packed)) fail(`mock/mock.json: ${packed.join("; ")}`);
  return packed as Exclude<typeof packed, string[]>;
}

/** Ask what to make, then hand it to the coding agent in a new applet's directory. */
async function make() {
  process.stdout.write("What should the applet do?\n> ");
  const lines = console[Symbol.asyncIterator]();
  const want = String((await lines.next()).value ?? "").trim();
  if (!want) fail("nothing to make");
  const suggested = want.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().split(/\s+/).slice(0, 3).join("-").replace(/^[^a-z]+/, "") || "applet";
  process.stdout.write(`A short name for it [${suggested}]: `);
  const named = String((await lines.next()).value ?? "").trim().toLowerCase();
  const name = named || suggested;
  create(name, titleOf(name), want.slice(0, SUMMARY_MAX));
  const prompt = `Make this Pocket applet, called ${titleOf(name)}, in this directory: ${want}\n\nRead AGENTS.md and ../kit/README.md first, and build every page from the kit's rows. Draw its icon.svg. Work until pocket-applet run shows it working and you have looked at pocket-applet shot ${name}.`;
  const agent = Bun.which("codex") ?? fail("no coding agent here: install Codex first");
  const child = Bun.spawn([agent!, prompt], { cwd: dirOf(name), stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await child.exited);
}

const name = positional();
switch (argv[0]) {
  case "make":
    await make();
    break;
  case "new":
    if (!name) fail("usage: pocket-applet new <name> [--title T]");
    create(name!, option("--title") ?? titleOf(name!), `${titleOf(name!)} for Omarchy Pocket.`);
    break;
  case "check":
    workspace();
    check(name ?? fail("usage: pocket-applet check <name>"));
    break;
  case "build":
    console.log(await compile(name ?? fail("usage: pocket-applet build <name>")));
    break;
  case "run":
    await run(name ?? fail("usage: pocket-applet run <name>"));
    break;
  case "shot":
    await shot(name);
    break;
  case "log":
    log();
    break;
  case "tap":
    // a shot's pixels; the stage's pointer moves in points, two pixels each
    input("pointer", String(Number(argv[1] ?? 0) / 2), String(Number(argv[2] ?? 0) / 2));
    await Bun.sleep(150);
    input("click");
    break;
  case "scroll": {
    // the pad's two fingers scroll what the pointer is over
    input("pointer", String(Number(argv[1] ?? 0) / 2), String(Number(argv[2] ?? 0) / 2));
    input("layout", "pad");
    await Bun.sleep(600);
    // the pad's surface is y 36..324 of the deck's 384 points, and a stroke
    // that starts outside it is not a scroll; a longer scroll is several strokes
    let dy = Number(argv[3] ?? 200);
    while (Math.abs(dy) > 0) {
      const stroke = Math.max(-240, Math.min(240, dy));
      input("drag2", "196", String(180 + stroke / 2), "196", String(180 - stroke / 2), "60", "120");
      dy -= stroke;
      await Bun.sleep(1200);
    }
    await Bun.sleep(600);
    input("layout", "keys");
    break;
  }
  case "key":
    input("key", argv[1] ?? "");
    break;
  case "type":
    input("type", argv.slice(1).join(" "));
    break;
  case "mock": {
    const sample = sampleData(name ?? fail("usage: pocket-applet mock <name>"));
    if (!sample) fail(`${name} has no mock/mock.json`);
    const data = sample!.data;
    console.log(`${name}: ${data.routes.length} route${data.routes.length === 1 ? "" : "s"}, ${Object.keys(data.store ?? {}).length} store document(s), ${data.images?.length ?? 0} picture(s), ${(sample!.bytes.byteLength / 1024).toFixed(0)} KiB packed`);
    break;
  }
  case "web": {
    const built = await compile(name ?? fail("usage: pocket-applet web <name> [--port 4310]"));
    const port = Number(option("--port") ?? 4310);
    servePlayer({ package: built, applet: dirOf(name!), port, hostname: "0.0.0.0" });
    console.log(`open http://<this device>:${port}/ in a browser: ${name} on its sample data. Each request it makes shows under the surface.`);
    await new Promise(() => {});
    break;
  }
  case "publish":
    await publish(name ?? fail("usage: pocket-applet publish <name> [--author handle]"));
    break;
  default:
    console.log(readFileSync(import.meta.path, "utf8").split("\n").slice(1, 18).filter((line) => line.startsWith("//")).map((line) => line.slice(3)).join("\n"));
    if (argv[0]) process.exit(1);
}
