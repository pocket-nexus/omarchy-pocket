// The applets' network, and Pocket Companion's services on this device. An
// applet's realm sends an HTTP request through the host program
// (host/src/net.rs) as an `appNet` line; omarchy-pocketd performs it here and
// answers `@net <handle> <base64 body | -> <event>`, which the host hands to
// that app's `net.poll()` and `net.take()`.
//
// A URL on companion.pocket goes to the service it names, as Pocket Companion
// answers a console's request on a Mac: PocketJS's own providers
// (vendor/pocketjs/tools/companion/services: x, discord, youtube, store,
// podcasts, maps, homeassistant), their
// files under ~/.local/share/omarchy-pocket/companion/services/<name>/ (the
// Mac's `services/x/session.json`, `services/discord/token` copied there
// sign this device in), glyphs from this daemon's own baker at the device's
// raster density, and X's avatars and photos scaled by ffmpeg (the Mac's
// service runs sips). A service answers only a package whose manifest
// lists it in `applet.services`. Any other URL is fetched with
// performNet: redirects checked hop by hop, private addresses refused, and
// HTTPS_PROXY honoured (the omarchy-pocketd unit's environment).
//
// An app installed from the store by anyone but the official key runs apart
// (appstore.ts): it gets only the services that act for nobody, its `store`
// names are its own, and it fetches only the hosts it declared.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NET_ERROR } from "../vendor/pocketjs/contracts/spec/net.ts";
import { NetFailure, normalizeNetRequest, performNet, type NetResponse } from "../vendor/pocketjs/tools/companion/fetch.ts";
import { bytesResponse, jsonResponse, readJson, SERVICE_FACTORIES, ServiceHost, type ServiceProvider } from "../vendor/pocketjs/tools/companion/services.ts";
import { createXService } from "../vendor/pocketjs/tools/companion/services/x.ts";
import { encodeImageEntry } from "../vendor/pocketjs/framework/compiler/pak.ts";
import { IMG_FLAG_LINEAR, PSM } from "../vendor/pocketjs/contracts/spec/spec.ts";
import { manifest } from "./apps.ts";
import { createAppStoreService, installedApp, isolatedRequest, isolatedServices, STORE_PACKAGE } from "./appstore.ts";
import { AtlasBaker } from "./glyphs.ts";

/** The response limit an app's worker may ask for (contracts/spec/net.ts). */
export const APP_RESPONSE_MAX = 256 * 1024;
const GLYPH_PX = [8, 32] as const;
const GLYPH_TEXT_MAX = 20_000;
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i);

export interface AppNetRequest {
  h: number;
  package: string;
  meta: string;
  body: string;
}

/** The glyphs service (PocketJS's POST /glyphs/atlas {px, bold, slot, text})
 *  answered by the device's baker instead of CoreText or FreeType. */
function deviceGlyphs(baker: AtlasBaker): ServiceProvider {
  return {
    name: "glyphs",
    async handle(request) {
      if (request.path !== "/atlas" || request.method !== "POST") return jsonResponse(404, { error: `no glyphs endpoint ${request.path}` });
      const body = readJson<{ px?: unknown; bold?: unknown; slot?: unknown; density?: unknown; text?: unknown }>(request, { error: "atlas needs JSON {px, bold, slot, text}" });
      const px = typeof body.px === "number" ? Math.round(body.px) : NaN;
      const slot = typeof body.slot === "number" ? body.slot : NaN;
      const text = typeof body.text === "string" ? body.text : "";
      if (!(px >= GLYPH_PX[0] && px <= GLYPH_PX[1]) || !Number.isInteger(slot) || slot < 0 || slot >= 24) {
        return jsonResponse(400, { error: `atlas needs px ${GLYPH_PX[0]}..${GLYPH_PX[1]} and a slot below 24` });
      }
      if (text.length > GLYPH_TEXT_MAX) return jsonResponse(400, { error: `atlas text is limited to ${GLYPH_TEXT_MAX} characters` });
      const chars = [...new Set([...ASCII, ...[...text].map((c) => c.codePointAt(0)!)])].sort((a, b) => a - b);
      const atlas = await baker.bake(px, body.bold === true, slot, chars, body.density === 1 ? 1 : undefined);
      if (atlas.length > request.maxBytes) return jsonResponse(413, { error: `the atlas is ${atlas.length} bytes, limit ${request.maxBytes}` });
      return bytesResponse(atlas, "application/x-pocket-font");
    },
  };
}

