// The spotify service: what vendor/applets/spotify/contract.ts lists, for the
// Spotify applet. It holds the sign-in, asks the Web API, and runs librespot
// as this device's Spotify Connect speaker.
//
// Sign-in. Spotify's Web API takes a token of an app the owner registers
// (Development Mode: the app's owner needs Premium; its Client ID is set here
// with POST /config, kept in config.json). The device has no browser, so
// POST /signin makes a PKCE verifier and a state, and answers Spotify's
// authorize URL for the applet to show as a QR code; its redirect URI is the
// store's OAuth relay (applets.pocket.nexus/oauth/spotify), which keeps the
// code the phone brings back until this service takes it
// (GET /v1/oauth/spotify/<state>, polled every 2 s for ten minutes). The code
// and the verifier make the refresh token, kept in token.json (mode 600)
// under <storeDir>/services/spotify/; the applet never sees a token.
//
// The speaker. librespot (the `librespot` package) plays to PipeWire through
// its PulseAudio backend under the name SPEAKER_NAME. Its first start signs
// in with the Web API token (it holds the `streaming` scope); from then on it
// signs in with the credentials it keeps in librespot/credentials.json. If
// Spotify refuses the token, it starts with none and waits: picking the
// speaker once in Spotify on a phone signs it in (Spotify Connect's zeroconf).
// Its log tells the state: "Authenticated as" is ready. It is restarted when
// it exits, a second later, then at most every 30 s.
//
// The Web API's answers are cached for a few seconds to a few minutes
// (CACHE_MS), and a command clears the player's. A 401 refreshes the token
// and asks once more.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonResponse, readJson, ServiceError, type ServiceContext, type ServiceProvider, type ServiceRequest } from "../vendor/pocketjs/tools/companion/services.ts";
import type { AlbumPage, ArtistPage, Failure, Home, Item, Page, Player, PlaylistPage, Status } from "../vendor/applets/spotify/contract.ts";
import * as map from "./spotify-map.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const SPEAKER_NAME = "Omarchy Pocket";
const SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-top-read",
  "user-library-read",
  "user-library-modify",
  "user-follow-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "streaming",
];
const SIGNIN_MS = 10 * 60_000;
const RELAY_POLL_MS = 2_000;
const CLIENT_ID = /^[0-9a-f]{32}$/;
const CACHE_MS = { home: 60_000, library: 60_000, page: 300_000, search: 120_000, player: 1_000, devices: 3_000, queue: 2_000, liked: 30_000 } as const;
const LIST = 30;

export interface SpotifyOptions {
  accounts?: string;
  api?: string;
  /** the OAuth relay's origin */
  relay?: string;
  /** librespot's program; null runs no speaker (tests) */
  librespot?: string | null;
  now?: () => number;
  /** how long after a command the player is read again, for Spotify to catch up */
  settleMs?: number;
}

class SpotifyError extends Error {
  constructor(readonly status: number, readonly failure: Failure) {
    super(failure.error);
  }
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fail = (status: number, error: string, reason: Failure["reason"] = "other") => new SpotifyError(status, { error, reason });

interface Token {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
}

/** librespot under supervision: started, watched through its log, restarted. */
class Speaker {
  state: Status["speaker"]["state"] = "off";
  message = "";
  private child: ReturnType<typeof Bun.spawn> | null = null;
  private wanted = false;
  private token: string | null = null;
  private backoff = 1_000;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly program: string | null, private readonly cache: string, private readonly log: (line: string) => void) {}

  get signedIn() {
    return existsSync(join(this.cache, "credentials.json"));
  }

  /** Run it, signing in with `token` when it holds no credentials yet. */
  start(token: string | null) {
    this.wanted = true;
    this.token = this.signedIn ? null : token;
    if (!this.child && !this.timer) this.spawn();
  }

  stop(forget = false) {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child?.kill();
    this.child = null;
    this.state = "off";
    this.message = "";
    if (forget) rmSync(this.cache, { recursive: true, force: true });
  }

