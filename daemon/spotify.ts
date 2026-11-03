// The spotify service: what vendor/applets/spotify/contract.ts lists, for the
// Spotify applet. omarchy-pocket-spotify (spotify/ in this repository, on
// spotatui's librespot fork) does the Spotify half; this service runs it,
// asks it, and answers the applet in the contract's objects.
//
// The program. It listens on 127.0.0.1:PORT and takes a request only with the
// key this service hands it in OMARCHY_POCKET_SPOTIFY_KEY, made once per
// service and kept across the program's restarts (an app's realm reaches
// 127.0.0.1 for media streams; it never has the key). It keeps the login in <storeDir>/services/spotify/session/ (0700). It
// is restarted when it exits, a second later, then at most every 30 s.
//
// Sign-in. POST /signin asks it for a pairing code: Spotify's own desktop
// client signs in the way a TV does (OAuth device authorization), so there is
// no Client ID, no developer app and no redirect. The applet shows the code
// and spotify.com/pair?code=… as a QR code; the owner confirms it on a phone
// or any computer, and the program signs in, keeps the login, and starts the
// speaker. Spotify Premium is needed: a login without it is not kept.
//
// The speaker. Once signed in the program is this device's Spotify Connect
// speaker, SPEAKER_NAME, writing PCM to pw-cat (PipeWire) at 320 kbps.
// Spotify refuses the audio keys to librespot for some accounts; the program
// then reports the speaker `refused`, and the owner can set up Spotify's own
// player, Soloist, in its place: the service's owner setup (Pocket Hub's
// tools/companion/setup.ts, answered at /_setup) holds the Soloist API key the
// owner makes in Spotify's developer dashboard and Spotify's Soloist build,
// fetched from Spotify on the owner's consent and again every
// SOLOIST_REFRESH_DAYS (Spotify's builds stop working 90 days after their
// release). With both, Soloist is the speaker under the same name (the
// program runs with --speaker none). Soloist's first login comes from a
// Spotify app on the same network picking it (Spotify's one way in for it);
// it keeps that login in services/spotify/soloist/. Its key is on its command
// line, as Soloist takes it; its log reaches the daemon's log only as its
// errors and sign-in steps, with the key, tokens and account ids taken out.
//
// Playing here. The applet plays on this device: a play, a pause, a skip or a
// volume goes to this device's own speaker unless the applet names another
// device (its Devices page). With Soloist that is its local WebSocket API
// (soloist-link.ts, `--ws 127.0.0.1:0`): play takes a track, album, playlist
// or episode, and the player, the queue and the controls are Soloist's own. A
// start inside an album or playlist, Liked Songs and an artist go through
// Spotify Connect to this device's id (the program's connect-state), as
// Soloist's play takes no offset; when that fails, the chosen track plays.
//
// Recently played. Home's shelf is Spotify's own list (the program's
// /me/player/recently-played, spclient's) merged with the one this service
// keeps, newest first: every album, playlist, artist or Liked Songs it sees
// playing (on any of the account's devices) or is asked to play, at most
// RECENT_MAX, in services/spotify/recent.json. Spotify's list lags and starts
// empty for a new account; the service's has what played here since then.
//
// Answers. The program answers Web API paths (GET /v1/me/player, /v1/search,
// /v1/albums/<id>, PUT /v1/me/player/play, …) in the Web API's JSON, from the
// internal API the official clients use: no developer quota, and every
// playlist lists its tracks. spotify-map.ts turns them into the contract's
// objects; they are cached for a few seconds to a few minutes (CACHE_MS), and
// a command clears the player's.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonResponse, readJson, ServiceError, type ServiceContext, type ServiceProvider, type ServiceRequest } from "../vendor/pocket-hub/tools/companion/services.ts";
import { OwnerSetup, type SetupSpec } from "../vendor/pocket-hub/tools/companion/setup.ts";
import { Supervised } from "../vendor/pocket-hub/tools/companion/supervise.ts";
import type { AlbumPage, ArtistPage, Device, Failure, Home, Item, Page, Player, PlaylistPage, Queue, Status } from "../vendor/applets/spotify/contract.ts";
import * as map from "./spotify-map.ts";
import type { Media } from "./protocol.ts";
import { SoloistLink, type SoloistEntity } from "./soloist-link.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const SPEAKER_NAME = "Omarchy Pocket";
const PROGRAM = "/usr/lib/omarchy-pocket/omarchy-pocket-spotify";
const PORT = 4471;
const CACHE_MS = { home: 60_000, library: 60_000, page: 300_000, search: 120_000, player: 1_000, devices: 3_000, queue: 2_000, liked: 30_000, status: 1_500 } as const;
const LIST = 30;
const RECENT_MAX = 24;
const SOLOIST_REFRESH_DAYS = 30;
const SOLOIST_CDN = "https://soloist-builds.spotifycdn.com";

