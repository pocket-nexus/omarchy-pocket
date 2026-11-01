// SPDX-License-Identifier: GPL-3.0-or-later
// applets/github/api.ts — GitHub's REST API: one queue of four requests, the
// token from the store service, ETags so a repeat read costs no rate limit, and
// the Link header's next page.
import { createSignal } from "solid-js";
import { companionService, fetch } from "../lib/net.ts";

const API = "https://api.github.com";
const AT_ONCE = 4;
const MAX_BYTES = 2 * 1024 * 1024;
const CACHE = 300;
const STORE_NAME = "github";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;

interface Reply {
  status: number;
  text: string;
  next: string | null;
}

export interface GitHub {
  signedIn(): boolean;
  /** The token's owner, once read. */
  me(): J | null;
  ready(): boolean;
  signIn(token: string): Promise<void>;
  signOut(): Promise<void>;
  rate(): { remaining: number; limit: number; reset: number } | null;
  get(path: string): Promise<J>;
  /** A body as text: a raw file, a README. */
  raw(path: string): Promise<string>;
  /** One page of a list; `key` when the list sits under a key of the answer. */
  page(path: string, next: string | null, key?: string): Promise<{ items: J[]; next: string | null }>;
  send(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<J>;
  /** Whether a request answers 2xx: "am I starring this?". */
  check(path: string): Promise<boolean>;
}

export function createGitHub(): GitHub {
  const [token, setToken] = createSignal("");
  const [ready, setReady] = createSignal(false);
  const [me, setMe] = createSignal<J | null>(null);
  const [rate, setRate] = createSignal<{ remaining: number; limit: number; reset: number } | null>(null);
  const cache = new Map<string, { etag: string; reply: Reply }>();
  const queue: (() => void)[] = [];
  let running = 0;
  const pump = () => {
    while (running < AT_ONCE && queue.length) {
      running++;
      queue.shift()!();
    }
  };

  const failure = (status: number, text: string) => {
    let detail = "";
    try {
      const body = JSON.parse(text) as { message?: string; errors?: (string | { message?: string })[] };
      // the reason is in `errors` when there is one: "Can not approve your own pull request"
      const first = body.errors?.[0];
      detail = (typeof first === "string" ? first : first?.message) || body.message || "";
    } catch {}
    const r = rate();
    if ((status === 403 || status === 429) && r && r.remaining === 0) {
      const minutes = Math.max(1, Math.ceil((r.reset * 1000 - Date.now()) / 60000));
      return new Error(`GitHub's rate limit is used up: it resets in ${minutes} min.`);
    }
    if (status === 401) return new Error("GitHub refused the token. Sign in again in Me.");
    return new Error(detail || `GitHub answered ${status}.`);
  };

  const request = (method: string, url: string, options: { accept?: string; body?: unknown; soft?: boolean } = {}) =>
    new Promise<Reply>((resolve, reject) => {
      queue.push(() => {
        const cached = method === "GET" && !options.accept ? cache.get(url) : undefined;
        const headers: Record<string, string> = {
          accept: options.accept ?? "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "Omarchy-Pocket",
        };
        if (token()) headers.authorization = `Bearer ${token()}`;
        if (cached) headers["if-none-match"] = cached.etag;
        if (options.body !== undefined) headers["content-type"] = "application/json";
        fetch(url, { method: method as "GET", headers, timeoutMs: 45_000, maxBytes: MAX_BYTES, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) }).then(
          async (response) => {
            running--;
            pump();
            const limit = Number(response.headers["x-ratelimit-limit"]);
            if (limit) setRate({ limit, remaining: Number(response.headers["x-ratelimit-remaining"]), reset: Number(response.headers["x-ratelimit-reset"]) });
            if (response.status === 304 && cached) return resolve(cached.reply);
            const text = await response.text();
            if (response.status >= 400 && !options.soft) return reject(failure(response.status, text));
            const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers["link"] ?? "")?.[1] ?? null;
            const reply: Reply = { status: response.status, text, next };
            const etag = response.headers["etag"];
            if (method === "GET" && !options.accept && etag && response.status === 200) {
              if (cache.size >= CACHE) cache.delete(cache.keys().next().value as string);
              cache.set(url, { etag, reply });
            }
            resolve(reply);
          },
          (error: unknown) => {
            running--;
            pump();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
      pump();
    });
  const absolute = (path: string) => (path.startsWith("http") ? path : `${API}${path}`);
  const parse = (text: string) => (text ? JSON.parse(text) : null);

  const whoAmI = () => request("GET", `${API}/user`).then((reply) => setMe(parse(reply.text)), () => setMe(null));
  fetch(companionService("store", `/get?name=${STORE_NAME}`), { timeoutMs: 10_000, maxBytes: 4096 }).then(
    async (response) => {
      const saved = JSON.parse(await response.text()) as { value?: { token?: unknown } };
      if (typeof saved.value?.token === "string") {
        setToken(saved.value.token);
        void whoAmI();
      }
      setReady(true);
    },
    () => setReady(true),
  );

  return {
    signedIn: () => token() !== "",
    me,
    ready,
    rate,
    async signIn(next) {
      const before = token();
      setToken(next);
      const reply = await request("GET", `${API}/user`, { soft: true });
      if (reply.status !== 200) {
        setToken(before);
        throw new Error(reply.status === 401 ? "GitHub does not accept that token." : `GitHub answered ${reply.status}.`);
      }
      setMe(parse(reply.text));
      await fetch(companionService("store", `/set?name=${STORE_NAME}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: next }), timeoutMs: 10_000, maxBytes: 4096 });
      cache.clear();
    },
    async signOut() {
      await fetch(companionService("store", `/delete?name=${STORE_NAME}`), { method: "POST", timeoutMs: 10_000, maxBytes: 4096 });
      setToken("");
      setMe(null);
      cache.clear();
    },
    get: async (path) => parse((await request("GET", absolute(path))).text),
    raw: async (path) => (await request("GET", absolute(path), { accept: "application/vnd.github.raw+json" })).text,
    async page(path, next, key) {
      const url = next ?? absolute(`${path}${path.includes("?") ? "&" : "?"}per_page=30`);
      const reply = await request("GET", url);
      const body = parse(reply.text);
      return { items: (key ? body[key] : body) ?? [], next: reply.next };
    },
    send: async (method, path, body) => parse((await request(method, absolute(path), { body: body ?? (method === "PUT" ? {} : undefined) })).text),
    check: async (path) => {
      const reply = await request("GET", absolute(path), { soft: true, accept: "application/vnd.github+json" });
      return reply.status >= 200 && reply.status < 300;
    },
  };
}

/** "3h" from an ISO time. */
export { age, count } from "../kit/page.ts";
export const bytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.ceil(n / 1024)} KB` : `${n} B`);