  private spawn() {
    this.timer = null;
    if (!this.program || !this.wanted) return;
    mkdirSync(this.cache, { recursive: true, mode: 0o700 });
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";
    const argv = [
      this.program,
      "--name", SPEAKER_NAME,
      "--device-type", "gameconsole",
      "--backend", "pulseaudio",
      "--bitrate", "320",
      "--initial-volume", "80",
      "--system-cache", this.cache,
      "--disable-audio-cache",
      "--quiet",
      ...(proxy ? ["--proxy", proxy] : []),
      ...(this.token ? ["--access-token", this.token] : []),
    ];
    const usedToken = this.token !== null;
    this.state = "starting";
    this.message = "";
    let authenticated = false;
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    this.child = child;
    const watch = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of stream) {
        rest += decoder.decode(chunk, { stream: true });
        let at: number;
        while ((at = rest.indexOf("\n")) >= 0) {
          const line = rest.slice(0, at).trim();
          rest = rest.slice(at + 1);
          if (!line) continue;
          if (/Authenticated as/.test(line)) {
            authenticated = true;
            this.state = "ready";
            this.message = "";
            this.backoff = 1_000;
          } else if (/ERROR|WARN/.test(line)) {
            this.log(`librespot: ${line.slice(0, 200)}`);
            if (!authenticated) this.message = line.replace(/^\[[^\]]*\]\s*/, "").slice(0, 160);
          }
        }
      }
    };
    void watch(child.stdout as ReadableStream<Uint8Array>);
    void watch(child.stderr as ReadableStream<Uint8Array>);
    // waiting for a phone to pick it: running, and not signed in a moment later
    setTimeout(() => {
      if (this.child === child && !authenticated && !usedToken) this.state = "waiting";
    }, 3_000);
    void child.exited.then((code) => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.wanted) return;
      // a token Spotify would not take: start again with none, for the phone to sign it in
      if (usedToken && !authenticated) this.token = null;
      this.state = "error";
      this.message ||= `librespot stopped (${code})`;
      this.timer = setTimeout(() => this.spawn(), this.backoff);
      this.backoff = Math.min(30_000, this.backoff * 2);
    });
  }
}