/** What the owner sets up for Spotify's own player (PocketJS setup.ts). */
const SETUP: SetupSpec = {
  title: "Spotify's own player",
  fields: [
    {
      id: "soloistKey",
      label: "Soloist API key",
      secret: true,
      pattern: "[\\x21-\\x7e]{16,512}",
      help: "Spotify plays to Soloist where it refuses this device's speaker. Make a key in Spotify's developer dashboard.",
      link: { label: "developer.spotify.com/dashboard/soloist", url: "https://developer.spotify.com/dashboard/soloist" },
    },
  ],
  tools: [
    {
      id: "soloist",
      title: "Spotify Soloist",
      vendor: "Spotify",
      terms: "https://developer.spotify.com/terms",
      note: "Spotify's headless player, fetched from Spotify for this device and never passed on.",
      builds: {
        "linux-arm64": { url: `${SOLOIST_CDN}/soloist_release_arm64.tar.gz`, archive: "tar.gz", binary: "soloist" },
        "linux-x64": { url: `${SOLOIST_CDN}/soloist_release_x86_64.tar.gz`, archive: "tar.gz", binary: "soloist" },
        "linux-arm": { url: `${SOLOIST_CDN}/soloist_release_arm32.tar.gz`, archive: "tar.gz", binary: "soloist" },
        "darwin-arm64": { url: `${SOLOIST_CDN}/soloist_release_osx_arm64.tar.gz`, archive: "tar.gz", binary: "soloist" },
      },
      refreshAfterDays: SOLOIST_REFRESH_DAYS,
    },
  ],
};

export interface SpotifyOptions {
  /** the program; null runs none (a test serves it at `port`) */
  program?: string | null;
  /** Soloist in place of the fetched build (tests) */
  soloist?: string;
  /** the platform the owner setup fetches builds for (tests) */
  platform?: import("../vendor/pocket-hub/tools/companion/setup.ts").Platform | null;
  port?: number;
  /** the key, when a test runs the program itself */
  key?: string;
  now?: () => number;
  /** how long after a command the player is read again, for Spotify to catch up */
  settleMs?: number;
  /** what Soloist plays on this device changed (SystemState.media) */
  onMedia?: (media: Media | null) => void;
}

class SpotifyError extends Error {
  constructor(readonly status: number, readonly failure: Failure) {
    super(failure.error);
  }
}

const fail = (status: number, error: string, reason: Failure["reason"] = "other") => new SpotifyError(status, { error, reason });

/** Where the program keeps the login (spotify/src/infra/spotify/credentials.rs). */
const sessionDirOf = (storeDir: string) => join(storeDir, "services", "spotify", "session");

/** The account signed in before: the program's cached credentials are there. */
export function signedInBefore(storeDir: string): boolean {
  return existsSync(join(sessionDirOf(storeDir), "streaming_cache", "credentials.json"));
}

