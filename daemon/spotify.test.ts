// The spotify service against a stand-in for omarchy-pocket-spotify: the key
// on every request, the pairing sign-in, Web API answers in the contract's
// shapes (recently played as the service saw it, an artist's popular tracks, a playlist
// answered without its tracks), commands to the active device or this
// speaker, and failures as reasons.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServiceProvider } from "../vendor/pocketjs/tools/companion/services.ts";
import * as map from "./spotify-map.ts";
import { createSpotifyService, SPEAKER_NAME } from "./spotify.ts";

const dir = mkdtempSync(join(tmpdir(), "spotify-test-"));
const KEY = "test-key-0123456789abcdef";
const seen: { method: string; path: string; body: string; key: string }[] = [];
let signedIn = false;
let pairing: { url: string; code: string; expiresAt: number } | null = null;
let server: ReturnType<typeof Bun.serve>;
let service: ServiceProvider;

const cover = (side: number) => ({ url: `https://i.scdn.co/image/${side}`, width: side, height: side });
const ARTIST = { id: "ar1", uri: "spotify:artist:ar1", name: "Harbor Lights", images: [cover(320)] };
const ALBUM = { id: "al1", uri: "spotify:album:al1", name: "Night Ferry", images: [cover(640), cover(300), cover(64)], artists: [ARTIST], total_tracks: 2, release_date: "2025-05-01" };
const TRACK = { id: "t1", uri: "spotify:track:t1", name: "Low Tide", duration_ms: 201000, explicit: false, track_number: 1, artists: [ARTIST], album: ALBUM, type: "track" };
const SPEAKER = { id: "dev-local", name: SPEAKER_NAME, type: "GameConsole", volume_percent: 80, is_active: false, is_restricted: false };
const PHONE = { id: "dev-phone", name: "Pixel", type: "Smartphone", volume_percent: 40, is_active: true, is_restricted: false };

function webApi(method: string, p: string): Response {
  if (!signedIn) return Response.json({ error: { status: 401, message: "Not logged in to Spotify" } }, { status: 401 });
  if (p === "/me") return Response.json({ id: "tester", display_name: "Tess Ter", images: [cover(64)] });
  if (p === "/me/playlists") return Response.json({ items: [{ id: "pl1", uri: "spotify:playlist:pl1", name: "Walks", images: [cover(300)], owner: { display_name: "Tess Ter" }, tracks: { total: 3 } }], total: 1, next: null });
  if (p === "/me/albums") return Response.json({ items: [{ album: ALBUM }], total: 1, next: null });
  if (p === "/me/following") return Response.json({ artists: { items: [ARTIST], next: null, cursors: { after: null } } });
  if (p === "/me/tracks") return Response.json({ items: [{ track: TRACK }], total: 41, next: "x" });
  if (p === "/playlists/pl1") return Response.json({ id: "pl1", uri: "spotify:playlist:pl1", name: "Walks", images: [cover(300)], owner: { display_name: "Tess Ter" }, description: "For <b>walks</b>", tracks: { total: 1, items: [{ track: TRACK }], next: null } });
  // a playlist answered without its tracks, which come from /items
  if (p === "/playlists/editorial") return Response.json({ id: "editorial", uri: "spotify:playlist:editorial", name: "Mix", images: [], owner: { display_name: "Someone" }, description: "" });
  if (p === "/playlists/editorial/items") return Response.json({ items: [{ item: TRACK }], total: 1, next: null });
  if (p === "/search") return Response.json({ tracks: { items: [TRACK], total: 25, next: "x" } });
  if (p === "/me/player/devices") return Response.json({ devices: [PHONE, SPEAKER] });
  if (p === "/me/library/contains") return Response.json([true]);
  if (p === "/albums/al1") return Response.json({ ...ALBUM, tracks: { items: [{ ...TRACK, album: undefined }], total: 2, next: null } });
  if (p === "/artists/ar1") return Response.json(ARTIST);
  if (p === "/artists/ar1/top-tracks") return Response.json({ tracks: [TRACK, { ...TRACK, id: "t2", uri: "spotify:track:t2", name: "High Tide" }] });
  if (p === "/artists/ar1/albums") return Response.json({ items: [ALBUM], total: 1, next: null });
  if (p === "/me/player" && method === "GET") return Response.json({ is_playing: true, progress_ms: 1234, item: TRACK, shuffle_state: false, repeat_state: "context", context: { uri: ALBUM.uri }, device: { ...SPEAKER, is_active: true } });
  if (p === "/me/player/next") return Response.json({ error: { status: 403, message: "Spotify Premium is required" } }, { status: 403 });
  if (p === "/me/player/play" || p === "/me/library") return new Response(null, { status: 204 });
  return Response.json({ error: { status: 501, message: `No Spotify route for ${method} ${p}` } }, { status: 501 });
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.text();
      const key = request.headers.get("x-pocket-key") ?? "";
      seen.push({ method: request.method, path: url.pathname + url.search, body, key });
      if (key !== KEY) return Response.json({ error: { status: 403, message: "no key" } }, { status: 403 });
      if (url.pathname === "/status") {
        return Response.json({ signedIn, user: signedIn ? { id: "tester", name: "Tess Ter", image: "" } : null, premium: signedIn ? true : null, signIn: pairing, error: "", speaker: { name: SPEAKER_NAME, state: signedIn ? "ready" : "off", message: "" } });
      }
      if (url.pathname === "/login" && request.method === "POST") {
        pairing = { url: "https://spotify.com/pair?code=QK7FTM", code: "QK7FTM", expiresAt: Date.now() + 3_600_000 };
        return Response.json({ url: pairing.url, code: pairing.code });
      }
      if (url.pathname === "/login/cancel") {
        pairing = null;
        return Response.json({ ok: true });
      }
      if (url.pathname === "/logout") {
        signedIn = false;
        return Response.json({ ok: true });
      }
      if (url.pathname.startsWith("/v1/")) return webApi(request.method, url.pathname.slice(3));
      return new Response("no", { status: 404 });
    },
  });
  service = createSpotifyService({ storeDir: dir, log: () => {} }, { program: null, port: server.port, key: KEY, settleMs: 0 });
});

