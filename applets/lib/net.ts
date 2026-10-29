// HTTP for the applets in Omarchy Pocket's windows: the fetch() PocketJS's UI
// realms had (framework/src/net-api.ts before pocketjs moved HTTP into
// worker domains), over the NET ops the host program installs in each app's
// realm (host/src/net.rs). omarchy-pocketd performs every request on this
// device: companion.pocket URLs by Pocket Companion's services, any other
// URL fetched (daemon/companion.ts). The applets from Pocket Shell import
// fetch, NetError, companionService and companionNow from here in place of
// @pocketjs/framework/net and @pocketjs/framework/link.
// the frame loop's service pumps (not a subpath: framework/src/services.ts),
// which mount() does not reset as it does onFrame's registry
import { registerServicePump } from "../../vendor/pocketjs/framework/src/services.ts";

interface NetOps {
  /** the request body is copied during this call */
  start(metaJson: string, body: ArrayBuffer): number;
  /** copies a settled body into an exactly sized buffer, once */
  take(handle: number, into: ArrayBuffer): number;
  cancel(handle: number): void;
  /** one JSON array with every event settled since the last poll */
  poll(): string | undefined;
  lastError(): string;
  /** UTF-8, natively: QuickJS has no TextDecoder or TextEncoder */
  decode(bytes: ArrayBuffer): string;
  encode(text: string): ArrayBuffer;
}

export type NetErrorCode =
  | "unavailable" | "invalid_request" | "busy" | "dns" | "connect" | "tls" | "timeout"
  | "redirect" | "response_too_large" | "protocol" | "cancelled" | "other";

const CODES: readonly NetErrorCode[] = ["unavailable", "invalid_request", "busy", "dns", "connect", "tls", "timeout", "redirect", "response_too_large", "protocol", "cancelled", "other"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export type NetMethod = (typeof METHODS)[number];

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_RESPONSE_BYTES = 128 * 1024;
/** omarchy-pocketd's limit (APP_RESPONSE_MAX): 1 MiB, for density-2 glyph atlases */
export const NET_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;

export interface FetchOptions {
  method?: NetMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array | ArrayBuffer;
  /** 1..120000; 30000 when absent */
  timeoutMs?: number;
  /** the whole body's limit; 128 KiB when absent, at most 1 MiB */
  maxBytes?: number;
}

export class NetError extends Error {
  readonly code: NetErrorCode;
  constructor(code: NetErrorCode, message: string) {
    super(message);
    this.name = "NetError";
    this.code = code;
  }
}

export class PocketResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly ok: boolean;
  private readonly data: Uint8Array;

  constructor(status: number, url: string, headers: Record<string, string>, body: ArrayBuffer) {
    this.status = status;
    this.url = url;
    this.headers = Object.freeze({ ...headers });
    this.ok = status >= 200 && status < 300;
    this.data = new Uint8Array(body);
  }

  get byteLength(): number {
    return this.data.byteLength;
  }

  async bytes(): Promise<Uint8Array> {
    return this.data.slice();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice().buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    const net = ops();
    if (!net) throw new NetError("unavailable", "net: this host has no network for apps");
    return net.decode(this.data.buffer as ArrayBuffer);
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }
}

interface Settled {
  t: "done" | "error";
  h: number;
  status?: number;
  url?: string;
  headers?: Record<string, string>;
  bytes?: number;
  code?: string;
  message?: string;
}

interface Pending {
  resolve: (response: PocketResponse) => void;
  reject: (error: NetError) => void;
}

const pending = new Map<number, Pending>();
const ops = (): NetOps | null => {
  const net = (globalThis as { net?: Partial<NetOps> }).net;
  return net && typeof net.start === "function" && typeof net.poll === "function" ? (net as NetOps) : null;
};
const codeOf = (value: unknown): NetErrorCode => (CODES.includes(value as NetErrorCode) ? (value as NetErrorCode) : "other");

