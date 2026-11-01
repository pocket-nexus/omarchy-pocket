// SPDX-License-Identifier: GPL-3.0-or-later
// applets/reddit/api.ts — the companion's reddit service (PocketJS
// tools/companion/services/reddit.ts) and its store service over
// applets/lib/net.ts.
//
// Every request goes to https://companion.pocket/reddit/... or /store/...,
// which omarchy-pocketd answers on this device. The NET module admits two
// requests at a time, so pages, posts, searches, the store and pictures
// share one queue; JSON goes ahead of pictures, and a picture the list
// scrolled past is dropped from the queue. A thumbnail arrives as a 128 x 128
// IMG entry holding the post's picture in its top-left 128 x 80, a preview as
// a 512 x 512 entry holding 480 x 300; each becomes a texture here, and the
// least recently shown are freed past THUMB_TEXTURES and IMAGE_TEXTURES.

import { createSignal } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { registerTexture } from "@pocketjs/framework/renderer";
import { companionService, fetch, NetError, NET_MAX_RESPONSE_BYTES, type PocketResponse } from "../lib/net.ts";
import { notLinked, theComputer } from "../ui/companion.ts";

export const MAX_INFLIGHT = 2;
export const THUMB_TEXTURES = 48;
export const IMAGE_TEXTURES = 6;
/** The thumbnail's picture inside its texture. */
export const THUMB = { width: 128, height: 80, texture: 128 } as const;
/** The preview picture inside its texture. */
export const IMAGE = { width: 480, height: 300, texture: 512 } as const;
export const STORE_NAME = "reddit";
/** The feed every reader starts with. */
export const HOME_SUB = "popular";

export type Sort = "hot" | "new" | "top";
export const SORTS: readonly { id: Sort; label: string }[] = [
  { id: "hot", label: "Hot" },
  { id: "new", label: "New" },
  { id: "top", label: "Top" },
];

export interface Post {
  id: string;
  title: string;
  author: string;
  /** The subreddit's name without r/. */
  sub: string;
  score: number;
  comments: number;
  /** Seconds since the epoch. */
  created: number;
  url: string;
  domain: string;
  isSelf: boolean;
  /** Plain text. */
  selftext: string;
  /** The post has a thumbnail (/thumb). */
  thumb: boolean;
  /** The preview picture's URL (there is an /image), or null. */
  preview: string | null;
}

export interface Comment {
  id: string;
  depth: number;
  author: string;
  score: number;
  created: number;
  body: string;
}

export interface Subreddit {
  name: string;
  title: string;
  subscribers: number;
  description: string;
}

export interface FeedPage {
  items: Post[];
  /** The id to continue from, "" at the end. */
  after: string;
}

export interface Thread {
  post: Post;
  comments: Comment[];
}

/** The store document: the subreddits the reader keeps. */
export interface Saved {
  subs: string[];
}

export interface SetupState {
  ready: boolean;
  /** "app" (a client id), "account" (a script app with a login), "none". */
  mode: "app" | "account" | "none";
}

/** What the setup page sends: an installed app's client id, or a script
 *  app's id and secret with the owner's login. */
export interface SetupFields {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

/** A failed request: the NET code, "service" for an error the daemon sent,
 *  "setup" when Reddit refuses this address and an app of the owner's would
 *  be read through instead, "protocol" for an answer not in the expected
 *  shape. */
export class RedditError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  url: string;
  /** JSON goes ahead of pictures. */
  rank: "json" | "picture";
  /** The post this picture is for, so a scrolled-past request can be dropped; "" for JSON. */
  picture: string;
  method?: "POST";
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  resolve: (response: PocketResponse) => void;
  reject: (error: RedditError) => void;
}

export interface RedditClient {
  feed(sub: string, sort: Sort, after: string): Promise<FeedPage>;
  thread(id: string): Promise<Thread>;
  subs(query: string): Promise<Subreddit[]>;
  setup(): Promise<SetupState>;
  /** Try the app on this device; resolves with the service's message. */
  connect(fields: SetupFields): Promise<string>;
  forget(): Promise<void>;
  loadSaved(): Promise<Saved | null>;
  save(saved: Saved): Promise<void>;
  /** The thumbnail's texture key for an Image, or "" while it is on its way. */
  thumb(id: string): string;
  /** The preview's texture key, or "" while it is on its way. */
  image(id: string): string;
  /** Drop the queued (not started) picture requests for posts outside `keep`. */
  prunePictures(keep: ReadonlySet<string>): void;
  /** Bumps when a picture's texture arrives. */
  pictures: () => number;
  inflight(): number;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function parsePost(entry: unknown): Post | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const id = str(e.id);
  if (!id) return null;
  return {
    id,
    title: str(e.title),
    author: str(e.author),
    sub: str(e.sub),
    score: num(e.score),
    comments: num(e.comments),
    created: num(e.created),
    url: str(e.url),
    domain: str(e.domain),
    isSelf: e.isSelf === true,
    selftext: str(e.selftext),
    thumb: e.thumb === true,
    preview: typeof e.preview === "string" && e.preview ? e.preview : null,
  };
}