afterAll(() => {
  service.close?.();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const until = async (check: () => Promise<boolean> | boolean, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await check()) return;
  throw new Error("timed out");
};

async function call(method: string, path: string, body?: unknown) {
  const [p, q = ""] = path.split("?");
  const response = await service.handle({
    method,
    path: p!,
    query: new URLSearchParams(q),
    body: body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body)),
    maxBytes: 1 << 20,
    console: { name: "test", address: "127.0.0.1", localAddress: "127.0.0.1" },
    signal: new AbortController().signal,
  });
  return { status: response.status, json: JSON.parse(new TextDecoder().decode(response.body)) };
}

test("the Web API's objects in the contract's shapes", () => {
  expect(map.cover([cover(640), cover(300), cover(64)])).toBe("https://i.scdn.co/image/300");
  expect(map.cover([cover(64), cover(160)])).toBe("https://i.scdn.co/image/160");
  expect(map.cover(undefined)).toBe("");
  expect(map.track(TRACK)).toMatchObject({ kind: "track", title: "Low Tide", subtitle: "Harbor Lights", durationMs: 201000, image: "https://i.scdn.co/image/300", album: { id: "al1" } });
  // a playlist's tracks under `items` since 2026, under `tracks` before
  expect(map.playlist({ uri: "spotify:playlist:a", name: "A", items: { total: 7 } })!.count).toBe(7);
  expect(map.playlist({ uri: "spotify:playlist:a", name: "A", tracks: { total: 5 } })!.count).toBe(5);
  expect(map.entryTrack({ item: TRACK })!.id).toBe("t1");
  expect(map.entryTrack({ track: TRACK })!.id).toBe("t1");
  expect(map.nextToken({ items: [1, 2], next: "x" }, 10)).toBe("o12");
  expect(map.nextToken({ items: [1], next: "x", cursors: { after: "zz" } }, 0)).toBe("czz");
  expect(map.nextToken({ items: [1], next: null }, 0)).toBeNull();
  expect(map.readToken("o40")).toEqual({ offset: 40, after: null });
  expect(map.readToken("cabc")).toEqual({ offset: 0, after: "abc" });
  expect(map.failure(403, { error: { message: "Spotify Premium is required" } }).reason).toBe("premium");
  expect(map.failure(401, { error: { message: "Not logged in to Spotify" } }).reason).toBe("signin");
  expect(map.failure(404, { error: { message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }).reason).toBe("nodevice");
  expect(map.failure(429, {}).reason).toBe("rate");
  expect(map.player(null, SPEAKER_NAME, 5).active).toBe(false);
});

test("signing in is a pairing code; every request to the program carries its key", async () => {
  expect((await call("GET", "/status")).json).toMatchObject({ signedIn: false, signIn: null, speaker: { state: "off" } });
  expect((await call("GET", "/home")).json.reason).toBe("signin");

  const started = (await call("POST", "/signin")).json;
  expect(started.signIn).toMatchObject({ code: "QK7FTM", url: "https://spotify.com/pair?code=QK7FTM" });
  expect(started.signIn.expiresAt).toBeGreaterThan(Date.now());
  expect((await call("POST", "/cancel")).json.signIn).toBeNull();

  // the owner confirms a new code on a phone, and the program signs in
  await call("POST", "/signin");
  signedIn = true;
  pairing = null;
  const status = (await call("POST", "/cancel")).json;
  expect(status).toMatchObject({ signedIn: true, premium: true, user: { id: "tester", name: "Tess Ter" }, speaker: { state: "ready", id: "dev-local" } });
  expect(seen.every((s) => s.key === KEY)).toBe(true);
  // the service keeps no Spotify credential of its own
  expect(statSync(join(dir, "services", "spotify", "session")).mode & 0o777).toBe(0o700);
});

test("home, pages and search in the contract's shapes", async () => {
  // recently played is what the service saw play: Liked Songs, then the album, newest first
  await call("POST", "/play", { context: "spotify:user:tester:collection" });
  await call("POST", "/play", { context: ALBUM.uri });
  await call("POST", "/play", { context: ALBUM.uri });
  const home = (await call("GET", "/home")).json;
  expect(home.recent.map((i: { uri: string }) => i.uri)).toEqual([ALBUM.uri, "spotify:user:tester:collection"]);
  expect(home.recent[0]).toMatchObject({ kind: "album", title: "Night Ferry" });
  expect(home.recent[1]).toMatchObject({ kind: "liked", count: 41 });
  expect(home.playlists[0]).toMatchObject({ kind: "liked", uri: "spotify:user:tester:collection", count: 41 });
  expect(home.playlists[1]).toMatchObject({ kind: "playlist", title: "Walks", subtitle: "By Tess Ter", count: 3 });
  expect(home.albums[0].title).toBe("Night Ferry");
  expect(home.artists[0].kind).toBe("artist");

  const mine = (await call("GET", "/playlist/pl1")).json;
  expect(mine.playlist.description).toBe("For walks");
  expect(mine.tracks.items[0].title).toBe("Low Tide");
  // answered without its tracks: they come from /items
  expect((await call("GET", "/playlist/editorial")).json.tracks.items[0].id).toBe("t1");

  const album = (await call("GET", "/album/al1")).json;
  expect(album.tracks.items[0].image).toBe("https://i.scdn.co/image/300");
  expect(album.liked).toBe(true);

  const artist = (await call("GET", "/artist/ar1")).json;
  expect(artist.top.map((t: { title: string }) => t.title)).toEqual(["Low Tide", "High Tide"]);
  expect(artist.albums.items[0].uri).toBe(ALBUM.uri);

  const found = (await call("GET", "/search?q=low&type=track")).json;
  expect(found.items[0].uri).toBe(TRACK.uri);
  expect(found.next).toBe("o1");
  expect((await call("GET", "/library/tracks")).json).toMatchObject({ total: 41, next: "o1" });
});

test("play goes to this device's speaker, another only when named; the player maps, Premium is a reason, likes are library writes", async () => {
  const devices = (await call("GET", "/devices")).json;
  expect(devices[0]).toMatchObject({ id: "dev-local", local: true, type: "GameConsole" });

  seen.length = 0;
  const player = (await call("POST", "/play", { context: ALBUM.uri, offset: { uri: TRACK.uri } })).json;
  const put = seen.find((s) => s.method === "PUT" && s.path.startsWith("/v1/me/player/play"))!;
  // the phone is the active device; the play is this device's all the same
  expect(put.path).toBe("/v1/me/player/play?device_id=dev-local");
  expect(JSON.parse(put.body)).toEqual({ context_uri: ALBUM.uri, offset: { uri: TRACK.uri } });
  expect(player).toMatchObject({ active: true, playing: true, progressMs: 1234, repeat: "context", liked: true, context: { uri: ALBUM.uri, title: "Night Ferry" }, device: { local: true } });

  // the Devices page names the phone
  expect((await call("POST", "/play", { uris: [TRACK.uri], deviceId: "dev-phone" })).status).toBe(200);
  expect(seen.filter((s) => s.path.startsWith("/v1/me/player/play")).pop()!.path).toBe("/v1/me/player/play?device_id=dev-phone");

  const premium = await call("POST", "/next");
  expect(premium.status).toBe(403);
  expect(premium.json.reason).toBe("premium");

  expect((await call("POST", "/like", { uri: TRACK.uri, liked: false })).json).toEqual({ liked: false });
  expect(seen.at(-1)).toMatchObject({ method: "DELETE", path: `/v1/me/library?uris=${encodeURIComponent(TRACK.uri)}` });
  expect((await call("POST", "/like", { uri: "javascript:1" })).status).toBe(400);
});

test("the owner sets up Spotify's own player at /_setup; with it Soloist is the speaker", async () => {
  // a stand-in Soloist: asks for a login, then is ready
  const fake = join(dir, "soloist");
  const said = join(dir, "soloist-commands.jsonl");
  // a stand-in Soloist: its Connect device, a login it waits for, then its WebSocket API
  await Bun.write(
    fake,
    `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(join(dir, "soloist-argv.json"))}, JSON.stringify(process.argv.slice(2)));
const item = (uri) => ({ uri, entity_type: "track", decorations: { identity: { name: "Ferry Lights" }, visual_identity: { cover: [{ url: "https://i.scdn.co/image/cover", size: "default" }] }, creators: [{ uri: "spotify:artist:ar1", entity: { decorations: { identity: { name: "Nova Tide" } } } }], parent: { entity: { uri: "spotify:album:alb1", decorations: { identity: { name: "Night Ferry" } } } }, playback: { duration_ms: 201000 } } });
const state = { status: "idle", item: null, active: false };
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("ws only", { status: 400 }); }, websocket: {
  open(ws) { ws.send(JSON.stringify({ type: "auth_state", logged_in: true, is_active: false, device_name: "Omarchy Pocket" })); },
  message(ws, raw) {
    const m = JSON.parse(String(raw));
    fs.appendFileSync(${JSON.stringify(said)}, JSON.stringify(m) + "\\n");
    if (m.command === "get_queue") return ws.send(JSON.stringify({ type: "queue_changed", previous: [], upcoming: [{ uid: "u1", source: "context", item: item("spotify:track:next1") }] }));
    ws.send(JSON.stringify({ type: "command_result", command: m.command }));
    if (m.command === "play") { state.status = "playing"; state.active = true; if (m.uri) state.item = item(m.uri.startsWith("spotify:track:") ? m.uri : "spotify:track:first1"); }
    if (m.command === "pause") state.status = "paused";
    ws.send(JSON.stringify({ type: "playback_state", status: state.status, item: state.item, context: { uri: "" }, position: { position_ms: 5000, timestamp_ms: Date.now(), speed: state.status === "playing" ? 1 : 0 }, volume: 80, is_active: state.active, options: { shuffle: false, repeat: "off" } }));
  },
} });
console.log("[f:462] ready, device_name=Omarchy Pocket device_id=sol123");
console.log("[f:475] waiting for login");
setTimeout(() => { console.log("[f:12] logged in as tester"); console.log("[f:30] websocket server listening on 127.0.0.1:" + server.port); }, 300);
`,
  );
  chmodSync(fake, 0o755);
  const setupService = createSpotifyService({ storeDir: join(dir, "setup-store"), log: () => {} }, { program: null, port: server.port, key: KEY, settleMs: 0, soloist: fake, platform: "linux-arm64" });
  const setupCall = async (method: "GET" | "POST", body?: unknown) => {
    // as ServiceHost answers /_setup: a refused change is a 400
    const response = await serve({ name: "spotify", handle: (r) => setupService.setup!.handle(r) }, {
      method,
      path: "/_setup",
      query: new URLSearchParams(),
      body: body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body)),
      maxBytes: 1 << 20,
      console: { name: "test", address: "127.0.0.1", localAddress: "127.0.0.1" },
      signal: new AbortController().signal,
    });
    return { status: response.status, json: JSON.parse(new TextDecoder().decode(response.body)) };
  };
  const statusOf = async () => {
    const response = await setupService.handle({ method: "POST", path: "/cancel", query: new URLSearchParams(), body: new Uint8Array(0), maxBytes: 1 << 20, console: { name: "test", address: "127.0.0.1", localAddress: "127.0.0.1" }, signal: new AbortController().signal });
    return JSON.parse(new TextDecoder().decode(response.body));
  };
  try {
    signedIn = true;
    const before = (await setupCall("GET")).json;
    expect(before).toMatchObject({ service: "spotify", ready: false, fields: [{ id: "soloistKey", secret: true, set: false }], tools: [{ id: "soloist", vendor: "Spotify", consented: false }] });
    expect((await statusOf()).speaker).toMatchObject({ engine: "librespot", setup: true });
    expect((await setupCall("POST", { field: "soloistKey", value: "short" })).status).toBe(400);
    const set = (await setupCall("POST", { field: "soloistKey", value: "sk_test_0123456789abcdef" })).json;
    expect(JSON.stringify(set)).not.toContain("sk_test_0123456789abcdef");
    // the key and a Soloist: the speaker is Soloist, which asks to be picked, then is signed in
    await until(async () => (await statusOf()).speaker.state === "pair");
    expect((await setupCall("GET")).json.prompt).toMatchObject({ kind: "pick" });
    await until(async () => (await statusOf()).speaker.state === "ready");
    expect((await statusOf()).speaker).toMatchObject({ engine: "soloist", id: "sol123" });
    const argv: string[] = JSON.parse(readFileSync(join(dir, "soloist-argv.json"), "utf8"));
    expect(argv.slice(0, 2)).toEqual(["-n", SPEAKER_NAME]);
    expect(argv[argv.indexOf("-k") + 1]).toBe("sk_test_0123456789abcdef");
    expect(argv.slice(argv.indexOf("-w"), argv.indexOf("-w") + 2)).toEqual(["-w", "127.0.0.1:0"]);
    expect((await setupCall("GET")).json.prompt).toBeNull();

    // playing here: a track goes to Soloist's WebSocket, not to Spotify's devices
    const service = async (method: "GET" | "POST", path: string, body?: unknown) => {
      const response = await setupService.handle({ method, path, query: new URLSearchParams(), body: body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body)), maxBytes: 1 << 20, console: { name: "test", address: "127.0.0.1", localAddress: "127.0.0.1" }, signal: new AbortController().signal });
      return { status: response.status, json: JSON.parse(new TextDecoder().decode(response.body)) };
    };
    await until(async () => existsSync(said) || (await service("GET", "/player")).status === 200);
    seen.length = 0;
    const playing = (await service("POST", "/play", { uris: ["spotify:track:t1", "spotify:track:t2"] })).json;
    expect(playing).toMatchObject({ active: true, playing: true, item: { uri: "spotify:track:t1", title: "Ferry Lights", subtitle: "Nova Tide", album: { name: "Night Ferry" }, durationMs: 201000 }, device: { local: true, name: SPEAKER_NAME } });
    expect(seen.some((s) => s.path.startsWith("/v1/me/player/play"))).toBe(false);
    const commands = () => readFileSync(said, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(commands().filter((c) => c.command !== "get_queue").slice(0, 2)).toEqual([{ type: "command", command: "play", uri: "spotify:track:t1" }, { type: "command", command: "add_to_queue", uri: "spotify:track:t2" }]);
    // the controls and the queue are Soloist's too
    expect((await service("POST", "/pause")).json).toMatchObject({ playing: false, device: { local: true } });
    expect(commands().at(-1)).toMatchObject({ command: "pause" });
    expect((await service("GET", "/queue")).json).toMatchObject({ now: { uri: "spotify:track:t1" }, next: [{ uri: "spotify:track:next1" }] });
    expect(seen.some((s) => /\/v1\/me\/player\/(pause|queue)/.test(s.path))).toBe(false);
    // the key cleared: librespot again
    await setupCall("POST", { field: "soloistKey", clear: true });
    expect((await statusOf()).speaker.engine).toBe("librespot");
  } finally {
    setupService.close?.();
  }
});

test("signing out reaches the program", async () => {
  const out = (await call("POST", "/signout")).json;
  expect(out).toMatchObject({ signedIn: false, user: null, speaker: { state: "off" } });
  expect(seen.at(-2)!.path).toBe("/logout");
  expect((await call("GET", "/home")).json.reason).toBe("signin");
});