export function createSpotifyService(context: ServiceContext, options: SpotifyOptions = {}): ServiceProvider {
  const accounts = options.accounts ?? "https://accounts.spotify.com";
  const api = options.api ?? "https://api.spotify.com/v1";
  const relay = options.relay ?? "https://applets.pocket.nexus";
  const redirectUri = `${relay}/oauth/spotify`;
  const now = options.now ?? Date.now;
  const settleMs = options.settleMs ?? 450;
  const dir = join(context.storeDir, "services", "spotify");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const configFile = join(dir, "config.json");
  const tokenFile = join(dir, "token.json");
  const speaker = new Speaker(options.librespot === undefined ? Bun.which("librespot") : options.librespot, join(dir, "librespot"), context.log);

  const readFile = <T>(file: string): T | null => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  };
  const writeSecret = (file: string, value: unknown) => {
    writeFileSync(`${file}.new`, JSON.stringify(value), { mode: 0o600 });
    renameSync(`${file}.new`, file);
  };

  let clientId: string = readFile<{ clientId?: string }>(configFile)?.clientId ?? process.env.OMARCHY_POCKET_SPOTIFY_CLIENT_ID ?? "";
  let token: Token | null = readFile<Token>(tokenFile);
  let user: Status["user"] = null;
  let error = "";
  let pending: { verifier: string; state: string; url: string; expiresAt: number; timer: ReturnType<typeof setInterval> } | null = null;
  const cache = new Map<string, { at: number; value: unknown }>();
  /** this device's speaker as the Web API lists it */
  let speakerId: string | null = null;

  /* ---------- tokens ---------- */

  async function tokenRequest(form: Record<string, string>): Promise<Token> {
    const response = await fetch(`${accounts}/api/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...form, client_id: clientId }),
      signal: AbortSignal.timeout(20_000),
    });
    const body: Json = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.access_token !== "string") {
      throw fail(401, `Spotify refused the sign-in: ${body.error_description ?? body.error ?? response.status}`, "signin");
    }
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : (token?.refreshToken ?? ""),
      expiresAt: now() + (Number(body.expires_in) || 3600) * 1000,
      scope: typeof body.scope === "string" ? body.scope : (token?.scope ?? ""),
    };
  }

  let refreshing: Promise<string> | null = null;
  async function accessToken(force = false): Promise<string> {
    if (!clientId) throw fail(409, "Spotify needs your app's Client ID.", "configure");
    if (!token?.refreshToken) throw fail(401, "Sign in to Spotify.", "signin");
    if (!force && token.accessToken && token.expiresAt - now() > 60_000) return token.accessToken;
    refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: token.refreshToken })
      .then((next) => {
        token = next;
        writeSecret(tokenFile, token);
        return next.accessToken;
      })
      .catch((cause) => {
        // a refresh token Spotify no longer takes: the owner signs in again
        if (cause instanceof SpotifyError) {
          token = null;
          rmSync(tokenFile, { force: true });
          error = cause.failure.error;
        }
        throw cause;
      })
      .finally(() => (refreshing = null));
    return refreshing;
  }

  /* ---------- the Web API ---------- */

  async function web(method: string, path: string, body?: unknown, retried = false): Promise<Json> {
    const bearer = await accessToken();
    const response = await fetch(`${api}${path}`, {
      method,
      headers: { authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? (method === "PUT" || method === "POST" ? "" : undefined) : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401 && !retried) {
      await accessToken(true);
      return web(method, path, body, true);
    }
    const text = await response.text();
    const json: Json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const failure = map.failure(response.status, json);
      if (response.status === 429) failure.error = `Spotify asked to wait ${response.headers.get("retry-after") ?? "a moment"} s.`;
      throw new SpotifyError(response.status, failure);
    }
    return json;
  }

  async function cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ms) return hit.value as T;
    const value = await load();
    cache.set(key, { at: now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return value;
  }
  const forgetPlayer = () => {
    for (const key of cache.keys()) if (key.startsWith("player") || key.startsWith("queue") || key.startsWith("devices")) cache.delete(key);
  };

  async function me(): Promise<NonNullable<Status["user"]>> {
    if (user) return user;
    const m = await web("GET", "/me");
    user = { id: String(m.id ?? ""), name: String(m.display_name ?? m.id ?? ""), image: map.cover(m.images) };
    return user;
  }

  /* ---------- sign-in ---------- */

  function status(): Status {
    if (pending && now() > pending.expiresAt) cancelSignIn("The sign-in expired. Start it again.");
    return {
      configured: clientId !== "",
      signedIn: token !== null && token.refreshToken !== "",
      user,
      signIn: pending ? { url: pending.url, expiresAt: pending.expiresAt } : null,
      error,
      speaker: { name: SPEAKER_NAME, state: speaker.state, id: speakerId, message: speaker.message },
    };
  }

  function cancelSignIn(why = "") {
    if (pending) clearInterval(pending.timer);
    pending = null;
    if (why) error = why;
  }

  async function finishSignIn(code: string, verifier: string) {
    token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
    writeSecret(tokenFile, token);
    user = null;
    error = "";
    cache.clear();
    await me().catch(() => undefined);
    speaker.start(token.scope.includes("streaming") ? token.accessToken : null);
  }

  function startSignIn() {
    if (!clientId) throw fail(409, "Set your app's Client ID first.", "configure");
    cancelSignIn();
    const verifier = b64url(randomBytes(64));
    const state = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const url = `${accounts}/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
      scope: SCOPES.join(" "),
    })}`;
    error = "";
    let asking = false;
    const timer = setInterval(async () => {
      if (!pending || pending.state !== state || asking) return;
      if (now() > pending.expiresAt) return cancelSignIn("The sign-in expired. Start it again.");
      asking = true;
      try {
        const response = await fetch(`${relay}/v1/oauth/spotify/${state}`, { signal: AbortSignal.timeout(10_000) });
        if (response.status !== 200) return;
        const answer: { code?: string; error?: string } = await response.json();
        const mine = pending;
        cancelSignIn();
        if (answer.error || !answer.code) {
          error = answer.error === "access_denied" ? "Access was not allowed." : `Spotify did not sign in: ${answer.error ?? "no code"}`;
          return;
        }
        await finishSignIn(answer.code, mine!.verifier).catch((cause) => (error = cause instanceof Error ? cause.message : String(cause)));
      } catch {
        // the relay out of reach for a moment: ask again at the next tick
      } finally {
        asking = false;
      }
    }, RELAY_POLL_MS);
    pending = { verifier, state, url, expiresAt: now() + SIGNIN_MS, timer };
  }

  function signOut() {
    cancelSignIn();
    token = null;
    user = null;
    error = "";
    speakerId = null;
    cache.clear();
    rmSync(tokenFile, { force: true });
    speaker.stop(true);
  }

  /* ---------- the speaker's Connect id ---------- */

  async function devices() {
    const list = await cached("devices", CACHE_MS.devices, async () => {
      const answer = await web("GET", "/me/player/devices");
      return (Array.isArray(answer?.devices) ? answer.devices : []).map((d: Json) => map.device(d, SPEAKER_NAME));
    });
    speakerId = list.find((d: { local: boolean }) => d.local)?.id ?? speakerId;
    // the local speaker first
    return [...list].sort((a: { local: boolean }, b: { local: boolean }) => Number(b.local) - Number(a.local));
  }

  /* ---------- answers ---------- */

  const likedSet = async (uris: string[]): Promise<boolean[]> => {
    if (!uris.length) return [];
    const key = `liked:${uris.join(",")}`;
    return cached(key, CACHE_MS.liked, async () => {
      const answer = await web("GET", `/me/library/contains?uris=${encodeURIComponent(uris.join(","))}`);
      return Array.isArray(answer) ? answer.map((v) => v === true) : uris.map(() => false);
    });
  };

  async function playerNow(fresh = false): Promise<Player> {
    if (fresh) forgetPlayer();
    return cached("player", CACHE_MS.player, async () => {
      const p = await web("GET", "/me/player?additional_types=episode");
      const uri = p?.item?.uri;
      const liked = uri ? ((await likedSet([uri]).catch(() => [false]))[0] ?? false) : false;
      let title = "";
      const context = p?.context;
      if (context?.uri) title = await contextTitle(context.uri).catch(() => "");
      const out = map.player(p, SPEAKER_NAME, now(), liked, title);
      if (out.device?.local) speakerId = out.device.id;
      return out;
    });
  }

  async function contextTitle(uri: string): Promise<string> {
    return cached(`title:${uri}`, CACHE_MS.page, async () => {
      const [, kind, id] = uri.split(":");
      if (uri.endsWith(":collection")) return "Liked Songs";
      if (kind === "album") return String((await web("GET", `/albums/${id}`))?.name ?? "");
      if (kind === "playlist") return String((await web("GET", `/playlists/${id}?fields=name`))?.name ?? "");
      if (kind === "artist") return String((await web("GET", `/artists/${id}`))?.name ?? "");
      return "";
    });
  }

  async function home(): Promise<Home> {
    return cached("home", CACHE_MS.home, async () => {
      const u = await me();
      const [recent, lists, albums, artists, likedTotal] = await Promise.all([
        web("GET", "/me/player/recently-played?limit=40").catch(() => null),
        web("GET", "/me/playlists?limit=20").catch(() => null),
        web("GET", "/me/albums?limit=12").catch(() => null),
        web("GET", "/me/following?type=artist&limit=12").catch(() => web("GET", "/me/top/artists?limit=12").catch(() => null)),
        web("GET", "/me/tracks?limit=1").catch(() => null),
      ]);
      const seen = new Set<string>();
      const recentItems: Item[] = [];
      for (const played of Array.isArray(recent?.items) ? recent.items : []) {
        if (recentItems.length >= 12) break;
        const contextUri: string = played?.context?.uri ?? "";
        const key = contextUri || played?.track?.uri;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        let item: Item | null = null;
        if (contextUri.startsWith("spotify:album:")) item = map.album(played.track?.album);
        else if (contextUri.startsWith("spotify:playlist:")) item = await cached(`playlist-item:${contextUri}`, CACHE_MS.page, async () => map.playlist(await web("GET", `/playlists/${contextUri.split(":")[2]}?fields=id,uri,name,images,owner(display_name)`))).catch(() => null);
        else if (contextUri.startsWith("spotify:artist:")) item = await cached(`artist-item:${contextUri}`, CACHE_MS.page, async () => map.artist(await web("GET", `/artists/${contextUri.split(":")[2]}`))).catch(() => null);
        else if (contextUri.endsWith(":collection")) item = map.liked(u.id, likedTotal?.total ?? null);
        item ??= map.track(played?.track);
        if (item) recentItems.push(item);
      }
      const artistList = artists?.artists ?? artists;
      return {
        recent: recentItems,
        playlists: [map.liked(u.id, likedTotal?.total ?? null), ...map.page(lists, 0, map.playlist).items],
        albums: map.page(albums, 0, (e) => map.album(e?.album)).items,
        artists: map.page(artistList, 0, map.artist).items,
      };
    });
  }

  async function library(shelf: string, next: string | null): Promise<Page> {
    const { offset, after } = map.readToken(next);
    return cached(`library:${shelf}:${next}`, CACHE_MS.library, async () => {
      if (shelf === "playlists") {
        const u = await me();
        const answer = await web("GET", `/me/playlists?limit=${LIST}&offset=${offset}`);
        const out = map.page(answer, offset, map.playlist);
        if (offset === 0) {
          const total = (await web("GET", "/me/tracks?limit=1").catch(() => null))?.total ?? null;
          out.items.unshift(map.liked(u.id, total));
        }
        return out;
      }
      if (shelf === "albums") return map.page(await web("GET", `/me/albums?limit=${LIST}&offset=${offset}`), offset, (e) => map.album(e?.album));
      if (shelf === "tracks") return map.page(await web("GET", `/me/tracks?limit=${LIST}&offset=${offset}`), offset, map.entryTrack);
      if (shelf === "artists") {
        const answer = await web("GET", `/me/following?type=artist&limit=${LIST}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        return map.page(answer?.artists, 0, map.artist);
      }
      throw fail(404, `no shelf ${shelf}`);
    });
  }

  async function search(q: string, type: string, next: string | null): Promise<Page> {
    if (!q.trim()) return { items: [], total: 0, next: null };
    if (!["track", "album", "artist", "playlist"].includes(type)) throw fail(400, `no search type ${type}`);
    const { offset } = map.readToken(next);
    return cached(`search:${type}:${q}:${offset}`, CACHE_MS.search, async () => {
      // ten a page: Spotify's limit for apps since 2026
      const answer = await web("GET", `/search?${new URLSearchParams({ q, type, limit: "10", offset: String(offset) })}`);
      const fn = type === "track" ? map.track : type === "album" ? map.album : type === "artist" ? map.artist : map.playlist;
      return map.page(answer?.[`${type}s`], offset, fn);
    });
  }

  async function albumPage(id: string): Promise<AlbumPage> {
    return cached(`album:${id}`, CACHE_MS.page, async () => {
      const a = await web("GET", `/albums/${encodeURIComponent(id)}`);
      const item = map.album(a);
      if (!item) throw fail(404, "no such album");
      // an album's tracks carry no album: give them this one's cover
      const tracks = map.page(a.tracks, 0, (t) => map.track({ ...t, album: { id: a.id, uri: a.uri, name: a.name, images: a.images } }));
      const [liked] = await likedSet([item.uri]).catch(() => [false]);
      return { album: item, tracks, liked: liked ?? false };
    });
  }

  async function playlistPage(id: string): Promise<PlaylistPage> {
    return cached(`playlist:${id}`, CACHE_MS.page, async () => {
      const p = await web("GET", `/playlists/${encodeURIComponent(id)}`);
      const item = map.playlist(p);
      if (!item) throw fail(404, "no such playlist");
      const list = p?.items ?? p?.tracks;
      const tracks = list && Array.isArray(list.items) ? map.page(list, 0, map.entryTrack) : null;
      return { playlist: { ...item, description: String(p.description ?? "").replace(/<[^>]+>/g, ""), owner: String(p.owner?.display_name ?? "") }, tracks };
    });
  }

  async function artistPage(id: string): Promise<ArtistPage> {
    return cached(`artist:${id}`, CACHE_MS.page, async () => {
      const [a, albums] = await Promise.all([web("GET", `/artists/${encodeURIComponent(id)}`), web("GET", `/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=20`)]);
      const item = map.artist(a);
      if (!item) throw fail(404, "no such artist");
      return { artist: item, albums: map.page(albums, 0, map.album) };
    });
  }

  async function morePage(path: string, next: string | null): Promise<Page> {
    const { offset } = map.readToken(next);
    const [, kind, scope, id] = path.split("/");
    return cached(`${kind}:${scope}:${id}:${offset}`, CACHE_MS.page, async () => {
      if (kind === "tracks" && scope === "album") {
        const a = await web("GET", `/albums/${encodeURIComponent(id!)}`);
        const answer = await web("GET", `/albums/${encodeURIComponent(id!)}/tracks?limit=50&offset=${offset}`);
        return map.page(answer, offset, (t) => map.track({ ...t, album: { id: a.id, uri: a.uri, name: a.name, images: a.images } }));
      }
      if (kind === "tracks" && scope === "playlist") return map.page(await web("GET", `/playlists/${encodeURIComponent(id!)}/items?limit=50&offset=${offset}`), offset, map.entryTrack);
      if (kind === "albums" && scope === "artist") return map.page(await web("GET", `/artists/${encodeURIComponent(id!)}/albums?include_groups=album,single&limit=20&offset=${offset}`), offset, map.album);
      throw fail(404, `no page ${path}`);
    });
  }

  /** Where a command goes: the device asked for, else the active one, else this speaker. */
  async function target(asked?: string): Promise<string | null> {
    if (asked) return asked;
    const list = await devices();
    return list.find((d: { active: boolean }) => d.active)?.id ?? list.find((d: { local: boolean }) => d.local)?.id ?? null;
  }

  async function command(run: () => Promise<unknown>): Promise<Player> {
    await run();
    forgetPlayer();
    await Bun.sleep(settleMs);
    return playerNow(true);
  }

  async function play(body: Json): Promise<Player> {
    const device = await target(typeof body.deviceId === "string" ? body.deviceId : undefined);
    if (!device) throw fail(409, speaker.state === "ready" ? "This device's speaker is not in your Spotify devices yet." : "Nothing to play on.", "nodevice");
    const request: Json = {};
    if (typeof body.context === "string") request.context_uri = body.context;
    if (Array.isArray(body.uris)) request.uris = body.uris.filter((u: unknown) => typeof u === "string").slice(0, 100);
    if (body.offset && typeof body.offset === "object") request.offset = typeof body.offset.uri === "string" ? { uri: body.offset.uri } : { position: Number(body.offset.position) || 0 };
    if (typeof body.positionMs === "number") request.position_ms = Math.max(0, Math.round(body.positionMs));
    return command(() => web("PUT", `/me/player/play?device_id=${encodeURIComponent(device)}`, request));
  }

  async function route(r: ServiceRequest): Promise<unknown> {
    const path = r.path.replace(/\/+$/, "") || "/";
    const body = (): Json => (r.body.length ? readJson<Json>(r, { error: "a JSON body" }) : {});
    const next = r.query.get("next");
    if (r.method === "GET") {
      if (path === "/status") {
        if (token && !user) await me().catch(() => undefined);
        return status();
      }
      if (path === "/home") return home();
      if (path.startsWith("/library/")) return library(path.slice(9), next);
      if (path === "/search") return search(r.query.get("q") ?? "", r.query.get("type") ?? "track", next);
      if (path.startsWith("/album/")) return albumPage(path.slice(7));
      if (path.startsWith("/playlist/")) return playlistPage(path.slice(10));
      if (path.startsWith("/artist/")) return artistPage(path.slice(8));
      if (path.startsWith("/tracks/") || path.startsWith("/albums/")) return morePage(path, next);
      if (path === "/player") return playerNow();
      if (path === "/devices") return devices();
      if (path === "/queue") return cached("queue", CACHE_MS.queue, async () => map.queue(await web("GET", "/me/player/queue")));
      throw fail(404, `no spotify endpoint GET ${path}`);
    }
    if (r.method !== "POST") throw fail(405, "the spotify service takes GET and POST");
    switch (path) {
      case "/config": {
        const id = String(body().clientId ?? "").trim().toLowerCase();
        if (id && !CLIENT_ID.test(id)) throw fail(400, "A Client ID is 32 characters, 0-9 and a-f.");
        if (id !== clientId) signOut();
        clientId = id;
        writeSecret(configFile, { clientId });
        return status();
      }
      case "/signin":
        startSignIn();
        return status();
      case "/signout":
        signOut();
        return status();
      case "/play":
        return play(body());
      case "/pause":
        return command(() => web("PUT", "/me/player/pause"));
      case "/resume":
        return command(async () => {
          const device = await target();
          return web("PUT", `/me/player/play${device ? `?device_id=${encodeURIComponent(device)}` : ""}`);
        });
      case "/next":
        return command(() => web("POST", "/me/player/next"));
      case "/previous":
        return command(() => web("POST", "/me/player/previous"));
      case "/seek":
        return command(() => web("PUT", `/me/player/seek?position_ms=${Math.max(0, Math.round(Number(body().positionMs) || 0))}`));
      case "/volume":
        return command(() => web("PUT", `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(Number(body().percent) || 0)))}`));
      case "/shuffle":
        return command(() => web("PUT", `/me/player/shuffle?state=${body().on === true}`));
      case "/repeat": {
        const mode = String(body().mode ?? "off");
        if (!["off", "context", "track"].includes(mode)) throw fail(400, "repeat is off, context or track");
        return command(() => web("PUT", `/me/player/repeat?state=${mode}`));
      }
      case "/transfer": {
        const b = body();
        if (typeof b.deviceId !== "string" || !b.deviceId) throw fail(400, "transfer needs a deviceId");
        return command(() => web("PUT", "/me/player", { device_ids: [b.deviceId], play: b.play !== false }));
      }
      case "/like": {
        const b = body();
        if (typeof b.uri !== "string" || !/^spotify:(track|album|episode|artist|playlist):[A-Za-z0-9]+$/.test(b.uri)) throw fail(400, "like needs a Spotify uri");
        await web(b.liked === false ? "DELETE" : "PUT", `/me/library?uris=${encodeURIComponent(b.uri)}`);
        for (const key of cache.keys()) if (key.startsWith("liked:") || key.startsWith("album:") || key === "home" || key.startsWith("library:") || key === "player") cache.delete(key);
        return { liked: b.liked !== false };
      }
    }
    throw fail(404, `no spotify endpoint POST ${path}`);
  }

  // signed in before: the speaker comes up with the service
  if (token && clientId) speaker.start(null);

  return {
    name: "spotify",
    async handle(request) {
      try {
        return jsonResponse(200, await route(request));
      } catch (cause) {
        if (cause instanceof SpotifyError) return jsonResponse(cause.status >= 400 ? cause.status : 500, cause.failure);
        // a body that is not JSON: the host answers its 400
        if (cause instanceof ServiceError) throw cause;
        context.log(`spotify: ${cause instanceof Error ? cause.message : String(cause)}`);
        return jsonResponse(502, { error: "Spotify is out of reach.", reason: "other" } satisfies Failure);
      }
    },
    async command(args) {
      const [verb, value] = args;
      if (verb === "client-id" && value !== undefined) {
        if (value && !CLIENT_ID.test(value)) return "A Client ID is 32 characters, 0-9 and a-f.";
        clientId = value;
        writeSecret(configFile, { clientId });
        return value ? "Client ID set" : "Client ID cleared";
      }
      if (verb === "signout") {
        signOut();
        return "signed out";
      }
      const s = status();
      return `configured ${s.configured}, signed in ${s.signedIn}${s.user ? ` as ${s.user.name}` : ""}, speaker ${s.speaker.state}${s.speaker.message ? ` (${s.speaker.message})` : ""}`;
    },
    async state() {
      const s = status();
      return { configured: s.configured, signedIn: s.signedIn, user: s.user?.name ?? "", speaker: s.speaker.state };
    },
    close() {
      cancelSignIn();
      speaker.stop();
    },
  };
}