export function parseComment(entry: unknown): Comment | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const id = str(e.id);
  if (!id) return null;
  return { id, depth: Math.max(0, Math.floor(num(e.depth))), author: str(e.author), score: num(e.score), created: num(e.created), body: str(e.body) };
}

export function parseSaved(value: unknown): Saved | null {
  if (!value || typeof value !== "object") return null;
  const subs = (value as { subs?: unknown }).subs;
  if (!Array.isArray(subs)) return { subs: [] };
  const out: string[] = [];
  for (const name of subs) if (typeof name === "string" && /^[A-Za-z0-9_]{1,24}$/.test(name) && !out.includes(name)) out.push(name);
  return { subs: out };
}

interface Picture {
  key: string;
  handle: number;
  shown: number;
}

export function createRedditClient(): RedditClient {
  const queue: Task[] = [];
  let running = 0;
  const [pictures, setPictures] = createSignal(0);
  const thumbs = new Map<string, Picture>();
  const images = new Map<string, Picture>();
  const asked = new Set<string>();
  let clock = 0;
  let nextKey = 0;

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      fetch(task.url, {
        timeoutMs: task.timeoutMs,
        maxBytes: task.maxBytes,
        ...(task.method ? { method: task.method, headers: { "content-type": "application/json" }, body: task.body ?? "" } : {}),
      }).then(
        async (response) => {
          running--;
          if (response.ok) task.resolve(response);
          else {
            let message = `${theComputer()} answered ${response.status}.`;
            let code = "service";
            try {
              const body = JSON.parse(await response.text()) as { error?: string; message?: string; setup?: string };
              if (body.error) message = body.error;
              else if (body.message) message = body.message;
              if (body.setup) code = "setup";
            } catch {
              // Not JSON: keep the status.
            }
            task.reject(new RedditError(code, message));
          }
          pump();
        },
        (error: unknown) => {
          running--;
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new RedditError(code, error instanceof Error ? error.message : String(error)));
          pump();
        },
      );
    }
  };

  const request = (url: string, options: { rank: Task["rank"]; picture?: string; body?: string; timeoutMs?: number; maxBytes?: number }) =>
    new Promise<PocketResponse>((resolve, reject) => {
      const task: Task = {
        url,
        rank: options.rank,
        picture: options.picture ?? "",
        ...(options.body !== undefined ? { method: "POST" as const, body: options.body } : {}),
        timeoutMs: options.timeoutMs ?? 30_000,
        maxBytes: options.maxBytes ?? 512 * 1024,
        resolve,
        reject,
      };
      // JSON behind the queued JSON, ahead of the pictures.
      const at = task.rank === "json" ? queue.findIndex((queued) => queued.rank === "picture") : -1;
      queue.splice(at < 0 ? queue.length : at, 0, task);
      pump();
    });

  const json = async <T>(url: string, options: { body?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<T> => {
    const response = await request(url, { rank: "json", ...options });
    try {
      return JSON.parse(await response.text()) as T;
    } catch {
      throw new RedditError("protocol", "The answer was not JSON.");
    }
  };

  /** Ask for a picture once; its texture registers under a key of its own. */
  const picture = (held: Map<string, Picture>, limit: number, id: string, path: string, side: number, prefix: string): string => {
    const have = held.get(id);
    if (have) {
      have.shown = ++clock;
      return have.key;
    }
    const mark = `${prefix}:${id}`;
    if (!asked.has(mark)) {
      asked.add(mark);
      request(companionService("reddit", `${path}?id=${id}`), { rank: "picture", picture: id, timeoutMs: 40_000, maxBytes: 8 + side * side * 2 + 1024 }).then(
        async (response) => {
          const ops = getOps();
          const handle = ops.uploadImgEntry ? ops.uploadImgEntry(await response.bytes()) : -1;
          if (handle < 0) return;
          if (held.size >= limit) {
            let oldest: [string, Picture] | null = null;
            for (const entry of held) if (!oldest || entry[1].shown < oldest[1].shown) oldest = entry;
            if (oldest) {
              held.delete(oldest[0]);
              asked.delete(`${prefix}:${oldest[0]}`);
              ops.freeTexture?.(oldest[1].handle);
            }
          }
          const key = `reddit.${prefix}.${nextKey++}`;
          registerTexture(key, handle);
          held.set(id, { key, handle, shown: ++clock });
          setPictures(pictures() + 1);
        },
        () => {
          // A dropped or failed picture may be asked for again when it shows.
          asked.delete(mark);
        },
      );
    }
    return "";
  };

  return {
    feed: async (sub, sort, after) => {
      const value = await json<{ items?: unknown[]; after?: unknown }>(
        companionService("reddit", `/feed?sub=${encodeURIComponent(sub)}&sort=${sort}${after ? `&after=${encodeURIComponent(after)}` : ""}`),
        { timeoutMs: 40_000 },
      );
      const items: Post[] = [];
      for (const entry of Array.isArray(value.items) ? value.items : []) {
        const post = parsePost(entry);
        if (post) items.push(post);
      }
      return { items, after: str(value.after) };
    },
    thread: async (id) => {
      const value = await json<{ post?: unknown; comments?: unknown[] }>(companionService("reddit", `/post?id=${id}`), { timeoutMs: 40_000, maxBytes: NET_MAX_RESPONSE_BYTES });
      const post = parsePost(value.post);
      if (!post) throw new RedditError("protocol", "The post did not come back.");
      const comments: Comment[] = [];
      for (const entry of Array.isArray(value.comments) ? value.comments : []) {
        const comment = parseComment(entry);
        if (comment) comments.push(comment);
      }
      return { post, comments };
    },
    subs: async (query) => {
      const value = await json<{ items?: unknown[] }>(companionService("reddit", `/subs?q=${encodeURIComponent(query)}`), { timeoutMs: 30_000, maxBytes: 128 * 1024 });
      const out: Subreddit[] = [];
      for (const entry of Array.isArray(value.items) ? value.items : []) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const name = str(e.name);
        if (name) out.push({ name, title: str(e.title), subscribers: num(e.subscribers), description: str(e.description) });
      }
      return out;
    },
    setup: async () => {
      const value = await json<Partial<SetupState>>(companionService("reddit", "/setup"), { timeoutMs: 10_000, maxBytes: 4096 });
      const mode = value.mode === "app" || value.mode === "account" ? value.mode : "none";
      return { ready: value.ready === true, mode };
    },
    connect: async (fields) => {
      const value = await json<{ ok?: boolean; message?: string }>(companionService("reddit", "/setup"), { body: JSON.stringify(fields), timeoutMs: 40_000, maxBytes: 4096 });
      return value.message ?? "Connected.";
    },
    forget: async () => {
      await json<{ ok?: boolean }>(companionService("reddit", "/forget"), { body: "{}", timeoutMs: 10_000, maxBytes: 4096 });
    },
    loadSaved: async () => {
      const value = await json<{ value?: unknown }>(companionService("store", `/get?name=${STORE_NAME}`), { timeoutMs: 10_000, maxBytes: 64 * 1024 });
      return parseSaved(value.value);
    },
    save: async (saved) => {
      const value = await json<{ ok?: unknown }>(companionService("store", `/set?name=${STORE_NAME}`), { body: JSON.stringify(saved), timeoutMs: 10_000, maxBytes: 4096 });
      if (value.ok !== true) throw new RedditError("protocol", "The store did not confirm the save.");
    },
    thumb: (id) => picture(thumbs, THUMB_TEXTURES, id, "/thumb", THUMB.texture, "thumb"),
    image: (id) => picture(images, IMAGE_TEXTURES, id, "/image", IMAGE.texture, "image"),
    prunePictures(keep) {
      for (let index = queue.length - 1; index >= 0; index--) {
        const task = queue[index]!;
        if (!task.picture || keep.has(task.picture)) continue;
        queue.splice(index, 1);
        task.reject(new RedditError("cancelled", "the picture left the view"));
      }
    },
    pictures,
    inflight: () => running,
  };
}

/** The message a reader sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof RedditError ? error.code : "";
  if (code === "unavailable") return notLinked("Reddit");
  if (code === "setup") return { title: "Reddit needs an app", detail: error instanceof Error && error.message ? error.message : "Enter an app's client id in Setup." };
  if (code === "timeout") return { title: "The request timed out", detail: `${theComputer()} or Reddit did not answer in time.` };
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load", detail: message || "The request failed." };
}

/** "1.2k" for a count. */
export function countText(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(count));
}

/** "3h" since `unixSeconds`, as the list reads it. */
export function ageText(unixSeconds: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  if (seconds < 86400 * 365) return `${Math.floor(seconds / (86400 * 30))}mo`;
  return `${Math.floor(seconds / (86400 * 365))}y`;
}