/** An image (JPEG, PNG or WebP from twimg.com) as `width` x `height` RGBA
 *  by ffmpeg, scaled to cover the box and cropped at its centre. */
async function ffmpegImage(bytes: Uint8Array, width: number, height: number) {
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  const child = Bun.spawn(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-vf", filter, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], {
    stdin: bytes,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [rgba, code] = await Promise.all([new Response(child.stdout).bytes(), child.exited]);
  return code === 0 && rgba.length === width * height * 4 ? { width, height, rgba } : null;
}
/** The `images` service: GET /fetch?url=<image>&w=<pow2>&h=<pow2>[&alpha=1][&round=1] is
 *  a JPEG, PNG or WebP from the network as an IMG entry the app uploads, scaled
 *  to cover the box and cropped at its centre. QuickJS has no image decoder. */
function imagesService(cacheDir: string): ServiceProvider {
  const POW2 = new Set([8, 16, 32, 64, 128, 256, 512]);
  mkdirSync(cacheDir, { recursive: true });
  return {
    name: "images",
    async handle(request) {
      if (request.path !== "/fetch") return jsonResponse(404, { error: `no images endpoint ${request.path}` });
      const url = request.query.get("url") ?? "";
      const w = Number(request.query.get("w"));
      const h = Number(request.query.get("h"));
      if (!/^https:\/\//.test(url)) return jsonResponse(400, { error: "fetch needs an https url" });
      if (!POW2.has(w) || !POW2.has(h)) return jsonResponse(400, { error: "w and h are powers of two from 8 to 512" });
      // a picture comes back from disk: ffmpeg and the network take seconds
      const cached = join(cacheDir, `${createHash("sha256").update(request.query.toString()).digest("hex")}.img`);
      if (existsSync(cached)) return bytesResponse(new Uint8Array(readFileSync(cached)), "application/x-pocket-img");
      const fetched = await performNet({ url, method: "GET", headers: {}, body: new Uint8Array(0), timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 }, { signal: request.signal });
      if (fetched.status !== 200) return jsonResponse(502, { error: `the image's server answered ${fetched.status}` });
      const image = await ffmpegImage(fetched.body, w, h);
      if (!image) return jsonResponse(415, { error: "that image cannot be read" });
      // `round` cuts a circle with a soft edge, for an avatar
      const round = request.query.get("round") === "1";
      if (round) {
        const r = w / 2;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const edge = r - Math.hypot(x + 0.5 - r, y + 0.5 - r);
            image.rgba[(y * w + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round((edge + 0.5) * 255)));
          }
        }
      }
      const alpha = round || request.query.get("alpha") === "1";
      const entry = encodeImageEntry(image, alpha ? PSM.PSM_8888 : PSM.PSM_5650, IMG_FLAG_LINEAR);
      writeFileSync(cached, entry);
      return bytesResponse(entry, "application/x-pocket-img");
    },
  };
}

/** An avatar as `size` x `size` RGBA. */
const ffmpegAvatar = (bytes: Uint8Array, size: number) => ffmpegImage(bytes, size, size);

export class AppNet {
  private readonly services: ServiceHost;
  private readonly baker: AtlasBaker;
  private readonly open = new Map<number, AbortController>();
  private readonly callers = new Map<string, { app: string; services: string[]; isolated: boolean; hosts: string[] }>();

  constructor(private readonly home: string, runtime: string, private readonly log: (...parts: unknown[]) => void) {
    const storeDir = join(home, ".local", "share", "omarchy-pocket", "companion");
    mkdirSync(join(storeDir, "services"), { recursive: true, mode: 0o700 });
    this.baker = new AtlasBaker(join(runtime, "omarchy-pocket", "applet-glyphs"));
    const baker = this.baker;
    // the device's glyphs, the other providers as PocketJS has them
    SERVICE_FACTORIES.glyphs = () => deviceGlyphs(baker);
    SERVICE_FACTORIES.x = (context) => createXService(context, { decodeAvatar: ffmpegAvatar, decodeMedia: ffmpegImage });
    // what an install or a removal changes is read again at the next request
    SERVICE_FACTORIES.images = () => imagesService(join(home, ".cache", "omarchy-pocket", "images"));
    SERVICE_FACTORIES.appstore = () => createAppStoreService(home, () => this.callers.clear());
    this.services = new ServiceHost({ storeDir, log: (line) => log(line) });
  }

