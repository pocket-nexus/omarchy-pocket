// The applets' network, and Pocket Companion's services on this device. An
// applet's realm sends an HTTP request through the host program
// (host/src/net.rs) as an `appNet` line; omarchy-pocketd performs it here and
// answers `@net <handle> <base64 body | -> <event>`, which the host hands to
// that app's `net.poll()` and `net.take()`.
//
// A URL on companion.pocket goes to the service it names, as Pocket Companion
// answers a console's request on a Mac: PocketJS's own providers
// (vendor/pocketjs/tools/companion/services: x, discord, youtube), their
// files under ~/.local/share/omarchy-pocket/companion/services/<name>/ (the
// Mac's `services/x/session.json`, `services/discord/token` copied there
// sign this device in), glyphs from this daemon's own baker at the device's
// raster density, and X's avatars and photos scaled by ffmpeg (the Mac's
// service runs sips). A service answers only a package whose manifest
// lists it in `applet.services`. Any other URL is fetched with
// performNet: redirects checked hop by hop, private addresses refused, and
// HTTPS_PROXY honoured (the omarchy-pocketd unit's environment).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { NET_ERROR } from "../vendor/pocketjs/contracts/spec/net.ts";
import { NetFailure, normalizeNetRequest, performNet, type NetResponse } from "../vendor/pocketjs/tools/companion/fetch.ts";
import { bytesResponse, jsonResponse, readJson, SERVICE_FACTORIES, ServiceHost, type ServiceProvider } from "../vendor/pocketjs/tools/companion/services.ts";
import { createXService } from "../vendor/pocketjs/tools/companion/services/x.ts";
import { manifest } from "./apps.ts";
import { AtlasBaker } from "./glyphs.ts";

/** This host's whole-response limit: a glyph atlas at raster density 2 holds
 *  a quarter of the glyphs one at density 1 does in the same bytes, so the
 *  applets ask for up to 2 MiB (the NET contract's is 256 KiB). */
export const APP_RESPONSE_MAX = 2 * 1024 * 1024;
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
      const body = readJson<{ px?: unknown; bold?: unknown; slot?: unknown; text?: unknown }>(request, { error: "atlas needs JSON {px, bold, slot, text}" });
      const px = typeof body.px === "number" ? Math.round(body.px) : NaN;
      const slot = typeof body.slot === "number" ? body.slot : NaN;
      const text = typeof body.text === "string" ? body.text : "";
      if (!(px >= GLYPH_PX[0] && px <= GLYPH_PX[1]) || !Number.isInteger(slot) || slot < 0 || slot >= 24) {
        return jsonResponse(400, { error: `atlas needs px ${GLYPH_PX[0]}..${GLYPH_PX[1]} and a slot below 24` });
      }
      if (text.length > GLYPH_TEXT_MAX) return jsonResponse(400, { error: `atlas text is limited to ${GLYPH_TEXT_MAX} characters` });
      const chars = [...new Set([...ASCII, ...[...text].map((c) => c.codePointAt(0)!)])].sort((a, b) => a - b);
      const atlas = await baker.bake(px, body.bold === true, slot, chars);
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
/** An avatar as `size` x `size` RGBA. */
const ffmpegAvatar = (bytes: Uint8Array, size: number) => ffmpegImage(bytes, size, size);

export class AppNet {
  private readonly services: ServiceHost;
  private readonly baker: AtlasBaker;
  private readonly open = new Map<number, AbortController>();
  private readonly callers = new Map<string, { app: string; services: string[] }>();

  constructor(home: string, runtime: string, private readonly log: (...parts: unknown[]) => void) {
    const storeDir = join(home, ".local", "share", "omarchy-pocket", "companion");
    mkdirSync(join(storeDir, "services"), { recursive: true, mode: 0o700 });
    this.baker = new AtlasBaker(join(runtime, "omarchy-pocket", "applet-glyphs"));
    const baker = this.baker;
    // the device's glyphs, the other providers as PocketJS has them
    SERVICE_FACTORIES.glyphs = () => deviceGlyphs(baker);
    SERVICE_FACTORIES.x = (context) => createXService(context, { decodeAvatar: ffmpegAvatar, decodeMedia: ffmpegImage });
    this.services = new ServiceHost({ storeDir, log: (line) => log(line) });
  }

  /** The app behind a package and the services its manifest declares. */
  private caller(path: string) {
    let caller = this.callers.get(path);
    if (!caller) {
      const m = manifest(path) as { id?: string; applet?: { services?: unknown } };
      const services = Array.isArray(m.applet?.services) ? m.applet.services.filter((s): s is string => typeof s === "string") : [];
      caller = { app: m.id ?? path, services };
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
