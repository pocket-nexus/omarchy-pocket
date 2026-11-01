#!/usr/bin/env bun
// pocket-applet: make applets on Omarchy Pocket itself. The SDK at
// /usr/share/omarchy-pocket/sdk holds the PocketJS compiler, the UI kit and
// examples; ~/Applets is laid out as the repository's applets/ are, so an
// applet's `../ui` is the kit.
//
//   pocket-applet make              ask what to make, then start the coding agent on it
//   pocket-applet new <name> [--title T]
//   pocket-applet build <name>      compile
//   pocket-applet run <name>        compile, install and open it in a window
//   pocket-applet shot [name]       the two panels as <name>/shot.png
//   pocket-applet log               the host's and the daemon's last lines
//   pocket-applet publish <name> [--author handle]   sign it and send it to the store
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { bakeSvg } from "../vendor/pocketjs/framework/compiler/bake-svg.ts";
import { encodePNG } from "../vendor/pocketjs/tools/png.ts";
import { base64url, HANDLE, ICON_SIDE, packageFacts, sha256, signedMessage, SUMMARY_MAX } from "../store/src/shared.ts";

const SDK = resolve(import.meta.dir, "..");
const HOME = homedir();
const WORK = join(HOME, "Applets");
const INSTALLED = join(HOME, ".local", "share", "omarchy-pocket", "applets");
const CONFIG = join(HOME, ".config", "omarchy-pocket");
const STORE = process.env.OMARCHY_POCKET_STORE ?? "https://oma.pocket.nexus";
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

function link(target: string, path: string) {
  try {
    if (lstatSync(path)) return;
  } catch {}
  symlinkSync(target, path);
}

/** ~/Applets as the repository's applets are laid out, against the SDK. */
function workspace() {
  mkdirSync(WORK, { recursive: true });
  link(join(SDK, "applets", "ui"), join(WORK, "ui"));
  link(join(SDK, "applets", "lib"), join(WORK, "lib"));
  link(join(SDK, "applets"), join(WORK, "examples"));
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
  for (const file of ["main.tsx", "app.tsx", "icon.svg"]) writeFileSync(join(dir, file), fill(readFileSync(join(SDK, "sdk", "template", file), "utf8")));
  symlinkSync("../ui/art", join(dir, "art"));
  symlinkSync("../AGENTS.md", join(dir, "AGENTS.md"));
  symlinkSync("../AGENTS.md", join(dir, "CLAUDE.md"));
  const manifest = JSON.parse(readFileSync(join(SDK, "applets", "weather", "pocket.json"), "utf8"));
  manifest.id = `oma.${publisher()?.handle ?? "me"}.${name}`;
  manifest.name = `pocket-${name}`;
  manifest.title = title;
  manifest.version = "0.1.0";
  manifest.applet = { version: 1, summary, services: ["store"], hosts: [] };
  manifest.app.entry = `${name}/main.tsx`;
  manifest.app.output = `${name}-main`;
  writeFileSync(join(dir, "pocket.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, ".gitignore"), ".build/\nshot.png\n");
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  console.log(dir);
}

async function compile(name: string): Promise<string> {
  const dir = dirOf(name);
  if (!existsSync(join(dir, "pocket.json"))) fail(`no applet at ${dir}`);
  workspace();
  const out = join(name, ".build");
  const child = Bun.spawn(
    ["bun", join("vendor", "pocketjs", "tools", "pocket.ts"), "compile", "--manifest", join(name, "pocket.json"), "--project-root", ".", "--runtime-config", join("host", "pocket.runtime-config.ts"),
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
  const title = JSON.parse(readFileSync(join(dirOf(name), "pocket.json"), "utf8")).title as string;
  const opened = Bun.spawnSync(["omarchy-shell", "pocket.window", "app", installed, title, "applet"], { stdout: "pipe", stderr: "pipe" });
  if (opened.exitCode !== 0) fail(`the shell did not open it: ${opened.stderr.toString().trim()}`);
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
  const manifestPath = join(dir, "pocket.json");
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
  if (!summary || summary.length > SUMMARY_MAX) fail(`applet.summary in pocket.json must be 1 to ${SUMMARY_MAX} characters`);
  const icon = iconPng(dir);
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
  const response = await fetch(`${STORE}/v1/publish`, { method: "POST", body: form });
  const body = (await response.json()) as { error?: string; state?: string; version?: string };
  if (!response.ok) fail(`the store refused it: ${body.error}`);
  writeFileSync(join(CONFIG, "publisher.json"), JSON.stringify({ handle }));
  console.log(body.state === "listed"
    ? `${manifest.id} ${body.version} is in the store.`
    : `${manifest.id} ${body.version} is with the store's editors. It appears in Store once they list it.`);
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
  const prompt = `Make this Pocket applet, called ${titleOf(name)}, in this directory: ${want}\n\nRead AGENTS.md first. Draw its icon.svg. Work until pocket-applet run shows it working and you have looked at pocket-applet shot ${name}.`;
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
  case "publish":
    await publish(name ?? fail("usage: pocket-applet publish <name> [--author handle]"));
    break;
  default:
    console.log(readFileSync(import.meta.path, "utf8").split("\n").slice(1, 12).filter((line) => line.startsWith("//")).map((line) => line.slice(3)).join("\n"));
    if (argv[0]) process.exit(1);
}
