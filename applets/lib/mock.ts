// SPDX-License-Identifier: GPL-3.0-or-later
// applets/lib/mock.ts — sample data for an applet, answered where every applet
// request goes: the NET ops (`globalThis.net`, applets/lib/net.ts). A host that
// installs createMockNet in an applet's realm runs the applet with no device
// and no network: the store's player in the browser (store/play), tests.
//
// An applet keeps its sample data in mock/mock.json (sdk/mock.ts packs it):
//
//   store    the companion store service's documents, by name: what the applet
//            saved on the device (places, a token's absence, settings)
//   routes   requests and their answers, tried in order: a method ("GET" when
//            absent, "*" for any) and a URL with `*` standing for any run of
//            characters, then a status, headers, a delay and a body
//   images   pictures for the images service, by source URL pattern; the
//            host decodes and scales them (hooks.picture)
//
// The companion's store service answers from `store` and keeps what the applet
// sets for the session. A request nothing answers fails as a connection error
// would, and hooks.request hears of every request, answered or not, so an
// author sees which URLs still need data.

/** The packed form: what the store holds and the player reads. */
export interface MockData {
  mock: 1;
  store?: Record<string, unknown>;
  routes: MockRoute[];
  images?: MockImage[];
}

export interface MockRoute {
  method?: string;
  url: string;
  status?: number;
  headers?: Record<string, string>;
  /** milliseconds before the answer; 60 when absent */
  delay?: number;
  /** the body as text, or as base64 for bytes */
  text?: string;
  base64?: string;
}

export interface MockImage {
  url: string;
  type: string;
  base64: string;
}

/** What a request came to, for the host's log. */
export interface MockRequestNote {
  method: string;
  url: string;
  /** "route", "store", "images" or null when nothing answered */
  answer: "route" | "store" | "images" | null;
  status: number;
}

export interface MockHooks {
  /** Every request, when it settles. */
  request?(note: MockRequestNote): void;
  /** A picture for the images service as an IMG entry (framework/compiler/pak.ts)
   *  `w` x `h`, cropped to cover; null when it cannot be made. */
  picture?(source: Uint8Array, type: string, w: number, h: number, round: boolean, alpha: boolean): Promise<Uint8Array | null>;
}

export const MOCK_MAX_BYTES = 4 * 1024 * 1024;
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_DELAY = 60;
const MAX_INFLIGHT = 2;
const MAX_RESPONSE = 2 * 1024 * 1024;
const COMPANION = "https://companion.pocket/";

/** The reasons `value` is not packed sample data; empty when it is. */
export function mockErrors(value: unknown): string[] {
  const errors: string[] = [];
  const data = value as Partial<MockData> | null;
  if (!data || typeof data !== "object") return ["sample data is a JSON object"];
  if (data.mock !== 1) errors.push("sample data says mock: 1");
  if (data.store !== undefined && (typeof data.store !== "object" || data.store === null || Array.isArray(data.store))) errors.push("store is an object of documents by name");
  if (!Array.isArray(data.routes)) errors.push("routes is a list");
  for (const [i, route] of (Array.isArray(data.routes) ? data.routes : []).entries()) {
    const at = `routes[${i}]`;
    if (!route || typeof route !== "object") { errors.push(`${at} is an object`); continue; }
    if (typeof route.url !== "string" || !/^https?:\/\//.test(route.url)) errors.push(`${at}.url is an http(s) URL pattern`);
    if (route.method !== undefined && route.method !== "*" && !METHODS.includes(route.method)) errors.push(`${at}.method is one of ${METHODS.join(", ")} or *`);
    if (route.status !== undefined && !(Number.isInteger(route.status) && route.status >= 100 && route.status <= 599)) errors.push(`${at}.status is 100 to 599`);
    if (route.delay !== undefined && !(Number.isFinite(route.delay) && route.delay >= 0 && route.delay <= 30_000)) errors.push(`${at}.delay is 0 to 30000 ms`);
    if (route.text !== undefined && typeof route.text !== "string") errors.push(`${at}.text is a string`);
    if (route.base64 !== undefined && typeof route.base64 !== "string") errors.push(`${at}.base64 is a string`);
    if (route.headers !== undefined && (typeof route.headers !== "object" || Object.values(route.headers).some((v) => typeof v !== "string"))) errors.push(`${at}.headers maps names to strings`);
  }
  if (data.images !== undefined) {
    if (!Array.isArray(data.images)) errors.push("images is a list");
    else for (const [i, image] of data.images.entries()) {
      if (!image || typeof image.url !== "string" || typeof image.base64 !== "string" || typeof image.type !== "string") errors.push(`images[${i}] has url, type and base64`);
    }
  }
  return errors;
}

/** Whether `url` fits `pattern`, where `*` stands for any run of characters. */
export function urlMatches(pattern: string, url: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === url;
  if (!url.startsWith(parts[0]!) || !url.endsWith(parts[parts.length - 1]!)) return false;
  let at = parts[0]!.length;
  const end = url.length - parts[parts.length - 1]!.length;
  for (const part of parts.slice(1, -1)) {
    const found = url.indexOf(part, at);
    if (found < 0 || found + part.length > end) return false;
    at = found + part.length;
  }
  return at <= end;
}

/** The first route for a request, or null. */
export function findRoute(data: MockData, method: string, url: string): MockRoute | null {
  return data.routes.find((r) => (r.method ?? "GET") === method || r.method === "*" ? urlMatches(r.url, url) : false) ?? null;
}

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  delay: number;
  answer: MockRequestNote["answer"];
}

/** The NET ops (applets/lib/net.ts NetOps) over sample data. `tick` is
 *  the host's: answers become visible to poll() at the next beginFrame(),
 *  as the device delivers them a frame at a time. */
