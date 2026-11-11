// `omarchy-shell pocket.input hold <BUTTON> [frames]` holds a gamepad button
// for some frames (default 2) as if it were pressed on the device,
// `omarchy-shell pocket.input tap <x> <y>` taps the deck,
// `omarchy-shell pocket.input drag <x> <y> <x2> <y2> [frames] [hold]` drags a
// finger across it (after holding it still for `hold` frames),
// `omarchy-shell pocket.input drag2 <x> <y> <x2> <y2> [frames] [apart]` drags
// two fingers `apart` points side by side (default 80), and
// `omarchy-shell pocket.input type <text>` types on the touch keyboard, and
// `omarchy-shell pocket.input pointer <x> <y>` puts the stage pointer at a
// point and `click` clicks there. On the uConsole, `ball <dx> <dy> [frames]
// [buttons]` rolls the trackball (buttons: 1 L, 2 R, 4 the ball's press),
// `wheel <detents>` turns its wheel, `hardkey <name>` presses a keyboard key
// as the host names it (Enter, Meta+w, Control+c), `hardtext <text>` types
// on the keyboard and `super` reports the SUPER layer. They drive the shell
// over SSH for testing; the names are BTN's (UP, CIRCLE, START, ...).
import { BTN } from "@pocketjs/framework/input";
import { holdStick } from "./stick.ts";
import { serve } from "./system.ts";
import { sendKey } from "./term/keyboard.tsx";
import { chooseLayout, LAYOUTS, type Layout } from "./focus.ts";
import { click, movePointer, pointer } from "./stage/pointer.tsx";
import { watchFor, watchTick, watching } from "./watch.ts";
import { injectTrackball, trackballAwake } from "./trackball.ts";
import { hardKey } from "./hardkeys.ts";
import { latched, superLayer } from "./super.ts";
export { watching };

const held: { mask: number; frames: number }[] = [];
/** queued taps: each is a contact for TAP_FRAMES frames (a drag: from x,y to
 *  x2,y2 over its frames), then a lift */
const taps: { x: number; y: number; frames: number; x2?: number; y2?: number; total?: number; hold?: number; apart?: number }[] = [];
const TAP_FRAMES = 3;

serve("pocket.input", {
  hold: (name, frames = "2") => {
    const mask = (BTN as Record<string, number>)[name ?? ""];
    if (!mask) throw new Error(`no button ${name}`);
    held.push({ mask, frames: Math.max(1, Number(frames) || 2) });
    return "ok";
  },
  tap: (x, y) => (taps.push({ x: Number(x), y: Number(y), frames: TAP_FRAMES + 1 }), "ok"),
  /** a stick pushed to (x, y), each -1..1, for `frames` frames (stick.ts) */
  stick: (x, y, frames = "30") => (holdStick(Math.max(-1, Math.min(1, Number(x) || 0)), Math.max(-1, Math.min(1, Number(y) || 0)), Math.max(1, Number(frames) || 30)), "ok"),
  pointer: (x, y) => (movePointer(Number(x) - pointer().x, Number(y) - pointer().y), "ok"),
  click: () => (click(), "ok"),
  drag: (x, y, x2, y2, frames = "20", hold = "0") => {
    const total = Math.max(4, Number(frames) || 20);
    const still = Math.max(0, Number(hold) || 0);
    taps.push({ x: Number(x), y: Number(y), x2: Number(x2), y2: Number(y2), frames: still + total + 1, total, hold: still });
    return "ok";
  },
  drag2: (x, y, x2, y2, frames = "20", apart = "80") => {
    const total = Math.max(4, Number(frames) || 20);
    taps.push({ x: Number(x), y: Number(y), x2: Number(x2), y2: Number(y2), frames: total + 1, total, hold: 0, apart: Number(apart) || 80 });
    return "ok";
  },
  /** text typed on the touch keyboard, to whatever has the keys */
  type: (text) => {
    for (const ch of text ?? "") sendKey(ch);
    return "ok";
  },
  /** a named key (Enter, Escape, Up, ...) on the keyboard */
  key: (name) => (sendKey(name ?? ""), "ok"),
  /** the deck's layout, keys or pad, as the round keyboard button picks it */
  layout: (name) => {
    if (!LAYOUTS.includes(name as Layout)) throw new Error(`no layout ${name}`);
    chooseLayout(name as Layout);
    return "ok";
  },
  ball: (dx, dy, frames = "1", buttons = "0") => {
    const n = Math.max(1, Number(frames) || 1);
    for (let i = 0; i < n; i++) injectTrackball([Math.round(Number(dx) / n), Math.round(Number(dy) / n), 0, Number(buttons) || 0]);
    return "ok";
  },
  /** a button of the ball's held for `frames` (1 L, 2 R, 4 the ball's press) */
  button: (bits = "1", frames = "3") => {
    for (let i = 0; i < Math.max(1, Number(frames) || 3); i++) injectTrackball([0, 0, 0, Number(bits) || 1]);
    injectTrackball([0, 0, 0, 0]);
    return "ok";
  },
  wheel: (detents = "1") => (injectTrackball([0, 0, Number(detents) || 0, 0]), "ok"),
  hardkey: (name) => {
    for (const mod of ["Meta", "Shift", "Control", "Alt"]) if (name?.startsWith(`${mod}+`)) hardKey({ kind: "key", key: mod, pressed: true, repeat: false });
    hardKey({ kind: "key", key: name ?? "", pressed: true, repeat: false });
    for (const mod of ["Meta", "Shift", "Control", "Alt"]) if (name?.startsWith(`${mod}+`)) hardKey({ kind: "key", key: mod, pressed: false, repeat: false });
    return "ok";
  },
  hardtext: (text) => (hardKey({ kind: "commit", text: text ?? "" }), "ok"),
  super: () => `${superLayer()}${latched() ? " latched" : ""}`,
  /** the stage pointer's place and whether the trackball has woken it */
  where: () => `${pointer().x.toFixed(0)},${pointer().y.toFixed(0)}${trackballAwake() ? " shown" : ""}`,
  /** logs the deck's contacts for `frames` frames (the host's stderr) */
  watch: (frames = "120") => {
    watchFor(Math.max(1, Number(frames) || 120));
    return "ok";
  },
});

/** Once per frame: the contacts the panel reports, while a watch is on. */
export function watchTouches(contacts: readonly { id: number; x: number; y: number }[]) {
  if (!watchTick()) return;
  if (contacts.length) console.log(`touch ${contacts.map((c) => `${c.id}@${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(" ")}`);
}

/** The buttons held for this frame. */
export function remoteButtons(): number {
  let mask = 0;
  for (const h of held) if (h.frames-- > 0) mask |= h.mask;
  for (let i = held.length - 1; i >= 0; i--) if (held[i]!.frames <= 0) held.splice(i, 1);
  return mask;
}

/** This frame's contacts on the deck from a queued tap: a few frames down,
 *  then one frame up (none) before the next tap starts. */
export function remoteContacts(): { x: number; y: number }[] {
  const tap = taps[0];
  if (!tap) return [];
  tap.frames--;
  if (tap.frames <= 0) {
    taps.shift();
    return [];
  }
  if (tap.total === undefined) return [tap];
  const t = Math.max(0, Math.min(1, (tap.total - tap.frames) / (tap.total - 1)));
  const at = { x: tap.x + (tap.x2! - tap.x) * t, y: tap.y + (tap.y2! - tap.y) * t };
  return tap.apart ? [at, { x: at.x + tap.apart, y: at.y }] : [at];
}
