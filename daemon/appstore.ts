// The store on this device: oma.pocket.nexus's catalog, installs and removals,
// answered to the Store applet as the `appstore` service, and the rules an
// installed app runs under.
//
//   GET /catalog            {apps: [... entry, installed, system]}, for this device's profile
//   GET /icon?sha=<hex>     a store icon as a 64 px IMG entry
//   GET /install?id=<id>    fetches, checks and installs the newest listed version
//   GET /remove?id=<id>     removes an installed app; a system app stays
//   GET /open?id=<id>       opens an installed or system app in a window
//
// An install checks the publisher's signature over the package, the icon and
// what the catalog says, and that the key is the one this device first
// installed the app from. An app from anyone but the official key is named
// after its whole id, so it cannot stand in for a system app's file, and runs
// isolated: see isolatedServices and isolatedRequest.
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeImageEntry, decodePng } from "../vendor/pocketjs/framework/compiler/pak.ts";
import { IMG_FLAG_LINEAR, PSM } from "../vendor/pocketjs/contracts/spec/spec.ts";
import { bytesResponse, jsonResponse, type ServiceProvider, type ServiceRequest } from "../vendor/pocketjs/tools/companion/services.ts";
import { OPEN_SERVICES, packageFacts, sha256, signatureValid } from "../store/src/shared.ts";
import { apps } from "./apps.ts";

export const STORE_ORIGIN = "https://oma.pocket.nexus";
/** The public half of the key Pocket Nexus publishes with. */
export const OFFICIAL_KEY = "tF8Q_hSXiYfxDdlQrpJfleDcKmkZPtQ20G_SNjtOquQ";
export const SYSTEM_APPLETS = "/usr/share/omarchy-pocket/applets";
/** The one package that may ask for the appstore service. */
export const STORE_PACKAGE = join(SYSTEM_APPLETS, "store.pocket");
const CATALOG_MS = 60_000;
const ICON_SIDE = 64;

export interface InstalledApp {
  id: string;
  file: string;
  key: string;
  version: string;
  official: boolean;
  title: string;
}

const userApplets = (home: string) => join(home, ".local", "share", "omarchy-pocket", "applets");
const storeDir = (home: string) => join(home, ".local", "share", "omarchy-pocket", "store");
const registryPath = (home: string) => join(storeDir(home), "installed.json");

