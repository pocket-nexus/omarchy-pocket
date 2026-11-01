// SPDX-License-Identifier: GPL-3.0-or-later
// applets/reddit/model.ts — what Reddit shows: the feed of one subreddit
// under a sort, paged by `after`; the post that is open with its comments;
// the subreddit search; and the subreddits the reader keeps, from the
// companion's store. Signals over the API client.
//
// A feed is keyed by subreddit and sort and kept while the reader is away
// from it (Hot, then New, then back to Hot shows the page that was there);
// Reload asks again. Threads are kept by post id, THREADS of them. Every
// change to the kept subreddits is written back to the store in order.

import { createSignal, type Accessor } from "solid-js";
import { errorText, HOME_SUB, RedditError, type Post, type RedditClient, type Saved, type SetupFields, type SetupState, type Sort, type Subreddit, type Thread } from "./api.ts";

/** Threads kept, by post id. */
export const THREADS = 12;

export interface Trouble {
  title: string;
  detail: string;
}

export interface FeedState {
  status: "idle" | "loading" | "ready" | "error";
  items: readonly Post[];
  after: string;
  /** A next page is on its way. */
  paging: boolean;
  error: Trouble | null;
  /** The error is Reddit refusing this address: an app of the owner's would be read through. */
  needsSetup: boolean;
}

export interface ThreadState {
  status: "loading" | "ready" | "error";
  thread: Thread | null;
  error: Trouble | null;
}

export interface SubsSearch {
  status: "idle" | "loading" | "ready" | "error";
  query: string;
  results: readonly Subreddit[];
  error: Trouble | null;
}

export interface RedditModel {
  client: RedditClient;
  sub: Accessor<string>;
  sort: Accessor<Sort>;
  setSub(sub: string): void;
  setSort(sort: Sort): void;
  feed: Accessor<FeedState>;
  reload(): void;
  /** The next page, once the feed is ready and has an `after`. */
  more(): void;
  /** The open post's id. */
  current: Accessor<string>;
  /** The post as the feed listed it, for the header before the thread lands. */
  listed(id: string): Post | undefined;
  open(post: Post): void;
  thread(id: string): ThreadState | undefined;
  reloadThread(): void;
  /** The store's state: "loading" until it answered. */
  store: Accessor<"loading" | "ready" | "error">;
  storeError: Accessor<Trouble | null>;
  /** The subreddits kept, HOME_SUB first. */
  subs: Accessor<readonly string[]>;
  keep(name: string): void;
  drop(name: string): void;
  search: Accessor<SubsSearch>;
  setQuery(query: string): void;
  clearSearch(): void;
  /** Open the keyboard for the search words (set by the app). */
  editQuery(): void;
  /** Bumps when a feed's or thread's rows change. */
  version: Accessor<number>;
  /** The app set up on this device; null until the service answered. */
  setup: Accessor<SetupState | null>;
  checkSetup(force?: boolean): void;
  connecting: Accessor<boolean>;
  /** Try the fields on this device; resolves with "" or the message to show. */
  connect(fields: SetupFields): Promise<string>;
  /** Delete the setup from this device; resolves with "" or the message to show. */
  forgetSetup(): Promise<string>;
}

const EMPTY_FEED: FeedState = { status: "idle", items: [], after: "", paging: false, error: null, needsSetup: false };
const IDLE_SEARCH: SubsSearch = { status: "idle", query: "", results: [], error: null };