export function createSpotifyService(context: ServiceContext, options: SpotifyOptions = {}): ServiceProvider {
  const now = options.now ?? Date.now;
  const settleMs = options.settleMs ?? 450;
  const port = options.port ?? PORT;
  const base = `http://127.0.0.1:${port}`;
  const key = options.key ?? randomBytes(24).toString("base64url");
  const sessionDir = sessionDirOf(context.storeDir);
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const programPath = options.program === undefined ? PROGRAM : options.program;
  const cache = new Map<string, { at: number; value: unknown }>();
  /** this device's speaker as the account's devices list it */
  let speakerId: string | null = null;

  /* ---------- the speaker's engine ---------- */

  const setup = new OwnerSetup(context, "spotify", SETUP, { platform: options.platform, now, onChange: () => engineChanged() });
  const soloistDir = join(context.storeDir, "services", "spotify", "soloist");
  mkdirSync(soloistDir, { recursive: true, mode: 0o700 });
  const soloistPath = () => options.soloist ?? setup.toolPath("soloist");
  /** Soloist is the speaker: its key is set and its build fetched */
  const soloistEngine = () => setup.value("soloistKey") !== null && soloistPath() !== null;
  let engine: "librespot" | "soloist" = soloistEngine() ? "soloist" : "librespot";
  /** what Soloist's log said last */
  let soloist: { state: "off" | "starting" | "pair" | "ready" | "error"; id: string | null; message: string } = { state: "off", id: null, message: "" };
  /** Soloist's local WebSocket: its state and the commands this device plays with */
  const link = new SoloistLink({ onChange: () => linkChanged() });
  /** Soloist plays here: signed in, its WebSocket open */
  const soloistHere = () => engine === "soloist" && link.ready;

  const program = new Supervised({
    name: "spotify",
    pidFile: join(context.storeDir, "services", "spotify", "program.pid"),
    argv: () => (programPath && existsSync(programPath) ? [programPath, "--cache", sessionDir, "--port", String(port), "--name", SPEAKER_NAME, "--speaker", engine === "soloist" ? "none" : "librespot"] : null),
    env: () => ({ OMARCHY_POCKET_SPOTIFY_KEY: key, RUST_LOG: process.env.RUST_LOG ?? "omarchy_pocket_spotify=info,spotatui_librespot=warn" }),
    // the program's own warnings, never its arguments
    onLine: (line) => {
      if (/ WARN | ERROR /.test(line)) context.log(`spotify: ${line.replace(/^\[[^\]]*\]\s*/, "").slice(0, 240)}`);
    },
    log: context.log,
  });
  if (programPath && !existsSync(programPath)) context.log(`spotify: ${programPath} is not installed`);
  program.start();

  const soloistChild = new Supervised({
    name: "soloist",
    pidFile: join(context.storeDir, "services", "spotify", "soloist.pid"),
    argv: () => {
      const path = soloistPath();
      const apiKey = setup.value("soloistKey");
      if (engine !== "soloist" || !path || !apiKey) return null;
      // -v: its sign-in and connection steps are in the verbose log only;
      // --ws: the local API this device plays with, on a port of the OS's choosing
      return [path, "-n", SPEAKER_NAME, "-k", apiKey, "-D", soloistDir, "-C", join(soloistDir, "cache"), "-z", "200", "-i", "80", "-v", "-w", "127.0.0.1:0"];
    },
    // the route the program's sign-in found works (spotify/src/core/route.rs):
    // its proxy (HTTPS_PROXY, mihomo's), or directly to Spotify
    env: () => (readRoute() === "direct" ? { NO_PROXY: "*", no_proxy: "*" } : {}),
    onLine: (line) => soloistSaid(line),
    onExit: () => {
      if (soloist.state !== "error") soloist = { state: "starting", id: null, message: "" };
      link.close();
    },
    log: context.log,
  });

  function readRoute(): "proxy" | "direct" {
    try {
      return readFileSync(join(sessionDir, "route"), "utf8").trim() === "direct" ? "direct" : "proxy";
    } catch {
      return "proxy";
    }
  }

  /** Soloist's verbose lines worth the log: its sign-in and how it reaches Spotify */
  const SOLOIST_STEPS = /session|login|logged|credential|authori[sz]|access ?point|\bap\b|apresolve|connection|connect(ed|ing)? (to|failed)|proxy|offline|reachab|premium|country|restrict|denied|refus|fail/i;

  /** Soloist's log, as spotatui reads it (src/infra/soloist/logline.rs). */
  function soloistSaid(raw: string) {
    // colour codes out; its level is one letter: "11:02:37.787 E [f:247 ] ..."
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const text = line.includes("] ") ? line.slice(line.indexOf("] ") + 2) : line;
    // its Connect device: up, signed in or not
    const ready = /ready, device_name=.*device_id=(\S+)/.exec(text);
    if (ready) {
      soloist = { ...soloist, id: ready[1]!, message: "" };
      speakerId = ready[1]!;
      cache.delete("status");
      return;
    }
    const listening = /websocket server listening on (\S+)/.exec(text);
    if (listening) {
      link.open(listening[1]!);
      return;
    }
    if (/logged in as /.test(text)) {
      soloist = { ...soloist, state: "ready", message: "" };
      setup.prompt(null);
      cache.delete("status");
    }
    if (text.includes("waiting for login")) {
      soloist = { state: "pair", id: soloist.id, message: "" };
      setup.prompt({ kind: "pick", title: `Pick ${SPEAKER_NAME} in Spotify`, detail: `On a phone or computer on this network, open Spotify, tap the devices icon, and pick ${SPEAKER_NAME}. Soloist keeps the login.` });
      cache.delete("status");
      return;
    }
    if (text.includes("login failed")) soloist = { ...soloist, state: "error", message: "Spotify refused Soloist's login. Pick the device again in Spotify." };
    else if (text.includes("another session is running")) soloist = { ...soloist, state: "error", message: "Another Soloist uses this device's Soloist folder." };
    else if (text.includes("build expired") || text.includes("client expired")) {
      soloist = { ...soloist, state: "error", message: "The Soloist build expired; fetching the newest from Spotify." };
      void setup.refresh("soloist").then(() => soloistChild.restart(), () => {});
    } else if (/client expires in \d+ (hour|minute)/.test(text) || /client expires in [0-6] day/.test(text)) {
      void setup.refresh("soloist").catch(() => {});
    }
    // its errors, and the steps of a sign-in and of reaching Spotify; never the key, a token or an account id
    if (/^\S+ [EW] \[| ERROR /.test(line) || SOLOIST_STEPS.test(text)) {
      const apiKey = setup.value("soloistKey");
      let said = text.replace(/-k \S+/g, "-k ***").trim();
      if (apiKey) said = said.split(apiKey).join("***");
      said = said.replace(/[A-Za-z0-9+/_=-]{40,}/g, "<long>").replace(/\b[a-z0-9]{25,}\b/g, "<id>");
      context.log(`soloist: ${said.slice(0, 200)}`);
    }
  }

  let mediaSaid = "null";
  function linkChanged() {
    if (link.state.loggedIn && soloist.state !== "ready") {
      soloist = { ...soloist, state: "ready", message: "" };
      setup.prompt(null);
    }
    cache.delete("status");
    forgetPlayer();
    // what plays here (SystemState.media): Soloist's item while it is the account's active device
    const s = link.state;
    const media = soloistHere() && s.active && s.item?.uri && s.status !== "idle" ? { playing: s.status === "playing" || s.status === "buffering", title: s.item.title, artist: s.item.subtitle } : null;
    const said = JSON.stringify(media);
    if (said !== mediaSaid) {
      mediaSaid = said;
      options.onMedia?.(media);
    }
  }

  function engineChanged() {
    const next = soloistEngine() ? "soloist" : "librespot";
    cache.delete("status");
    if (next === engine) {
      if (next === "soloist" && !soloistChild.running) soloistChild.start();
      return;
    }
    engine = next;
    context.log(`spotify: the speaker is ${next === "soloist" ? "Spotify's Soloist" : "librespot"}`);
    // the program starts or stops its own speaker; Soloist runs only as the speaker
    program.restart();
    if (next === "soloist") {
      soloist = { state: "starting", id: null, message: "" };
      soloistChild.start();
    } else {
      soloistChild.stop();
      link.close();
      soloist = { state: "off", id: null, message: "" };
      setup.prompt(null);
    }
  }
  if (engine === "soloist") {
    soloist = { state: "starting", id: null, message: "" };
    soloistChild.start();
  }

  /* ---------- recently played ---------- */

  const recentFile = join(context.storeDir, "services", "spotify", "recent.json");
  let recent: { uri: string; at: number }[] = (() => {
    try {
      const kept = JSON.parse(readFileSync(recentFile, "utf8"));
      return Array.isArray(kept) ? kept.filter((r) => typeof r?.uri === "string" && typeof r?.at === "number") : [];
    } catch {
      return [];
    }
  })();
  const contextUri = /^spotify:(album|playlist|artist):[A-Za-z0-9]+$|^spotify:user:[^:]+:collection$/;
  function played(uri: string | undefined) {
    if (!uri || !contextUri.test(uri) || recent[0]?.uri === uri) return;
    recent = [{ uri, at: now() }, ...recent.filter((r) => r.uri !== uri)].slice(0, RECENT_MAX);
    cache.delete("home");
    try {
      writeFileSync(`${recentFile}.new`, JSON.stringify(recent), { mode: 0o600 });
      renameSync(`${recentFile}.new`, recentFile);
    } catch (cause) {
      context.log(`spotify: recently played not kept: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /* ---------- the program ---------- */

  async function ask(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: { "x-pocket-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      program.start();
      throw fail(503, "Spotify is starting on this device. Try again in a moment.");
    }
    const text = await response.text();
    let json: Json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { error: { message: text.slice(0, 200) } };
    }
    return { status: response.status, json };
  }

  /** A Web API path, answered by the program from the internal API. */
  async function web(method: string, path: string, body?: unknown): Promise<Json> {
    const { status, json } = await ask(method, `/v1${path}`, body);
    if (status >= 400) throw new SpotifyError(status, map.failure(status, json));
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
    for (const k of cache.keys()) if (k.startsWith("player") || k.startsWith("queue") || k.startsWith("devices")) cache.delete(k);
  };

  /* ---------- sign-in ---------- */

  async function status(fresh = false): Promise<Status> {
    if (fresh) cache.delete("status");
    return cached("status", CACHE_MS.status, async () => {
      const { status: code, json } = await ask("GET", "/status");
      if (code !== 200 || !json) throw fail(502, "Spotify did not answer on this device.");
      const user = json.user && typeof json.user === "object" ? { id: String(json.user.id ?? ""), name: String(json.user.name ?? json.user.id ?? ""), image: String(json.user.image ?? "") } : null;
      let state: Status["speaker"]["state"] = ["off", "starting", "ready", "error", "refused"].includes(json.speaker?.state) ? json.speaker.state : "off";
      let message = String(json.speaker?.message ?? "");
      if (engine === "soloist") {
        state = json.signedIn ? (link.ready ? "ready" : soloist.state) : "off";
        message = soloist.message;
      }
      if (state === "ready" && json.signedIn && !speakerId) await devices().catch(() => undefined);
      return {
        signedIn: json.signedIn === true,
        user,
        premium: typeof json.premium === "boolean" ? json.premium : null,
        signIn: json.signIn?.code ? { url: String(json.signIn.url), code: String(json.signIn.code), expiresAt: Number(json.signIn.expiresAt) || 0 } : null,
        error: String(json.error ?? ""),
        speaker: { name: SPEAKER_NAME, engine, state, id: state === "ready" ? speakerId : null, message, setup: !setup.state().ready },
      } satisfies Status;
    });
  }

  async function signIn(): Promise<Status> {
    const { status: code, json } = await ask("POST", "/login");
    if (code !== 200) throw fail(code === 403 ? 403 : 502, String(json?.error?.message ?? "Spotify did not give a pairing code."));
    cache.clear();
    return status(true);
  }

  async function signOut(): Promise<Status> {
    await ask("POST", "/logout");
    speakerId = null;
    cache.clear();
    return status(true);
  }

  /* ---------- the speaker's Connect id ---------- */

  async function devices() {
    const list = await cached("devices", CACHE_MS.devices, async () => {
      const answer = await web("GET", "/me/player/devices");
      return (Array.isArray(answer?.devices) ? answer.devices : []).map((d: Json) => map.device(d, SPEAKER_NAME));
    });
    speakerId = list.find((d: { local: boolean }) => d.local)?.id ?? speakerId;
    const all: Device[] = soloistHere() && !list.some((d: Device) => d.local) ? [localDevice(), ...list] : list;
    // the local speaker first
    return [...all].sort((a, b) => Number(b.local) - Number(a.local));
  }

  /** this device's own player, as the contract's Device */
  function localDevice(): Device {
    return { id: speakerId ?? soloist.id ?? "", name: SPEAKER_NAME, type: "GameConsole", volume: link.state.volume, active: link.state.active, local: true, restricted: false };
  }

  /* ---------- answers ---------- */

  const likedSet = async (uris: string[]): Promise<boolean[]> => {
    if (!uris.length) return [];
    return cached(`liked:${uris.join(",")}`, CACHE_MS.liked, async () => {
      const answer = await web("GET", `/me/library/contains?uris=${encodeURIComponent(uris.join(","))}`);
      return Array.isArray(answer) ? answer.map((v) => v === true) : uris.map(() => false);
    });
  };

  async function me(): Promise<{ id: string }> {
    return cached("me", CACHE_MS.page, async () => ({ id: String((await web("GET", "/me"))?.id ?? "") }));
  }

  /** A Soloist entity as the contract's Item. */
  function soloistItem(e: SoloistEntity): Item {
    const ref = (r: { uri: string; title: string }) => ({ id: r.uri.split(":")[2] ?? "", uri: r.uri, name: r.title });
    return {
      kind: e.kind === "episode" ? "episode" : "track",
      id: e.uri.split(":")[2] ?? "",
      uri: e.uri,
      title: e.title,
      subtitle: e.subtitle,
      image: e.image,
      ...(e.durationMs !== null ? { durationMs: e.durationMs } : {}),
      explicit: e.explicit,
      ...(e.album ? { album: ref(e.album) } : {}),
      artists: e.artists.map(ref),
    };
  }

  /** What Soloist plays, from its WebSocket. */
  async function localPlayer(): Promise<Player> {
    const s = link.state;
    const item = s.item?.uri ? soloistItem(s.item) : null;
    const liked = item ? ((await likedSet([item.uri]).catch(() => [false]))[0] ?? false) : false;
    const contextUri = s.context?.uri ?? "";
    const title = contextUri ? s.context?.title || (await contextTitle(contextUri).catch(() => "")) : "";
    const playing = s.status === "playing" || s.status === "buffering";
    if (playing && contextUri) played(contextUri);
    return { active: item !== null, playing, item, progressMs: link.positionNow(), at: now(), shuffle: s.shuffle, repeat: s.repeat, context: contextUri ? { uri: contextUri, title } : null, device: localDevice(), liked };
  }

  async function playerNow(fresh = false): Promise<Player> {
    if (fresh) forgetPlayer();
    if (soloistHere() && link.state.active) return localPlayer();
    return cached("player", CACHE_MS.player, async () => {
      let p: Json;
      try {
        p = await web("GET", "/me/player?additional_types=episode");
      } catch (cause) {
        // Spotify's view is out of reach; this device's own still answers
        if (soloistHere()) return localPlayer();
        throw cause;
      }
      if (!p?.device && soloistHere()) return localPlayer();
      const uri = p?.item?.uri;
      const liked = uri ? ((await likedSet([uri]).catch(() => [false]))[0] ?? false) : false;
      const title = p?.context?.uri ? await contextTitle(p.context.uri).catch(() => "") : "";
      const out = map.player(p, SPEAKER_NAME, now(), liked, title);
      if (out.device?.local) speakerId = out.device.id;
      if (out.playing) played(out.context?.uri);
      return out;
    });
  }

  async function contextItem(uri: string): Promise<Item | null> {
    return cached(`context:${uri}`, CACHE_MS.page, async () => {
      const [, kind, id] = uri.split(":");
      if (uri.endsWith(":collection")) {
        const total = (await web("GET", "/me/tracks?limit=1").catch(() => null))?.total ?? null;
        return map.liked((await me()).id, total);
      }
      if (kind === "album") return map.album(await web("GET", `/albums/${id}`));
      if (kind === "playlist") return map.playlist(await web("GET", `/playlists/${id}`));
      if (kind === "artist") return map.artist(await web("GET", `/artists/${id}`));
      return null;
    });
  }

  async function contextTitle(uri: string): Promise<string> {
    return (await contextItem(uri))?.title ?? "";
  }

  async function home(): Promise<Home> {
    return cached("home", CACHE_MS.home, async () => {
      const u = await me();
      const [lists, albums, artists, likedTotal, played] = await Promise.all([
        web("GET", "/me/playlists?limit=20").catch(() => null),
        web("GET", "/me/albums?limit=12").catch(() => null),
        web("GET", "/me/following?type=artist&limit=12").catch(() => null),
        web("GET", "/me/tracks?limit=1").catch(() => null),
        web("GET", "/me/player/recently-played?limit=20").catch(() => null),
      ]);
      // Spotify's list and this service's, newest first, each context once
      const theirs = (Array.isArray(played?.items) ? played.items : [])
        .map((entry: Json) => ({ uri: String(entry?.context?.uri ?? ""), at: Date.parse(String(entry?.played_at ?? "")) || 0 }))
        .filter((r: { uri: string }) => contextUri.test(r.uri));
      const merged = [...recent, ...theirs].sort((a, b) => b.at - a.at).filter((r, i, all) => all.findIndex((o) => o.uri === r.uri) === i);
      const recentItems: Item[] = [];
      for (const { uri } of merged) {
        if (recentItems.length >= 12) break;
        const item = await contextItem(uri).catch(() => null);
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
        const out = map.page(await web("GET", `/me/playlists?limit=${LIST}&offset=${offset}`), offset, map.playlist);
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
        return map.page(answer?.artists ?? answer, 0, map.artist);
      }
      throw fail(404, `no shelf ${shelf}`);
    });
  }

  async function search(q: string, type: string, next: string | null): Promise<Page> {
    if (!q.trim()) return { items: [], total: 0, next: null };
    if (!["track", "album", "artist", "playlist"].includes(type)) throw fail(400, `no search type ${type}`);
    const { offset } = map.readToken(next);
    return cached(`search:${type}:${q}:${offset}`, CACHE_MS.search, async () => {
      const answer = await web("GET", `/search?${new URLSearchParams({ q, type, limit: "20", offset: String(offset) })}`);
      const fn = type === "track" ? map.track : type === "album" ? map.album : type === "artist" ? map.artist : map.playlist;
      return map.page(answer?.[`${type}s`], offset, fn);
    });
  }

  /** An album's tracks carry no album: give them this one's cover. */
  const withAlbum = (a: Json) => (t: Json) => map.track({ ...t, album: t.album ?? { id: a.id, uri: a.uri, name: a.name, images: a.images } });

  async function albumPage(id: string): Promise<AlbumPage> {
    return cached(`album:${id}`, CACHE_MS.page, async () => {
      const a = await web("GET", `/albums/${encodeURIComponent(id)}`);
      const item = map.album(a);
      if (!item) throw fail(404, "no such album");
      const [liked] = await likedSet([item.uri]).catch(() => [false]);
      return { album: item, tracks: map.page(a.tracks, 0, withAlbum(a)), liked: liked ?? false };
    });
  }

  async function playlistPage(id: string): Promise<PlaylistPage> {
    return cached(`playlist:${id}`, CACHE_MS.page, async () => {
      const p = await web("GET", `/playlists/${encodeURIComponent(id)}`);
      const item = map.playlist(p);
      if (!item) throw fail(404, "no such playlist");
      let list = p?.tracks ?? p?.items;
      // a playlist answered without its tracks: ask for them
      if (!list || !Array.isArray(list.items)) list = await web("GET", `/playlists/${encodeURIComponent(id)}/items?limit=50`).catch(() => null);
      const tracks = list && Array.isArray(list.items) ? map.page(list, 0, map.entryTrack) : null;
      return { playlist: { ...item, description: String(p.description ?? "").replace(/<[^>]+>/g, ""), owner: String(p.owner?.display_name ?? "") }, tracks };
    });
  }

  async function artistPage(id: string): Promise<ArtistPage> {
    return cached(`artist:${id}`, CACHE_MS.page, async () => {
      const [a, top, albums] = await Promise.all([
        web("GET", `/artists/${encodeURIComponent(id)}`),
        web("GET", `/artists/${encodeURIComponent(id)}/top-tracks`).catch(() => null),
        web("GET", `/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=20`),
      ]);
      const item = map.artist(a);
      if (!item) throw fail(404, "no such artist");
      const tops = (Array.isArray(top?.tracks) ? top.tracks : []).map(map.track).filter((t: Item | null): t is Item => t !== null).slice(0, 10);
      return { artist: item, top: tops, albums: map.page(albums, 0, map.album) };
    });
  }

  async function morePage(path: string, next: string | null): Promise<Page> {
    const { offset } = map.readToken(next);
    const [, kind, scope, id] = path.split("/");
    return cached(`${kind}:${scope}:${id}:${offset}`, CACHE_MS.page, async () => {
      if (kind === "tracks" && scope === "album") {
        const a = await web("GET", `/albums/${encodeURIComponent(id!)}`);
        return map.page(await web("GET", `/albums/${encodeURIComponent(id!)}/tracks?limit=50&offset=${offset}`), offset, withAlbum(a));
      }
      if (kind === "tracks" && scope === "playlist") return map.page(await web("GET", `/playlists/${encodeURIComponent(id!)}/items?limit=50&offset=${offset}`), offset, map.entryTrack);
      if (kind === "albums" && scope === "artist") return map.page(await web("GET", `/artists/${encodeURIComponent(id!)}/albums?include_groups=album,single&limit=20&offset=${offset}`), offset, map.album);
      throw fail(404, `no page ${path}`);
    });
  }

  /** Where a play goes: the device asked for, else this device's own speaker. */
  async function target(asked?: string): Promise<string | null> {
    if (asked) return asked;
    const list = await devices().catch(() => [] as Device[]);
    return list.find((d) => d.local)?.id ?? speakerId ?? null;
  }

  /** The player once Soloist's events say `done`, or after ms. */
  async function settled(done: () => boolean, ms = 4000): Promise<Player> {
    for (const end = Date.now() + ms; Date.now() < end && !done(); ) await Bun.sleep(100);
    forgetPlayer();
    return playerNow(true);
  }

  const wsPlays = (uri: string) => /^spotify:(track|album|playlist|episode):[A-Za-z0-9]+$/.test(uri);

  /** Play on this device's Soloist. */
  async function playHere(body: Json): Promise<Player> {
    const contextUri = typeof body.context === "string" ? body.context : "";
    const uris: string[] = Array.isArray(body.uris) ? body.uris.filter((u: unknown): u is string => typeof u === "string").slice(0, 100) : [];
    const offset = body.offset && typeof body.offset === "object" ? (typeof body.offset.uri === "string" ? { uri: body.offset.uri as string } : { position: Number(body.offset.position) || 0 }) : null;
    const positionMs = typeof body.positionMs === "number" ? Math.max(0, Math.round(body.positionMs)) : 0;
    if (contextUri) played(contextUri);
    const before = link.state.item?.uri ?? "";
    // a start inside a context, Liked Songs, an artist: Spotify Connect, to this device
    if (contextUri && (offset || !wsPlays(contextUri))) {
      const id = speakerId ?? soloist.id;
      if (id) {
        try {
          await web("PUT", `/me/player/play?device_id=${encodeURIComponent(id)}`, { context_uri: contextUri, ...(offset ? { offset } : {}), ...(positionMs ? { position_ms: positionMs } : {}) });
          return settled(() => link.state.active && (link.state.item?.uri ?? "") !== before && link.state.status === "playing");
        } catch (cause) {
          context.log(`spotify: a start inside ${contextUri.split(":")[1]} through Spotify Connect: ${cause instanceof Error ? cause.message : String(cause)}; playing the track here`);
        }
      }
    }
    const first = (offset && "uri" in offset ? offset.uri : "") || (contextUri && wsPlays(contextUri) ? contextUri : "") || uris[0] || "";
    if (!first) throw fail(502, "Spotify did not start that here. Try a track from it.");
    await link.send("play", { uri: first });
    for (const uri of uris.slice(1, LIST)) await link.send("add_to_queue", { uri }).catch(() => undefined);
    if (positionMs) await link.send("seek", { position_ms: positionMs }).catch(() => undefined);
    return settled(() => (link.state.item?.uri ?? "") !== before && link.state.status === "playing");
  }

  /**
   * A control: to Soloist when it plays here, answered once its events show
   * `effect` (or after 1.5 s); else to the account's active device.
   */
  async function control(local: () => Promise<unknown>, remote: () => Promise<unknown>, effect: () => boolean): Promise<Player> {
    if (soloistHere() && link.state.active) {
      await local();
      return settled(effect, 1500);
    }
    return command(remote);
  }

  async function command(run: () => Promise<unknown>): Promise<Player> {
    await run();
    forgetPlayer();
    await Bun.sleep(settleMs);
    return playerNow(true);
  }

  async function play(body: Json): Promise<Player> {
    const asked = typeof body.deviceId === "string" && body.deviceId ? body.deviceId : undefined;
    if (soloistHere() && (!asked || asked === (speakerId ?? soloist.id))) return playHere(body);
    const device = await target(asked);
    if (!device) throw fail(409, "Nothing to play on. This device's speaker joins once you are signed in.", "nodevice");
    const request: Json = {};
    if (typeof body.context === "string") request.context_uri = body.context;
    if (Array.isArray(body.uris)) request.uris = body.uris.filter((u: unknown) => typeof u === "string").slice(0, 100);
    if (body.offset && typeof body.offset === "object") request.offset = typeof body.offset.uri === "string" ? { uri: body.offset.uri } : { position: Number(body.offset.position) || 0 };
    if (typeof body.positionMs === "number") request.position_ms = Math.max(0, Math.round(body.positionMs));
    if (typeof body.context === "string") played(body.context);
    return command(() => web("PUT", `/me/player/play?device_id=${encodeURIComponent(device)}`, request));
  }

  async function route(r: ServiceRequest): Promise<unknown> {
    const path = r.path.replace(/\/+$/, "") || "/";
    const body = (): Json => (r.body.length ? readJson<Json>(r, { error: "a JSON body" }) : {});
    const next = r.query.get("next");
    if (r.method === "GET") {
      if (path === "/status") return status();
      if (path === "/home") return home();
      if (path.startsWith("/library/")) return library(path.slice(9), next);
      if (path === "/search") return search(r.query.get("q") ?? "", r.query.get("type") ?? "track", next);
      if (path.startsWith("/album/")) return albumPage(path.slice(7));
      if (path.startsWith("/playlist/")) return playlistPage(path.slice(10));
      if (path.startsWith("/artist/")) return artistPage(path.slice(8));
      if (path.startsWith("/tracks/") || path.startsWith("/albums/")) return morePage(path, next);
      if (path === "/player") return playerNow();
      if (path === "/devices") return devices();
      if (path === "/queue") {
        if (soloistHere() && link.state.active) {
          await link.send("get_queue", { limit: LIST }).catch(() => undefined);
          return { now: link.state.item?.uri ? soloistItem(link.state.item) : null, next: link.state.upcoming.filter((e) => e.uri).map(soloistItem) } satisfies Queue;
        }
        return cached("queue", CACHE_MS.queue, async () => map.queue(await web("GET", "/me/player/queue")));
      }
      throw fail(404, `no spotify endpoint GET ${path}`);
    }
    if (r.method !== "POST") throw fail(405, "the spotify service takes GET and POST");
    switch (path) {
      case "/signin":
        return signIn();
      case "/cancel":
        await ask("POST", "/login/cancel");
        return status(true);
      case "/signout":
        return signOut();
      case "/play":
        return play(body());
      case "/pause":
        return control(() => link.send("pause"), () => web("PUT", "/me/player/pause"), () => link.state.status !== "playing");
      case "/resume": {
        // nothing playing elsewhere: resume here
        if (soloistHere() && !link.state.active) {
          const elsewhere = await web("GET", "/me/player").catch(() => null);
          if (!elsewhere?.device) {
            await link.send("play");
            return settled(() => link.state.status === "playing");
          }
        }
        return control(
          () => link.send("play"),
          async () => {
            const device = await target();
            return web("PUT", `/me/player/play${device ? `?device_id=${encodeURIComponent(device)}` : ""}`);
          },
          () => link.state.status === "playing",
        );
      }
      case "/next":
      case "/previous": {
        const was = link.state.item?.uri ?? "";
        const at = link.positionNow();
        // a previous within a track's first seconds goes back a track, later it restarts it
        return control(
          () => link.send(path === "/next" ? "skip_next" : "skip_prev"),
          () => web("POST", `/me/player/${path.slice(1)}`),
          () => (link.state.item?.uri ?? "") !== was || (path === "/previous" && link.positionNow() < Math.min(at, 3000)),
        );
      }
      case "/seek": {
        const ms = Math.max(0, Math.round(Number(body().positionMs) || 0));
        return control(() => link.send("seek", { position_ms: ms }), () => web("PUT", `/me/player/seek?position_ms=${ms}`), () => Math.abs(link.positionNow() - ms) < 2000);
      }
      case "/volume": {
        const percent = Math.max(0, Math.min(100, Math.round(Number(body().percent) || 0)));
        return control(() => link.send("set_volume", { volume: percent }), () => web("PUT", `/me/player/volume?volume_percent=${percent}`), () => link.state.volume === percent);
      }
      case "/shuffle": {
        const on = body().on === true;
        return control(() => link.send("set_shuffle", { enabled: on }), () => web("PUT", `/me/player/shuffle?state=${on}`), () => link.state.shuffle === on);
      }
      case "/repeat": {
        const mode = String(body().mode ?? "off");
        if (!["off", "context", "track"].includes(mode)) throw fail(400, "repeat is off, context or track");
        // Soloist's two flags, the one that turns off first
        const local = async () => {
          if (mode === "track") {
            await link.send("set_repeat_context", { enabled: false });
            await link.send("set_repeat_track", { enabled: true });
          } else {
            await link.send("set_repeat_track", { enabled: false });
            await link.send("set_repeat_context", { enabled: mode === "context" });
          }
        };
        return control(local, () => web("PUT", `/me/player/repeat?state=${mode}`), () => link.state.repeat === mode);
      }
      case "/transfer": {
        const b = body();
        if (typeof b.deviceId !== "string" || !b.deviceId) throw fail(400, "transfer needs a deviceId");
        // to this device: Soloist takes the account's playback itself
        if (soloistHere() && b.deviceId === (speakerId ?? soloist.id)) {
          await link.send("activate");
          if (b.play !== false) await link.send("play").catch(() => undefined);
          return settled(() => link.state.active);
        }
        return command(() => web("PUT", "/me/player", { device_ids: [b.deviceId], play: b.play !== false }));
      }
      case "/like": {
        const b = body();
        if (typeof b.uri !== "string" || !/^spotify:(track|album|episode|artist|playlist):[A-Za-z0-9]+$/.test(b.uri)) throw fail(400, "like needs a Spotify uri");
        await web(b.liked === false ? "DELETE" : "PUT", `/me/library?uris=${encodeURIComponent(b.uri)}`);
        for (const k of cache.keys()) if (k.startsWith("liked:") || k.startsWith("album:") || k === "home" || k.startsWith("library:") || k === "player") cache.delete(k);
        return { liked: b.liked !== false };
      }
    }
    throw fail(404, `no spotify endpoint POST ${path}`);
  }

  return {
    name: "spotify",
    setup,
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
      // SystemState.media's play/pause: what Soloist plays on this device
      if (args[0] === "toggle") {
        if (!soloistHere()) return "nothing plays here";
        const playing = link.state.active && (link.state.status === "playing" || link.state.status === "buffering");
        await link.send(playing ? "pause" : "play");
        return playing ? "paused" : "playing";
      }
      if (args[0] === "signout") {
        await signOut().catch(() => undefined);
        return "signed out";
      }
      const s = await status(true).catch(() => null);
      if (!s) return "the program does not answer";
      return `signed in ${s.signedIn}${s.user ? ` as ${s.user.name}` : ""}, premium ${s.premium}, speaker ${s.speaker.state}${s.speaker.message ? ` (${s.speaker.message})` : ""}${s.signIn ? `, pairing ${s.signIn.code}` : ""}`;
    },
    async state() {
      const s = await status().catch(() => null);
      return { signedIn: s?.signedIn ?? false, user: s?.user?.name ?? "", speaker: s?.speaker.state ?? "off" };
    },
    close() {
      link.close();
      soloistChild.stop();
      program.stop();
    },
  };
}
