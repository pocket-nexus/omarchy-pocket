// The Web API's objects as the spotify service's (vendor/applets/spotify/contract.ts):
// pure functions, tested in daemon/test/spotify.test.ts. The Web API's shapes
// are those of 2026: a playlist's tracks are under `items` and each entry's
// track under `item` (the February 2026 migration renamed `tracks`/`track`;
// both names are read), and a list of something the reader cannot see comes
// back null.
import type { Device, Failure, Item, Page, Player, Queue, Ref } from "../vendor/applets/spotify/contract.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const COVER_PX = 300;

/** The cover nearest 300 px: the smallest at least that wide, else the largest. */
export function cover(images: Json): string {
  const list = Array.isArray(images) ? images.filter((i) => i && typeof i.url === "string") : [];
  if (!list.length) return "";
  const sized = list.map((i) => ({ url: i.url as string, w: typeof i.width === "number" ? i.width : 0 }));
  const big = sized.filter((i) => i.w >= COVER_PX).sort((a, b) => a.w - b.w);
  if (big.length) return big[0]!.url;
  return sized.sort((a, b) => b.w - a.w)[0]!.url;
}

const ref = (o: Json): Ref => ({ id: String(o?.id ?? ""), uri: String(o?.uri ?? ""), name: String(o?.name ?? "") });
const names = (artists: Json): string => (Array.isArray(artists) ? artists.map((a) => a?.name).filter(Boolean).join(", ") : "");

export function track(t: Json): Item | null {
  if (!t || typeof t !== "object" || !t.uri) return null;
  const episode = t.type === "episode";
  return {
    kind: episode ? "episode" : "track",
    id: String(t.id ?? ""),
    uri: String(t.uri),
    title: String(t.name ?? ""),
    subtitle: episode ? String(t.show?.name ?? "") : names(t.artists),
    image: cover(episode ? (t.images ?? t.show?.images) : t.album?.images),
    durationMs: typeof t.duration_ms === "number" ? t.duration_ms : 0,
    explicit: t.explicit === true,
    album: t.album ? ref(t.album) : undefined,
    artists: Array.isArray(t.artists) ? t.artists.map(ref) : undefined,
    trackNumber: typeof t.track_number === "number" ? t.track_number : undefined,
    playable: t.is_playable === false || t.is_local === true ? false : undefined,
  };
}

export function album(a: Json): Item | null {
  if (!a || typeof a !== "object" || !a.uri) return null;
  const total = a.total_tracks ?? a.tracks?.total;
  return {
    kind: "album",
    id: String(a.id ?? ""),
    uri: String(a.uri),
    title: String(a.name ?? ""),
    subtitle: names(a.artists),
    image: cover(a.images),
    artists: Array.isArray(a.artists) ? a.artists.map(ref) : undefined,
    count: typeof total === "number" ? total : undefined,
    year: typeof a.release_date === "string" ? a.release_date.slice(0, 4) : undefined,
  };
}

/** A playlist's tracks object: `items` since February 2026, `tracks` before. */
const entries = (p: Json): Json => p?.items ?? p?.tracks;

export function playlist(p: Json): Item | null {
  if (!p || typeof p !== "object" || !p.uri) return null;
  const total = entries(p)?.total;
  return {
    kind: "playlist",
    id: String(p.id ?? ""),
    uri: String(p.uri),
    title: String(p.name ?? ""),
    subtitle: p.owner?.display_name ? `By ${p.owner.display_name}` : "Playlist",
    image: cover(p.images),
    count: typeof total === "number" ? total : undefined,
  };
}

export function artist(a: Json): Item | null {
  if (!a || typeof a !== "object" || !a.uri) return null;
  return { kind: "artist", id: String(a.id ?? ""), uri: String(a.uri), title: String(a.name ?? ""), subtitle: "Artist", image: cover(a.images) };
}