export function createRedditModel(client: RedditClient, options: { editQuery: () => void }): RedditModel {
  const [sub, setSubSignal] = createSignal(HOME_SUB);
  const [sort, setSortSignal] = createSignal<Sort>("hot");
  const [feeds, setFeeds] = createSignal<ReadonlyMap<string, FeedState>>(new Map());
  const [current, setCurrent] = createSignal("");
  const [threads, setThreads] = createSignal<ReadonlyMap<string, ThreadState>>(new Map());
  const [store, setStore] = createSignal<"loading" | "ready" | "error">("loading");
  const [storeError, setStoreError] = createSignal<Trouble | null>(null);
  const [subs, setSubs] = createSignal<readonly string[]>([HOME_SUB]);
  const [search, setSearch] = createSignal<SubsSearch>(IDLE_SEARCH);
  const [version, setVersion] = createSignal(0);
  const [setup, setSetup] = createSignal<SetupState | null>(null);
  const [connecting, setConnecting] = createSignal(false);
  let checked = false;
  const posts = new Map<string, Post>();
  const feedRuns = new Map<string, number>();
  const threadRuns = new Map<string, number>();
  let searchRun = 0;
  let saving: Promise<void> = Promise.resolve();

  const feedKey = () => `${sub()}/${sort()}`;
  const feedOf = (key: string) => feeds().get(key) ?? EMPTY_FEED;
  const putFeed = (key: string, state: FeedState) => {
    const next = new Map(feeds());
    next.set(key, state);
    setFeeds(next);
    setVersion(version() + 1);
  };
  const putThread = (id: string, state: ThreadState) => {
    const next = new Map(threads());
    next.delete(id);
    next.set(id, state);
    while (next.size > THREADS) {
      const oldest = next.keys().next().value as string;
      if (oldest === id) break;
      next.delete(oldest);
      threadRuns.delete(oldest);
    }
    setThreads(next);
    setVersion(version() + 1);
  };

  const load = (key: string, name: string, order: Sort, after: string) => {
    const run = (feedRuns.get(key) ?? 0) + 1;
    feedRuns.set(key, run);
    const have = feedOf(key);
    putFeed(key, after ? { ...have, paging: true } : { status: "loading", items: have.status === "ready" ? have.items : [], after: "", paging: false, error: null, needsSetup: false });
    client.feed(name, order, after).then(
      (page) => {
        if (feedRuns.get(key) !== run) return;
        for (const post of page.items) posts.set(post.id, post);
        const before = after ? feedOf(key).items : [];
        const seen = new Set(before.map((post) => post.id));
        const items = [...before, ...page.items.filter((post) => !seen.has(post.id))];
        putFeed(key, { status: "ready", items, after: page.items.length ? page.after : "", paging: false, error: null, needsSetup: false });
      },
      (error: unknown) => {
        if (feedRuns.get(key) !== run) return;
        const have = feedOf(key);
        if (after) putFeed(key, { ...have, paging: false, after: "" });
        else putFeed(key, { status: "error", items: [], after: "", paging: false, error: errorText(error), needsSetup: error instanceof RedditError && error.code === "setup" });
      },
    );
  };

  const show = () => {
    const key = feedKey();
    if (feedOf(key).status === "idle") load(key, sub(), sort(), "");
  };

  const loadThread = (id: string) => {
    const run = (threadRuns.get(id) ?? 0) + 1;
    threadRuns.set(id, run);
    const have = threads().get(id);
    putThread(id, { status: "loading", thread: have?.thread ?? null, error: null });
    client.thread(id).then(
      (thread) => {
        if (threadRuns.get(id) !== run) return;
        posts.set(thread.post.id, thread.post);
        putThread(id, { status: "ready", thread, error: null });
      },
      (error: unknown) => {
        if (threadRuns.get(id) !== run) return;
        putThread(id, { status: "error", thread: have?.thread ?? null, error: errorText(error) });
      },
    );
  };

  const persist = () => {
    if (store() !== "ready") return;
    const saved: Saved = { subs: subs().filter((name) => name !== HOME_SUB) };
    saving = saving
      .then(() => client.save(saved))
      .then(
        () => {
          setStoreError(null);
        },
        (error: unknown) => {
          setStoreError(errorText(error));
        },
      );
  };

  client.loadSaved().then(
    (saved) => {
      const mine = subs().filter((name) => name !== HOME_SUB && !(saved?.subs ?? []).includes(name));
      setSubs([HOME_SUB, ...(saved?.subs ?? []), ...mine]);
      setStore("ready");
      if (mine.length) persist();
    },
    (error: unknown) => {
      setStore("error");
      setStoreError(errorText(error));
    },
  );

  const model: RedditModel = {
    client,
    sub,
    sort,
    setSub(name) {
      setSubSignal(name);
      show();
    },
    setSort(order) {
      setSortSignal(order);
      show();
    },
    feed: () => feedOf(feedKey()),
    reload: () => load(feedKey(), sub(), sort(), ""),
    more() {
      const key = feedKey();
      const state = feedOf(key);
      if (state.status !== "ready" || state.paging || !state.after) return;
      load(key, sub(), sort(), state.after);
    },
    current,
    listed: (id) => posts.get(id),
    open(post) {
      posts.set(post.id, post);
      setCurrent(post.id);
      const have = threads().get(post.id);
      if (!have || have.status === "error") loadThread(post.id);
    },
    thread: (id) => threads().get(id),
    reloadThread() {
      if (current()) loadThread(current());
    },
    store,
    storeError,
    subs,
    keep(name) {
      if (subs().includes(name)) return;
      setSubs([...subs(), name]);
      persist();
    },
    drop(name) {
      if (name === HOME_SUB || !subs().includes(name)) return;
      setSubs(subs().filter((kept) => kept !== name));
      if (sub() === name) model.setSub(HOME_SUB);
      persist();
    },
    search,
    setQuery(query) {
      const words = query.trim();
      const run = ++searchRun;
      if (!words) {
        setSearch(IDLE_SEARCH);
        return;
      }
      setSearch({ status: "loading", query: words, results: [], error: null });
      client.subs(words).then(
        (results) => {
          if (run === searchRun) setSearch({ status: "ready", query: words, results, error: null });
        },
        (error: unknown) => {
          if (run === searchRun) setSearch({ status: "error", query: words, results: [], error: errorText(error) });
        },
      );
    },
    clearSearch() {
      searchRun++;
      setSearch(IDLE_SEARCH);
    },
    editQuery: () => options.editQuery(),
    version,
    setup,
    checkSetup(force = false) {
      if (checked && !force) return;
      checked = true;
      client.setup().then(
        (state) => setSetup(state),
        () => {
          checked = false;
        },
      );
    },
    connecting,
    async connect(fields) {
      if (connecting()) return "";
      setConnecting(true);
      try {
        await client.connect(fields);
        setSetup({ ready: true, mode: fields.username ? "account" : "app" });
        // Every kept page was read without the app; the open feed reloads through it.
        setFeeds(new Map());
        setThreads(new Map());
        show();
        return "";
      } catch (error) {
        return errorText(error).detail;
      } finally {
        setConnecting(false);
      }
    },
    async forgetSetup() {
      try {
        await client.forget();
        setSetup({ ready: false, mode: "none" });
        setFeeds(new Map());
        setThreads(new Map());
        show();
        return "";
      } catch (error) {
        return errorText(error).detail;
      }
    },
  };
  show();
  return model;
}
