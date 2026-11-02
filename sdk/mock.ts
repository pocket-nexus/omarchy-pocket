// An applet's sample data, packed: mock/mock.json and the files it names
// become the one MockData document (applets/lib/mock.ts) that the store keeps
// beside a version and the browser player answers requests from.
//
// mock/mock.json, as an author writes it:
//
//   {
//     "store": { "weather": { "places": [...], "units": "c" } },
//     "routes": [
//       { "url": "https://api.open-meteo.com/v1/forecast?latitude=35.6*", "file": "forecast-tokyo.json" },
//       { "method": "POST", "url": "https://example.com/vote", "status": 204 },
//       { "url": "https://example.com/missing", "status": 404, "json": { "error": "gone" } }
//     ],
//     "images": { "https://avatars.githubusercontent.com/*": "avatar.png" }
//   }
//
// A route's body is `file` (beside mock.json; text for JSON, XML, HTML and
// plain text, bytes otherwise), `json`, or `text`. A JSON body gets
// content-type application/json unless the route names one.
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { MOCK_MAX_BYTES, mockErrors, type MockData, type MockImage, type MockRoute } from "../applets/lib/mock.ts";

const TEXT = new Set([".json", ".txt", ".xml", ".html", ".csv", ".md", ".rss", ".atom"]);
const TYPES: Record<string, string> = {
  ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml", ".html": "text/html", ".csv": "text/csv",
  ".rss": "application/rss+xml", ".atom": "application/atom+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".mp3": "audio/mpeg",
};

export interface PackedMock {
  data: MockData;
  bytes: Uint8Array;
}

/** The applet's sample data packed, null when it has none, or the reasons it
 *  cannot be packed. */
export function packMock(appletDir: string): PackedMock | null | string[] {
  const dir = join(appletDir, "mock");
  const path = join(dir, "mock.json");
  if (!existsSync(path)) return null;
  let source: { store?: unknown; routes?: unknown; images?: unknown };
  try {
    source = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return [`mock/mock.json is not JSON: ${error instanceof Error ? error.message : error}`];
  }
  const errors: string[] = [];
  const read = (file: unknown, at: string): { bytes: Buffer; ext: string } | null => {
    if (typeof file !== "string" || !file) return errors.push(`${at}.file names a file beside mock.json`), null;
    const full = normalize(join(dir, file));
    if (!full.startsWith(dir + "/")) return errors.push(`${at}.file stays inside mock/`), null;
    if (!existsSync(full) || !statSync(full).isFile()) return errors.push(`${at}.file: no ${file} in mock/`), null;
    return { bytes: readFileSync(full), ext: extname(full).toLowerCase() };
  };
  const routes: MockRoute[] = [];
  for (const [i, raw] of (Array.isArray(source.routes) ? source.routes : []).entries()) {
    const at = `routes[${i}]`;
    const r = raw as Record<string, unknown>;
    const route: MockRoute = { url: String(r.url ?? "") };
    if (r.method !== undefined) route.method = String(r.method).toUpperCase() === "*" ? "*" : String(r.method).toUpperCase();
    if (r.status !== undefined) route.status = r.status as number;
    if (r.delay !== undefined) route.delay = r.delay as number;
    const headers = { ...(r.headers as Record<string, string> | undefined) };
    const typed = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (r.file !== undefined) {
      const file = read(r.file, at);
      if (file) {
        if (TEXT.has(file.ext)) route.text = file.bytes.toString("utf8");
        else route.base64 = file.bytes.toString("base64");
        if (!typed && TYPES[file.ext]) headers["content-type"] = TYPES[file.ext]!;
      }
    } else if (r.json !== undefined) {
      route.text = JSON.stringify(r.json);
      if (!typed) headers["content-type"] = "application/json";
    } else if (r.text !== undefined) {
      route.text = String(r.text);
    }
    if (Object.keys(headers).length) route.headers = headers;
    routes.push(route);
  }
  if (source.routes !== undefined && !Array.isArray(source.routes)) errors.push("routes is a list");
  const images: MockImage[] = [];
  if (source.images !== undefined) {
    if (typeof source.images !== "object" || source.images === null || Array.isArray(source.images)) errors.push("images maps URL patterns to picture files");
    else for (const [url, file] of Object.entries(source.images)) {
      const picture = read(file, `images["${url}"]`);
      if (picture) images.push({ url, type: TYPES[picture.ext] ?? "application/octet-stream", base64: picture.bytes.toString("base64") });
    }
  }
  const data: MockData = { mock: 1, ...(source.store !== undefined ? { store: source.store as Record<string, unknown> } : {}), routes, ...(images.length ? { images } : {}) };
  errors.push(...mockErrors(data));
  if (errors.length) return errors;
  // an empty file is no sample data: the store's page would run the app on nothing
  if (!routes.length && !images.length && !Object.keys(data.store ?? {}).length) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.byteLength > MOCK_MAX_BYTES) return [`the packed sample data is ${(bytes.byteLength / 1048576).toFixed(1)} MiB; the store takes ${MOCK_MAX_BYTES / 1048576} MiB`];
  return { data, bytes };
}
