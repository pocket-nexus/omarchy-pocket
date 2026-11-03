// The spotify service against fake accounts, Web API and relay servers and a
// stand-in librespot: the sign-in through the relay with PKCE, the token kept
// and refreshed, the speaker started with the token, the Web API's 2026
// shapes, commands to this device's speaker, and failures as reasons.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceProvider } from "../vendor/pocketjs/tools/companion/services.ts";
import * as map from "./spotify-map.ts";
import { createSpotifyService, SPEAKER_NAME } from "./spotify.ts";

const dir = mkdtempSync(join(tmpdir(), "spotify-test-"));
const CLIENT = "0123456789abcdef0123456789abcdef";
const seen: { method: string; path: string; body: string; auth: string }[] = [];
const tokenForms: URLSearchParams[] = [];
let relayed: Record<string, { code?: string; error?: string }> = {};
let failNextWith401 = false;
let server: ReturnType<typeof Bun.serve>;
let service: ServiceProvider;
let base = "";

const cover = (side: number) => ({ url: `https://i.scdn.co/image/${side}`, width: side, height: side });
const ALBUM = { id: "al1", uri: "spotify:album:al1", name: "Night Ferry", images: [cover(640), cover(300), cover(64)], artists: [{ id: "ar1", uri: "spotify:artist:ar1", name: "Harbor Lights" }], total_tracks: 2, release_date: "2025-05-01" };
const TRACK = { id: "t1", uri: "spotify:track:t1", name: "Low Tide", duration_ms: 201000, explicit: false, track_number: 1, artists: ALBUM.artists, album: ALBUM, type: "track" };
const SPEAKER = { id: "dev-local", name: SPEAKER_NAME, type: "GameConsole", volume_percent: 80, is_active: false, is_restricted: false, supports_volume: true };
const PHONE = { id: "dev-phone", name: "Pixel", type: "Smartphone", volume_percent: 40, is_active: true, is_restricted: false, supports_volume: true };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const body = await request.text();
      if (url.pathname === "/accounts/api/token") {
        const form = new URLSearchParams(body);
        tokenForms.push(form);
        const refresh = form.get("grant_type") === "refresh_token";
        return Response.json({ access_token: refresh ? "access-2" : "access-1", token_type: "Bearer", expires_in: 3600, scope: "streaming user-read-private", ...(refresh ? {} : { refresh_token: "refresh-1" }) });
      }
      if (url.pathname.startsWith("/relay/v1/oauth/spotify/")) {
        const state = url.pathname.split("/").pop()!;
        const answer = relayed[state];
        if (!answer) return new Response(null, { status: 204 });
        delete relayed[state];
        return Response.json(answer);
      }
      if (!url.pathname.startsWith("/api")) return new Response("no", { status: 404 });
      const path = url.pathname.slice(4) + url.search;
      seen.push({ method: request.method, path, body, auth: request.headers.get("authorization") ?? "" });
      if (failNextWith401) {
        failNextWith401 = false;
        return Response.json({ error: { status: 401, message: "The access token expired" } }, { status: 401 });
      }
      const p = url.pathname.slice(4);
      if (p === "/me") return Response.json({ id: "tester", display_name: "Tess Ter", images: [cover(64)] });
      if (p === "/me/player/recently-played") return Response.json({ items: [{ track: TRACK, context: { uri: ALBUM.uri, type: "album" } }, { track: TRACK, context: { uri: ALBUM.uri, type: "album" } }] });
      if (p === "/me/playlists") return Response.json({ items: [{ id: "pl1", uri: "spotify:playlist:pl1", name: "Walks", images: [cover(300)], owner: { display_name: "Tess Ter" }, items: { total: 3 } }], total: 1, next: null });
      if (p === "/me/albums") return Response.json({ items: [{ album: ALBUM }], total: 1, next: null });
      if (p === "/me/following") return Response.json({ artists: { items: [{ id: "ar1", uri: "spotify:artist:ar1", name: "Harbor Lights", images: [cover(320)] }], next: null, cursors: { after: null } } });
      if (p === "/me/tracks") return Response.json({ items: [{ track: TRACK }], total: 41, next: "https://api/me/tracks?offset=1" });
      if (p === "/playlists/pl1") return Response.json({ id: "pl1", uri: "spotify:playlist:pl1", name: "Walks", images: [cover(300)], owner: { display_name: "Tess Ter" }, description: "For <b>walks</b>", items: { total: 1, items: [{ item: TRACK }], next: null } });
      if (p === "/playlists/editorial") return Response.json({ id: "editorial", uri: "spotify:playlist:editorial", name: "Mix", images: [], owner: { display_name: "Someone" }, description: "" });
      if (p === "/search") return Response.json({ tracks: { items: [TRACK], total: 25, next: "https://api/search?offset=10" } });
      if (p === "/me/player/devices") return Response.json({ devices: [PHONE, SPEAKER] });
      if (p === "/me/library/contains") return Response.json([true]);
      if (p === "/albums/al1") return Response.json({ ...ALBUM, tracks: { items: [{ ...TRACK, album: undefined }], total: 2, next: null } });
      if (p === "/me/player" && request.method === "GET") return Response.json({ is_playing: true, progress_ms: 1234, item: TRACK, shuffle_state: false, repeat_state: "context", context: { uri: ALBUM.uri }, device: { ...SPEAKER, is_active: true } });
      if (p === "/me/player/next") return Response.json({ error: { status: 403, message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }, { status: 403 });
      if (p === "/me/player/play" || p === "/me/library") return new Response(null, { status: 204 });
      return Response.json({ error: { status: 404, message: `no fake for ${p}` } }, { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  // a stand-in librespot: says who it is signed in as, keeps its arguments, and runs until stopped
  const fake = join(dir, "librespot");
  writeFileSync(fake, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(join(dir, "argv.json"))}, JSON.stringify(process.argv.slice(2)));\nconst cache = process.argv[process.argv.indexOf("--system-cache") + 1];\nrequire("node:fs").writeFileSync(cache + "/credentials.json", "{}");\nconsole.error("[INFO librespot_core::session] Authenticated as 'tester' !");\nsetInterval(() => {}, 1000);\n`);
  chmodSync(fake, 0o755);
  service = createSpotifyService(
    { storeDir: dir, log: () => {} },
    { accounts: `${base}/accounts`, api: `${base}/api`, relay: `${base}/relay`, librespot: fake, settleMs: 0 },
  );
});

afterAll(() => {
  service.close?.();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

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

const until = async (check: () => Promise<boolean> | boolean, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(100)) if (await check()) return;
  throw new Error("timed out");
};

test("the Web API's objects in the contract's shapes", () => {
  expect(map.cover([cover(640), cover(300), cover(64)])).toBe("https://i.scdn.co/image/300");
  expect(map.cover([cover(64), cover(160)])).toBe("https://i.scdn.co/image/160");
  expect(map.cover(undefined)).toBe("");
  const t = map.track(TRACK)!;
  expect(t).toMatchObject({ kind: "track", title: "Low Tide", subtitle: "Harbor Lights", durationMs: 201000, image: "https://i.scdn.co/image/300", album: { id: "al1" } });
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
  expect(map.readToken(null)).toEqual({ offset: 0, after: null });
  expect(map.failure(403, { error: { message: "Premium required", reason: "PREMIUM_REQUIRED" } }).reason).toBe("premium");
  expect(map.failure(404, { error: { message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }).reason).toBe("nodevice");
  expect(map.failure(429, {}).reason).toBe("rate");
  expect(map.player(null, SPEAKER_NAME, 5).active).toBe(false);
});

test("a sign-in goes through the relay with PKCE; the token stays on the device; the speaker starts with it", async () => {
  expect((await call("GET", "/status")).json).toMatchObject({ configured: false, signedIn: false });
  expect((await call("POST", "/signin")).json.reason).toBe("configure");
  expect((await call("POST", "/config", { clientId: "short" })).status).toBe(400);
  expect((await call("POST", "/config", { clientId: CLIENT })).json.configured).toBe(true);

  const started = (await call("POST", "/signin")).json;
  const url = new URL(started.signIn.url);
  expect(url.origin + url.pathname).toBe(`${base}/accounts/authorize`);
  expect(url.searchParams.get("client_id")).toBe(CLIENT);
  expect(url.searchParams.get("redirect_uri")).toBe(`${base}/relay/oauth/spotify`);
  expect(url.searchParams.get("scope")).toContain("streaming");
  const state = url.searchParams.get("state")!;
  expect(state.length).toBeGreaterThanOrEqual(43);

  // the phone comes back to the relay
  relayed[state] = { code: "the-code" };
  await until(async () => (await call("GET", "/status")).json.signedIn === true);
  const exchange = tokenForms.find((f) => f.get("grant_type") === "authorization_code")!;
  expect(exchange.get("code")).toBe("the-code");
  expect(exchange.get("redirect_uri")).toBe(`${base}/relay/oauth/spotify`);
  const challenge = createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url");
  expect(challenge).toBe(url.searchParams.get("code_challenge")!);
  const tokenFile = join(dir, "services", "spotify", "token.json");
  expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(tokenFile, "utf8")).refreshToken).toBe("refresh-1");
  const status = (await call("GET", "/status")).json;
  expect(status.user).toMatchObject({ id: "tester", name: "Tess Ter" });
  expect(JSON.stringify(status)).not.toContain("refresh-1");
  expect(JSON.stringify(status)).not.toContain("access-1");

  // librespot signs in once with the Web API token, and keeps its own credentials
  await until(async () => (await call("GET", "/status")).json.speaker.state === "ready");
  const argv: string[] = JSON.parse(readFileSync(join(dir, "argv.json"), "utf8"));
  expect(argv).toContain("--access-token");
  expect(argv[argv.indexOf("--access-token") + 1]).toBe("access-1");
  expect(argv[argv.indexOf("--name") + 1]).toBe(SPEAKER_NAME);
  expect(argv[argv.indexOf("--backend") + 1]).toBe("pulseaudio");
});

test("home, pages and search in the contract's shapes", async () => {
  const home = (await call("GET", "/home")).json;
  // the album played twice is one tile
  expect(home.recent.map((i: { uri: string }) => i.uri)).toEqual([ALBUM.uri]);
  expect(home.playlists[0]).toMatchObject({ kind: "liked", uri: "spotify:user:tester:collection", count: 41 });
  expect(home.playlists[1]).toMatchObject({ kind: "playlist", title: "Walks", subtitle: "By Tess Ter", count: 3 });
  expect(home.albums[0].title).toBe("Night Ferry");
  expect(home.artists[0].kind).toBe("artist");

  const mine = (await call("GET", "/playlist/pl1")).json;
  expect(mine.playlist.description).toBe("For walks");
  expect(mine.tracks.items[0].title).toBe("Low Tide");
  // a playlist Spotify does not list to the app
  expect((await call("GET", "/playlist/editorial")).json.tracks).toBeNull();

  const album = (await call("GET", "/album/al1")).json;
  expect(album.tracks.items[0].image).toBe("https://i.scdn.co/image/300");
  expect(album.liked).toBe(true);

  const found = (await call("GET", "/search?q=low&type=track")).json;
  expect(found.items[0].uri).toBe(TRACK.uri);
  expect(found.next).toBe("o1");
  expect(seen.find((s) => s.path.startsWith("/search"))!.path).toContain("limit=10");
  const liked = (await call("GET", "/library/tracks")).json;
  expect(liked).toMatchObject({ total: 41, next: "o1" });
});

test("play goes to the active device, the player maps, a 401 refreshes once, Premium is a reason", async () => {
  const devices = (await call("GET", "/devices")).json;
  expect(devices[0]).toMatchObject({ id: "dev-local", local: true, type: "GameConsole" });

  seen.length = 0;
  const player = (await call("POST", "/play", { context: ALBUM.uri, offset: { uri: TRACK.uri } })).json;
  const put = seen.find((s) => s.method === "PUT" && s.path.startsWith("/me/player/play"))!;
  // the phone is the active device
  expect(put.path).toBe("/me/player/play?device_id=dev-phone");
  expect(JSON.parse(put.body)).toEqual({ context_uri: ALBUM.uri, offset: { uri: TRACK.uri } });
  expect(player).toMatchObject({ active: true, playing: true, progressMs: 1234, repeat: "context", liked: true, context: { uri: ALBUM.uri, title: "Night Ferry" }, device: { local: true } });

  expect((await call("POST", "/play", { uris: [TRACK.uri], deviceId: "dev-local" })).status).toBe(200);
  expect(seen.filter((s) => s.path.startsWith("/me/player/play")).pop()!.path).toBe("/me/player/play?device_id=dev-local");

  failNextWith401 = true;
  const before = tokenForms.length;
  expect((await call("GET", "/queue")).status).toBe(404); // the fake has no queue; the point is the retry
  expect(tokenForms.length).toBe(before + 1);
  expect(tokenForms.at(-1)!.get("grant_type")).toBe("refresh_token");
  expect(seen.at(-1)!.auth).toBe("Bearer access-2");

  const premium = await call("POST", "/next");
  expect(premium.status).toBe(403);
  expect(premium.json.reason).toBe("premium");

  expect((await call("POST", "/like", { uri: TRACK.uri, liked: false })).json).toEqual({ liked: false });
  expect(seen.at(-1)).toMatchObject({ method: "DELETE", path: `/me/library?uris=${encodeURIComponent(TRACK.uri)}` });
  expect((await call("POST", "/like", { uri: "javascript:1" })).status).toBe(400);
});

test("signing out forgets the token and the speaker's credentials", async () => {
  const out = (await call("POST", "/signout")).json;
  expect(out).toMatchObject({ signedIn: false, user: null, speaker: { state: "off" } });
  expect(existsSync(join(dir, "services", "spotify", "token.json"))).toBe(false);
  expect(existsSync(join(dir, "services", "spotify", "librespot"))).toBe(false);
  expect((await call("GET", "/home")).json.reason).toBe("signin");
});