let cached: { at: number; apps: InstalledApp[] } | null = null;
function registry(home: string): InstalledApp[] {
  try {
    const at = statSync(registryPath(home)).mtimeMs;
    if (cached?.at === at) return cached.apps;
    const apps = JSON.parse(readFileSync(registryPath(home), "utf8")) as InstalledApp[];
    cached = { at, apps };
    return apps;
  } catch {
    return [];
  }
}
function saveRegistry(home: string, apps: InstalledApp[]) {
  mkdirSync(storeDir(home), { recursive: true, mode: 0o700 });
  const path = registryPath(home);
  writeFileSync(`${path}.tmp`, JSON.stringify(apps, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  cached = null;
}

/** The store's record of the package at `path`, or null for a system app or one built here. */
export function installedApp(home: string, path: string): InstalledApp | null {
  return registry(home).find((app) => app.file === path) ?? null;
}

/** What an isolated app may ask for of what it declares. */
export const isolatedServices = (declared: string[]) => declared.filter((name) => (OPEN_SERVICES as readonly string[]).includes(name));

/** An isolated app's request: its `store` names are its own, and it fetches
 *  only the hosts it declared. The URL to go on with, or why not. */
export function isolatedRequest(app: string, hosts: readonly string[], raw: string): string | { refused: string } {
  const url = new URL(raw);
  if (url.hostname === "companion.pocket") {
    const [, service, action] = url.pathname.split("/");
    // the images service fetches for an app: the same hosts hold
    if (service === "images") {
      let host = "";
      try {
        host = new URL(url.searchParams.get("url") ?? "").hostname;
      } catch {}
      return hosts.includes(host) ? raw : { refused: `${host || "that image"} is not among the hosts this app declared` };
    }
    if (service !== "store") return raw;
    if (action === "list") return { refused: "an app from the store does not list other apps' settings" };
    const name = url.searchParams.get("name") ?? "";
    const prefix = `app-${createHash("sha256").update(app).digest("hex").slice(0, 16)}`;
    url.searchParams.set("name", `${prefix}/${name.replace(/\//g, ".")}`);
    return url.toString();
  }
  return hosts.includes(url.hostname) ? raw : { refused: `${url.hostname} is not among the hosts this app declared` };
}

/** What a package says about itself: its manifest and directory are at its start. */
function factsOf(path: string) {
  const fd = openSync(path, "r");
  const head = new Uint8Array(64 * 1024);
  const size = readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  return packageFacts(head.subarray(0, size));
}

/** This device's profile, from a package built for it. */
function deviceProfile(): string {
  for (const file of readdirSync(SYSTEM_APPLETS).filter((f) => f.endsWith(".pocket"))) {
    const facts = factsOf(join(SYSTEM_APPLETS, file));
    if (typeof facts !== "string") return facts.profile;
  }
  throw new Error("no package built for this device to read its profile from");
}

interface CatalogEntry {
  id: string;
  version: string;
  title: string;
  summary: string;
  author: string;
  key: string;
  official: boolean;
  services: string[];
  hosts: string[];
  profile: string;
  package: string;
  icon: string;
  bytes: number;
  signature: string;
}

const read = async (url: string, signal: AbortSignal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`the store answered ${response.status}`);
  return response;
};

/** A square PNG box-filtered to ICON_SIDE, as an IMG entry with its alpha. */
function iconEntry(png: Uint8Array): Uint8Array {
  const image = decodePng(png);
  const step = Math.max(1, Math.floor(image.width / ICON_SIDE));
  const rgba = new Uint8Array(ICON_SIDE * ICON_SIDE * 4);
  for (let y = 0; y < ICON_SIDE; y++) {
    for (let x = 0; x < ICON_SIDE; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < step; sy++) {
        for (let sx = 0; sx < step; sx++) {
          const at = ((y * step + sy) * image.width + x * step + sx) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += image.rgba[at + c] ?? 0;
        }
      }
      for (let c = 0; c < 4; c++) rgba[(y * ICON_SIDE + x) * 4 + c] = Math.round(sum[c]! / (step * step));
    }
  }
  return encodeImageEntry({ width: ICON_SIDE, height: ICON_SIDE, rgba }, PSM.PSM_8888, IMG_FLAG_LINEAR);
}