/** Liked Songs as a row of its own. */
export const liked = (userId: string, count: number | null): Item => ({
  kind: "liked",
  id: "",
  uri: `spotify:user:${userId}:collection`,
  title: "Liked Songs",
  subtitle: count === null ? "Playlist" : `${count} songs`,
  image: "",
  count: count ?? undefined,
});

/** One entry of a playlist's or a library's track list: `{item}` since 2026, `{track}` before. */
export const entryTrack = (e: Json): Item | null => track(e?.item ?? e?.track ?? e);

/** A page token: the offset of the next page (`o40`) or a cursor (`cXYZ`). */
export function nextToken(paging: Json, offset: number): string | null {
  if (!paging || !paging.next) return null;
  const cursor = paging.cursors?.after;
  if (cursor) return `c${cursor}`;
  const items = Array.isArray(paging.items) ? paging.items.length : 0;
  return `o${offset + items}`;
}

export function readToken(token: string | null): { offset: number; after: string | null } {
  if (token?.startsWith("c")) return { offset: 0, after: token.slice(1) };
  const offset = token?.startsWith("o") ? Number(token.slice(1)) : 0;
  return { offset: Number.isInteger(offset) && offset > 0 ? offset : 0, after: null };
}

export function page(paging: Json, offset: number, map: (o: Json) => Item | null): Page {
  const items = Array.isArray(paging?.items) ? paging.items.map(map).filter((i: Item | null): i is Item => i !== null) : [];
  return { items, total: typeof paging?.total === "number" ? paging.total : null, next: nextToken(paging, offset) };
}

export function device(d: Json, speakerName: string): Device {
  return {
    id: String(d?.id ?? ""),
    name: String(d?.name ?? ""),
    type: String(d?.type ?? "Unknown"),
    volume: d?.supports_volume === false || typeof d?.volume_percent !== "number" ? null : d.volume_percent,
    active: d?.is_active === true,
    local: d?.name === speakerName,
    restricted: d?.is_restricted === true,
  };
}

/** What the player answers, with nothing playing anywhere as `active: false`. */
export function player(p: Json, speakerName: string, now: number, liked = false, contextTitle = ""): Player {
  if (!p || typeof p !== "object") {
    return { active: false, playing: false, item: null, progressMs: 0, at: now, shuffle: false, repeat: "off", context: null, device: null, liked: false };
  }
  const repeat = p.repeat_state === "track" || p.repeat_state === "context" ? p.repeat_state : "off";
  return {
    active: true,
    playing: p.is_playing === true,
    item: track(p.item),
    progressMs: typeof p.progress_ms === "number" ? p.progress_ms : 0,
    at: now,
    shuffle: p.shuffle_state === true,
    repeat,
    context: p.context?.uri ? { uri: String(p.context.uri), title: contextTitle } : null,
    device: p.device ? device(p.device, speakerName) : null,
    liked,
  };
}

export function queue(q: Json): Queue {
  return { now: track(q?.currently_playing), next: Array.isArray(q?.queue) ? q.queue.slice(0, 30).map(track).filter((t: Item | null): t is Item => t !== null) : [] };
}

/** A Web API failure as the contract's reason. */
export function failure(status: number, body: Json): Failure {
  const message: string = typeof body?.error?.message === "string" ? body.error.message : typeof body?.error === "string" ? body.error : `Spotify answered ${status}`;
  const reason: string = typeof body?.error?.reason === "string" ? body.error.reason : "";
  if (status === 401) return { error: "Spotify asks to sign in again.", reason: "signin" };
  if (status === 429) return { error: "Spotify asked to wait a moment.", reason: "rate" };
  if (reason === "PREMIUM_REQUIRED" || /premium/i.test(message)) return { error: "Spotify Premium is needed to play.", reason: "premium" };
  if (reason === "NO_ACTIVE_DEVICE" || (status === 404 && /device/i.test(message))) return { error: "Nothing is playing anywhere.", reason: "nodevice" };
  if (status === 403 && /restrict/i.test(`${reason} ${message}`)) return { error: "That device does not take commands.", reason: "restricted" };
  return { error: message, reason: "other" };
}