export function createMockNet(data: MockData, hooks: MockHooks = {}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const store = new Map<string, unknown>(Object.entries(data.store ?? {}));
  let nextHandle = 1;
  let lastError = "";
  const pending = new Set<number>();
  const bodies = new Map<number, Uint8Array>();
  const settled: unknown[] = [];
  const visible: unknown[] = [];
  const jsonAnswer = (status: number, value: unknown, answer: Answer["answer"]): Answer => ({
    status, headers: { "content-type": "application/json" }, body: encoder.encode(JSON.stringify(value)), delay: 20, answer,
  });
  const refuse = (code: string, message: string) => {
    lastError = `${code}: ${message}`;
    return -1;
  };

  async function answer(method: string, url: string, body: Uint8Array): Promise<Answer | null> {
    const route = findRoute(data, method, url);
    if (route) {
      return {
        status: route.status ?? 200,
        headers: Object.fromEntries(Object.entries(route.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
        body: route.base64 !== undefined ? fromBase64(route.base64) : encoder.encode(route.text ?? ""),
        delay: route.delay ?? DEFAULT_DELAY,
        answer: "route",
      };
    }
    if (!url.startsWith(COMPANION)) return null;
    const parsed = new URL(url);
    const [service, ...rest] = parsed.pathname.slice(1).split("/");
    const path = `/${rest.join("/")}`;
    const name = parsed.searchParams.get("name") ?? "";
    if (service === "store") {
      if (path === "/get") return jsonAnswer(200, { value: store.get(name) ?? null }, "store");
      if (path === "/set" && method === "POST") {
        try {
          store.set(name, JSON.parse(decoder.decode(body)));
          return jsonAnswer(200, { ok: true }, "store");
        } catch {
          return jsonAnswer(400, { error: "the value is not JSON" }, "store");
        }
      }
      if (path === "/delete" && method === "POST") return store.delete(name), jsonAnswer(200, { ok: true }, "store");
      if (path === "/list") return jsonAnswer(200, { names: [...store.keys()] }, "store");
      return jsonAnswer(404, { error: `no store endpoint ${path}` }, "store");
    }
    if (service === "images" && path === "/fetch") {
      const source = parsed.searchParams.get("url") ?? "";
      const image = data.images?.find((i) => urlMatches(i.url, source));
      const w = Number(parsed.searchParams.get("w")), h = Number(parsed.searchParams.get("h"));
      const round = parsed.searchParams.get("round") === "1" && w === h;
      const entry = image && hooks.picture ? await hooks.picture(fromBase64(image.base64), image.type, w, h, round, round || parsed.searchParams.get("alpha") === "1") : null;
      if (!entry) return jsonAnswer(404, { error: "no sample picture for that url" }, "images");
      return { status: 200, headers: { "content-type": "application/x-pocket-img" }, body: entry, delay: 40, answer: "images" };
    }
    return null;
  }

  const ns = {
    start(metaJson: string, bodyBuffer: ArrayBuffer): number {
      let meta: { url?: unknown; method?: unknown; maxBytes?: unknown };
      try {
        meta = JSON.parse(metaJson);
      } catch {
        return refuse("invalid_request", "malformed request metadata");
      }
      const url = typeof meta.url === "string" ? meta.url : "";
      const method = typeof meta.method === "string" ? meta.method : "GET";
      if (!/^https?:\/\/[^\s/]+/.test(url)) return refuse("invalid_request", "url must be absolute HTTP(S)");
      if (!METHODS.includes(method)) return refuse("invalid_request", "unsupported method");
      if (pending.size >= MAX_INFLIGHT) return refuse("busy", `at most ${MAX_INFLIGHT} requests may be in flight`);
      const maxBytes = typeof meta.maxBytes === "number" ? Math.min(meta.maxBytes, MAX_RESPONSE) : MAX_RESPONSE;
      const handle = nextHandle++;
      pending.add(handle);
      const body = new Uint8Array(bodyBuffer).slice();
      void answer(method, url, body).then((found) => {
        const settle = () => {
          if (!pending.delete(handle)) return;
          if (!found) {
            hooks.request?.({ method, url, answer: null, status: 0 });
            settled.push({ t: "error", h: handle, code: "connect", message: `no sample data for ${method} ${url}` });
            return;
          }
          hooks.request?.({ method, url, answer: found.answer, status: found.status });
          if (found.body.byteLength > maxBytes) {
            settled.push({ t: "error", h: handle, code: "response_too_large", message: `response exceeded ${maxBytes} bytes` });
            return;
          }
          bodies.set(handle, found.body);
          settled.push({ t: "done", h: handle, status: found.status, url, headers: found.headers, bytes: found.body.byteLength });
        };
        setTimeout(settle, found?.delay ?? DEFAULT_DELAY);
      });
      return handle;
    },
    take(handle: number, into: ArrayBuffer): number {
      const body = bodies.get(handle);
      if (!body || into.byteLength !== body.byteLength) return -1;
      new Uint8Array(into).set(body);
      bodies.delete(handle);
      return body.byteLength;
    },
    cancel(handle: number) {
      pending.delete(handle);
      bodies.delete(handle);
    },
    poll(): string | undefined {
      return visible.length ? JSON.stringify(visible.splice(0)) : undefined;
    },
    lastError: () => lastError,
    decode: (bytes: ArrayBuffer) => decoder.decode(bytes),
    encode: (text: string) => encoder.encode(text).buffer as ArrayBuffer,
  };
  return {
    ns,
    /** Once per frame, before the applet's: what settled since is visible to poll(). */
    beginFrame() {
      visible.push(...settled.splice(0));
    },
    /** The store service's documents now, with what the applet set. */
    store: () => Object.fromEntries(store),
  };
}