export function createAppStoreService(home: string, changed: () => void): ServiceProvider {
  let catalog: { at: number; apps: CatalogEntry[] } | null = null;
  const icons = join(home, ".cache", "omarchy-pocket", "store-icons");

  const load = async (signal: AbortSignal, fresh = false) => {
    if (!fresh && catalog && Date.now() - catalog.at < CATALOG_MS) return catalog.apps;
    const response = await read(`${STORE_ORIGIN}/v1/catalog?profile=${deviceProfile()}`, signal);
    const body = (await response.json()) as { apps: CatalogEntry[] };
    catalog = { at: Date.now(), apps: body.apps };
    return body.apps;
  };

  /** The version on this device, from the store's record or a system package's manifest. */
  const local = () => {
    const out = new Map<string, { version: string; system: boolean }>();
    for (const app of apps(home)) {
      if (!app.applet) continue;
      const facts = factsOf(app.applet);
      if (typeof facts !== "string") out.set(facts.id, { version: facts.version, system: app.applet.startsWith(SYSTEM_APPLETS) && !installedApp(home, app.applet) });
    }
    return out;
  };

  const install = async (request: ServiceRequest) => {
    const id = request.query.get("id") ?? "";
    const entry = (await load(request.signal, true)).find((app) => app.id === id);
    if (!entry) return jsonResponse(404, { error: "the store does not list that app for this device" });
    const pinned = registry(home).find((app) => app.id === id);
    if (pinned && pinned.key !== entry.key) return jsonResponse(409, { error: "this version comes from another publisher than the one installed" });
    const official = entry.key === OFFICIAL_KEY;
    if (!official && entry.services.some((name) => !(OPEN_SERVICES as readonly string[]).includes(name))) {
      return jsonResponse(403, { error: "this app asks for services an app from the store cannot have" });
    }
    const bytes = new Uint8Array(await (await read(`${STORE_ORIGIN}/v1/packages/${entry.package}`, request.signal)).arrayBuffer());
    if ((await sha256(bytes)) !== entry.package) return jsonResponse(502, { error: "the package does not match its hash" });
    const fields = { id: entry.id, version: entry.version, package: entry.package, icon: entry.icon, author: entry.author, summary: entry.summary };
    if (!(await signatureValid(entry.key, entry.signature, fields))) return jsonResponse(502, { error: "the publisher's signature does not match" });
    const facts = packageFacts(bytes);
    if (typeof facts === "string" || facts.id !== entry.id || facts.version !== entry.version || facts.profile !== deviceProfile()) {
      return jsonResponse(502, { error: "the package is not the one the store describes" });
    }
    const dir = userApplets(home);
    mkdirSync(dir, { recursive: true });
    const name = official ? id.split(".").pop()! : id;
    const file = join(dir, `${name}.pocket`);
    writeFileSync(`${file}.tmp`, bytes);
    renameSync(`${file}.tmp`, file);
    saveRegistry(home, [...registry(home).filter((app) => app.id !== id), { id, file, key: entry.key, version: entry.version, official, title: entry.title }]);
    changed();
    return jsonResponse(200, { id, version: entry.version });
  };

  const remove = (request: ServiceRequest) => {
    const id = request.query.get("id") ?? "";
    const record = registry(home).find((app) => app.id === id);
    if (!record) return jsonResponse(404, { error: "the store did not install that app" });
    rmSync(record.file, { force: true });
    saveRegistry(home, registry(home).filter((app) => app.id !== id));
    changed();
    return jsonResponse(200, { removed: id });
  };

  const open = (request: ServiceRequest) => {
    const id = request.query.get("id") ?? "";
    for (const app of apps(home)) {
      if (!app.applet) continue;
      const facts = factsOf(app.applet);
      if (typeof facts === "string" || facts.id !== id) continue;
      Bun.spawn(["omarchy-shell", "pocket.window", "app", app.applet, app.name, "applet"], { stdout: "ignore", stderr: "ignore" });
      return jsonResponse(200, { opened: id });
    }
    return jsonResponse(404, { error: "that app is not on this device" });
  };

  return {
    name: "appstore",
    async handle(request) {
      try {
        switch (request.path) {
          case "/catalog": {
            const here = local();
            const list = await load(request.signal, request.query.get("fresh") === "1");
            return jsonResponse(200, { apps: list.map((app) => ({ ...app, installed: here.get(app.id)?.version ?? null, system: here.get(app.id)?.system ?? false })) });
          }
          case "/icon": {
            const sha = request.query.get("sha") ?? "";
            if (!/^[0-9a-f]{64}$/.test(sha)) return jsonResponse(400, { error: "icon needs a hash" });
            const path = join(icons, `${sha}.img`);
            if (!existsSync(path)) {
              const png = new Uint8Array(await (await read(`${STORE_ORIGIN}/v1/icons/${sha}`, request.signal)).arrayBuffer());
              if ((await sha256(png)) !== sha) return jsonResponse(502, { error: "the icon does not match its hash" });
              mkdirSync(icons, { recursive: true });
              writeFileSync(path, iconEntry(png));
            }
            return bytesResponse(new Uint8Array(readFileSync(path)), "application/x-pocket-img");
          }
          case "/install":
            return await install(request);
          case "/remove":
            return remove(request);
          case "/open":
            return open(request);
          default:
            return jsonResponse(404, { error: `no appstore endpoint ${request.path}` });
        }
      } catch (failure) {
        return jsonResponse(502, { error: failure instanceof Error ? failure.message : String(failure) });
      }
    },
  };
}
