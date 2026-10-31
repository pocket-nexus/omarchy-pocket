// Taps and drags on the deck, one per contact id. A contact is reported from
// its first frame, so a key lights the frame a finger lands; it taps at its
// lift, where it was last seen, once it has stayed down for SETTLE frames.
// A contact lifted sooner taps nothing: the Goodix panel reports brief
// contacts at a finger's previous position, and before this filter a key
// tapped after `s` sent `s` again (`ls` + Enter ran `lss`). Each finger is
// its own tap, so a second thumb landing before the first lifts presses its
// own key in turn instead of taking over the first one's. A contact that
// travelled more than SLOP from where it landed is a drag: its lift reports
// `moved`, and lists scroll by its `dy` while it is down.
import { auxiliaryTouches } from "@pocketjs/framework/input";
import { remoteContacts, watchTouches } from "./remote-input.ts";

const SETTLE = 2;
const SLOP = 10;

export interface Point {
  x: number;
  y: number;
}

export interface Contact extends Point {
  id: number;
  /** frames since it landed */
  frames: number;
  /** where it landed: a tap belongs to the band it began in */
  start: Point;
  /** movement since the last frame */
  dx: number;
  dy: number;
  moved: boolean;
}

const live = new Map<number, Contact>();

/** The remote tap's id, outside the panel's 0..255 */
const REMOTE = 1000;

export interface TouchFrame {
  /** contacts on the panel this frame */
  raw: number;
  /** contacts down this frame, oldest first; `frames` says how long */
  down: Contact[];
  /** settled contacts that lifted this frame */
  taps: Contact[];
}

/** Advances the tracker one frame; call once per frame. */
export function trackTouches(): TouchFrame {
  const now = new Map<number, Point>();
  const contacts = auxiliaryTouches();
  watchTouches(contacts);
  for (const c of contacts) now.set(c.id, { x: c.x, y: c.y });
  remoteContacts().forEach((p, i) => now.set(REMOTE + i, p));
  const taps: Contact[] = [];
  for (const [id, t] of live) {
    if (now.has(id)) continue;
    live.delete(id);
    if (t.frames >= SETTLE) taps.push({ ...t, dx: 0, dy: 0 });
  }
  for (const [id, p] of now) {
    const t = live.get(id);
    if (t) {
      t.dx = p.x - t.x;
      t.dy = p.y - t.y;
      t.x = p.x;
      t.y = p.y;
      t.frames++;
      t.moved ||= Math.abs(p.x - t.start.x) > SLOP || Math.abs(p.y - t.start.y) > SLOP;
    } else live.set(id, { id, x: p.x, y: p.y, dx: 0, dy: 0, moved: false, frames: 1, start: { ...p } });
  }
  const down = [...live.values()].map((c) => ({ ...c }));
  return { raw: now.size, down, taps };
}

/** Whether a contact has stayed down long enough to count as a finger. */
export const settled = (c: Contact) => c.frames >= SETTLE;

/** The part of a frame whose contacts began inside [top, bottom), moved up by `top`. */
export function band(frame: TouchFrame, top: number, bottom: number): TouchFrame {
  const inside = (c: Contact) => c.start.y >= top && c.start.y < bottom;
  const shift = (c: Contact): Contact => ({ ...c, y: c.y - top, start: { x: c.start.x, y: c.start.y - top } });
  return { raw: frame.raw, down: frame.down.filter(inside).map(shift), taps: frame.taps.filter(inside).map(shift) };
}