  /** The app behind a package and the services its manifest declares. */
  private caller(path: string) {
    let caller = this.callers.get(path);
    if (!caller) {
      const m = manifest(path) as { id?: string; applet?: { services?: unknown; hosts?: unknown } };
      const strings = (value: unknown) => (Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : []);
      const declared = strings(m.applet?.services);
      const record = installedApp(this.home, path);
      const isolated = record !== null && !record.official;
      // Only the store's own package, from the system's directory, installs anything.
      const services = (isolated ? isolatedServices(declared) : declared).filter((s) => s !== "appstore" || path === STORE_PACKAGE);
      caller = { app: m.id ?? path, services, isolated, hosts: strings(m.applet?.hosts) };
      this.callers.set(path, caller);
    }
    return caller;
  }

  /** Performs one request; `reply` gets the `@net` line. */
  async request(request: AppNetRequest, reply: (line: string) => void) {
    const h = request.h;
    const fail = (code: string, message: string) => reply(`@net ${h} - ${JSON.stringify({ t: "error", h, code, message: message.slice(0, 200) })}`);
    if (!Number.isInteger(h) || this.open.has(h)) return;
    const abort = new AbortController();
    this.open.set(h, abort);
    const started = Date.now();
    let label = "";
    try {
      const message = JSON.parse(request.meta) as Record<string, unknown>;
      const maxBytes = message.maxBytes === undefined ? undefined : Number(message.maxBytes);
      if (maxBytes !== undefined && !(Number.isInteger(maxBytes) && maxBytes >= 0 && maxBytes <= APP_RESPONSE_MAX)) {
        throw new NetFailure(NET_ERROR.invalidRequest, `maxBytes must be 0..${APP_RESPONSE_MAX}`);
      }
      const body = new Uint8Array(Buffer.from(request.body ?? "", "base64"));
      const meta = { ...normalizeNetRequest({ ...message, maxBytes: undefined, bytes: body.length }), ...(maxBytes === undefined ? {} : { maxBytes }) };
      label = `${meta.method} ${new URL(meta.url).host}${new URL(meta.url).pathname.slice(0, 40)}`;
      const caller = this.caller(request.package);
      if (caller.isolated) {
        const decision = isolatedRequest(caller.app, caller.hosts, meta.url);
        if (typeof decision !== "string") throw new NetFailure(NET_ERROR.other, decision.refused);
        meta.url = decision;
      }
      const local = { name: "rg-ds-plus", address: "127.0.0.1", localAddress: "127.0.0.1" };
      let response: NetResponse | null = await this.services.handle({ ...meta, body }, local, caller, abort.signal);
      response ??= await performNet({ ...meta, body }, { signal: abort.signal });
      if (!this.open.has(h)) return;
      const event = { t: "done", h, status: response.status, url: response.url, headers: response.headers, bytes: response.body.length };
      reply(`@net ${h} ${response.body.length ? Buffer.from(response.body).toString("base64") : "-"} ${JSON.stringify(event)}`);
      this.log(`app net ${label} ${response.status} ${response.body.length}B ${Date.now() - started}ms`);
    } catch (failure) {
      if (!this.open.has(h)) return;
      const f = failure instanceof NetFailure ? failure : new NetFailure(NET_ERROR.other, failure instanceof Error ? failure.message : String(failure));
      this.log(`app net ${label || "request"} ${f.code}: ${f.message}`);
      fail(f.code, f.message);
    } finally {
      this.open.delete(h);
    }
  }

  cancel(h: number) {
    this.open.get(h)?.abort();
    this.open.delete(h);
  }

  close() {
    for (const abort of this.open.values()) abort.abort();
    this.open.clear();
    this.services.close();
    this.baker.close();
  }
}
