// Taps and drags on the deck, one per contact id. A contact counts once it
// has stayed down for SETTLE frames, and it taps at its lift, where it was
// last seen. A contact lifted sooner is dropped: the Goodix panel reports
// brief contacts at a finger's previous position, and before this filter a
// key tapped after `s` sent `s` again (`ls` + Enter ran `lss`). Each finger
// is its own tap, so a second thumb landing before the first lifts presses
// its own key in turn instead of taking over the first one's. A contact that
// travelled more than SLOP from where it landed is a drag: its lift reports
// `moved`, and lists scroll by its `dy` while it is down.
import { auxiliaryTouches } from "@pocketjs/framework/input";
import { remoteContact } from "./remote-input.ts";

const SETTLE = 2;
const SLOP = 10;

export interface Point {
  x: number;
  y: number;
}

export interface Contact extends Point {
  /** where it landed: a tap belongs to the band it began in */
  start: Point;
  /** movement since the last frame */
  dx: number;
  dy: number;
  moved: boolean;
}

interface Tracked extends Contact {
  frames: number;
}

const live = new Map<number, Tracked>();

/** The remote tap's id, outside the panel's 0..255 */
const REMOTE = 1000;

export interface TouchFrame {
  /** contacts on the panel this frame, settled or not */
  raw: number;
  /** settled contacts still down, oldest first */
  down: Contact[];
  /** settled contacts that lifted this frame */
  taps: Contact[];
}

/** Advances the tracker one frame; call once per frame. */
export function trackTouches(): TouchFrame {
  const now = new Map<number, Point>();
  for (const c of auxiliaryTouches()) now.set(c.id, { x: c.x, y: c.y });
  const remote = remoteContact();
  if (remote) now.set(REMOTE, remote);
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
    } else live.set(id, { x: p.x, y: p.y, dx: 0, dy: 0, moved: false, frames: 1, start: { ...p } });
  }
  const down = [...live.values()].filter((t) => t.frames >= SETTLE).map(({ frames: _, ...c }) => c);
  return { raw: now.size, down, taps };
}

/** The part of a frame whose contacts began inside [top, bottom), moved up by `top`. */
export function band(frame: TouchFrame, top: number, bottom: number): TouchFrame {
  const inside = (c: Contact) => c.start.y >= top && c.start.y < bottom;
  const shift = (c: Contact): Contact => ({ ...c, y: c.y - top, start: { x: c.start.x, y: c.start.y - top } });
  return { raw: frame.raw, down: frame.down.filter(inside).map(shift), taps: frame.taps.filter(inside).map(shift) };
}