function settle(net: NetOps, ev: Settled) {
  const p = pending.get(ev.h);
  if (!p) return;
  pending.delete(ev.h);
  if (ev.t === "error") return p.reject(new NetError(codeOf(ev.code), String(ev.message || ev.code)));
  const bytes = ev.bytes ?? -1;
  if (!Number.isInteger(ev.status) || !Number.isInteger(bytes) || bytes < 0 || bytes > NET_MAX_RESPONSE_BYTES) {
    net.cancel(ev.h);
    return p.reject(new NetError("protocol", "net: malformed done event"));
  }
  const body = new ArrayBuffer(bytes);
  if (bytes > 0 && net.take(ev.h, body) !== bytes) return p.reject(new NetError("protocol", "net: response body transfer failed"));
  p.resolve(new PocketResponse(ev.status!, ev.url ?? "", ev.headers ?? {}, body));
}

let stopPump: (() => void) | null = null;

// one poll a frame, registered only while a request is open
function pump() {
  if (!pending.size) {
    stopPump?.();
    stopPump = null;
    return;
  }
  const net = ops();
  const batch = net?.poll();
  if (!net || batch === undefined) return;
  let events: unknown;
  try {
    events = JSON.parse(batch);
  } catch {
    events = null;
  }
  if (!Array.isArray(events)) return;
  for (const ev of events) if (ev && typeof ev === "object" && Number.isInteger((ev as Settled).h)) settle(net, ev as Settled);
}

function requestBody(net: NetOps, body: FetchOptions["body"]): Uint8Array {
  if (body === undefined) return new Uint8Array(0);
  if (typeof body === "string") return new Uint8Array(net.encode(body));
  if (body instanceof Uint8Array) return body.slice();
  return new Uint8Array(body.slice(0));
}

function inRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new NetError("invalid_request", `net: ${label} must be ${min}..${max}`);
  return value;
}

/** fetch-shaped, not the browser's Fetch: whole responses, no streams,
 *  cookies, cache or signals. */
export function fetch(url: string, options: FetchOptions = {}): Promise<PocketResponse> {
  return new Promise((resolve, reject) => {
    const net = ops();
    if (!net) return reject(new NetError("unavailable", "net: this host has no network for apps"));
    try {
      if (typeof url !== "string" || !/^https?:\/\/[^\s/]+(?:\/|$)/.test(url)) throw new NetError("invalid_request", "net: url must be absolute http:// or https://");
      const method = options.method ?? "GET";
      if (!(METHODS as readonly string[]).includes(method)) throw new NetError("invalid_request", `net: unsupported method ${String(method)}`);
      const body = requestBody(net, options.body);
      if ((method === "GET" || method === "HEAD") && body.byteLength > 0) throw new NetError("invalid_request", `net: ${method} cannot have a body`);
      if (body.byteLength > MAX_REQUEST_BYTES) throw new NetError("invalid_request", "net: request body exceeds 64 KiB");
      const headers: Record<string, string> = {};
      for (const name of Object.keys(options.headers ?? {})) headers[name.toLowerCase()] = String(options.headers![name]);
      const meta = JSON.stringify({
        url,
        method,
        headers,
        timeoutMs: inRange(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, "timeoutMs"),
        maxBytes: inRange(options.maxBytes ?? DEFAULT_RESPONSE_BYTES, 1, NET_MAX_RESPONSE_BYTES, "maxBytes"),
      });
      const handle = net.start(meta, body.buffer as ArrayBuffer);
      if (!Number.isInteger(handle) || handle < 0) {
        const detail = net.lastError() || "unavailable: request refused";
        const split = detail.indexOf(":");
        throw new NetError(codeOf(split < 0 ? "other" : detail.slice(0, split)), split < 0 ? detail : detail.slice(split + 1).trim());
      }
      pending.set(handle, { resolve, reject });
      stopPump ??= registerServicePump(pump);
    } catch (error) {
      reject(error instanceof NetError ? error : new NetError("invalid_request", String(error)));
    }
  });
}

/** A Pocket Companion service's URL: omarchy-pocketd answers it on this device. */
export function companionService(service: string, path = "/"): string {
  return `https://companion.pocket/${service}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The time: this device's own clock (a console asks its Mac's). */
export function companionNow(): number {
  return Date.now();
}
