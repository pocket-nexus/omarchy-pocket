// The deck's keyboard: ten keys to a row with a letters layer and two symbol
// layers (123, #+=), Backspace at the end of the home row and Return under it
// at the end of the next, as on a laptop, and along the bottom the modifiers,
// the space bar and the four arrows in a row, each a full key. It is the top
// half of the deck's `keys` layout (deck/geometry.ts), with the trackpad under
// it, and the whole deck while the screen is locked, where it sits on the
// bottom edge under the password field. Esc, Tab and the keys a target wants
// at one press are the function row's (deck/strip.tsx), and so are a pinyin
// composition's preedit and candidates.
//
// A key lights the frame a finger lands and types the frame the finger
// settles (two frames in, touch.ts), as a hardware key does: nothing waits
// on the lift. Backspace and the arrows repeat while held, up to REPEAT_MAX
// times a press. Shift is one-shot, twice in a row locks capitals; Ctrl and
// Alt latch for the next key, and the chord they make shows above the keys
// (Ctrl then L sends ^L, which clears a terminal and types nothing). Each
// finger is its own key press.
import { createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { keySink } from "../focus.ts";
import { sendRepeat } from "../keys.ts";
import { watching } from "../remote-input.ts";
import { color } from "../theme.ts";
import { chinese, route, toggleChinese } from "./ime.ts";
import type { Contact, TouchFrame } from "../touch.ts";
import { KEY_PITCH, KEYS_BOTTOM, KEYS_TOP } from "../deck/geometry.ts";
import { DECK_H, DECK_W } from "../screen.ts";

type Layer = "abc" | "123" | "sym";

interface Key {
  label: string;
  /** a character, or a key name for host/keys.ts */
  key: string;
  shifted?: string;
  /** width in key units (a tenth of the row) */
  w?: number;
  modifier?: "shift" | "ctrl" | "alt";
  layer?: Layer;
  /** the 中/EN switch */
  ime?: boolean;
  /** repeats while held */
  repeat?: boolean;
}

const BACKSPACE = "\u{f006e}";
const ENTER = "\u{f0311}";
const chars = (row: string, shifted = row.toUpperCase(), w?: number): Key[] => [...row].map((ch, i) => ({ label: ch, key: ch, shifted: shifted[i], w }));
/** the home row's last key: Backspace, with Return under it */
const backspace: Key = { label: BACKSPACE, key: "Backspace", w: 1.45, repeat: true };
const enter: Key = { label: ENTER, key: "Enter", w: 1.5 };
/** an arrow's width: four in a row, each as tall as a letter */
const ARROW = 0.85;
const bottom = (layer: Layer): Key[] => [
  layer === "abc" ? { label: "123", key: "", w: 1.1, layer: "123" } : { label: "ABC", key: "", w: 1.1, layer: "abc" },
  { label: "EN", key: "", w: 0.85, ime: true },
  { label: "Ctrl", key: "", w: 0.95, modifier: "ctrl" },
  { label: "Alt", key: "", w: 0.95, modifier: "alt" },
  { label: "", key: " ", w: 2.05 },
  { label: ".", key: ".", w: 0.7 },
  { label: "\u{2190}", key: "Left", w: ARROW, repeat: true },
  { label: "\u{2191}", key: "Up", w: ARROW, repeat: true },
  { label: "\u{2193}", key: "Down", w: ARROW, repeat: true },
  { label: "\u{2192}", key: "Right", w: ARROW, repeat: true },
];
const SHORT = 0.95;
const LAYERS: Record<Layer, { rows: Key[][]; inset: number[] }> = {
  abc: {
    rows: [
      chars("qwertyuiop"),
      [...chars("asdfghjkl", undefined, SHORT), backspace],
      [{ label: "\u{21e7}", key: "", w: 1.5, modifier: "shift" }, ...chars("zxcvbnm"), enter],
      bottom("abc"),
    ],
    inset: [0, 0, 0, 0],
  },
  "123": {
    rows: [chars("1234567890", "1234567890"), [...chars("-/:;()$&@", "-/:;()$&@", SHORT), backspace], [{ label: "#+=", key: "", w: 1.5, layer: "sym" }, ...chars(".,?!'\"", ".,?!'\"", 7 / 6), enter], bottom("123")],
    inset: [0, 0, 0, 0],
  },
  sym: {
    rows: [chars("[]{}#%^*+=", "[]{}#%^*+="), [...chars("_\\|~<>`¥£", "_\\|~<>`¥£", SHORT), backspace], [{ label: "123", key: "", w: 1.5, layer: "123" }, ...chars(".,?!'•", ".,?!'•", 7 / 6), enter], bottom("sym")],
    inset: [0, 0, 0, 0],
  },
};

/** ten keys across the deck (51.2 points on the RG DS Plus, 41.3 on the Thor, 42.6 on the Duo Lite) */
const UNIT = DECK_W / 10;
const GAP = 5;
/** Row height on the lock, where the keys have the deck to themselves. */
const FULL_PITCH = 46;
const EDGE = 6;
const REPEAT_AFTER = 24;
const REPEAT_EVERY = 4;
/** repeats one press may send: a lift the panel never reports ends there */
const REPEAT_MAX = 40;
const CHORD_S = 1.4;

/** Where the keys sit: the whole deck (the lock) or the deck's body under its strip. */
export type KeyboardMode = "full" | "body";

interface Placed extends Key {
  x: number;
  y: number;
  w: number;
  h: number;
  /** a key that shows a preview */
  char: boolean;
  /** a finger is on it: its own signal, so a press repaints two keys, not the whole keyboard */
  lit: () => boolean;
  setLit: (on: boolean) => void;
}

const placeRow = (row: Key[], inset: number, y: number, h: number): Placed[] => {
  let x = inset * UNIT;
  return row.map((key) => {
    const w = (key.w ?? 1) * UNIT;
    const [lit, setLit] = createSignal(false);
    const p: Placed = { ...key, x, y, w, h, char: [...key.key].length === 1 && key.key !== " ", lit, setLit };
    x += w;
    return p;
  });
};

/** The keys of `layer` laid out for `mode`. */
function layoutFor(mode: KeyboardMode, layer: Layer) {
  const rows = LAYERS[layer].rows;
  const pitch = mode === "full" ? FULL_PITCH : KEY_PITCH;
  const top = mode === "full" ? DECK_H - EDGE - rows.length * FULL_PITCH : KEYS_TOP;
  const keys = rows.flatMap((row, r) => placeRow(row, LAYERS[layer].inset[r]!, top + r * pitch, pitch));
  return { keys, top, bottom: mode === "full" ? DECK_H : KEYS_BOTTOM };
}
const LAYOUTS = new Map<string, ReturnType<typeof layoutFor>>();
const layout = (mode: KeyboardMode, layer: Layer) => {
  const id = `${mode}:${layer}`;
  let l = LAYOUTS.get(id);
  if (!l) LAYOUTS.set(id, (l = layoutFor(mode, layer)));
  return l;
};

const [mods, setMods] = createSignal({ shift: false, ctrl: false, alt: false });
const [capsLock, setCapsLock] = createSignal(false);
const [layer, setLayer] = createSignal<Layer>("abc");
/** keys under a finger, as of the last frame */
let pressed: Placed[] = [];
/** the chord last sent, shown above the keys for CHORD_S */
const [chord, setChord] = createSignal("");

export const modifiers = mods;

let lastShift = -1;
let frameCount = 0;
export function latch(modifier: "shift" | "ctrl" | "alt") {
  if (modifier === "shift") {
    // twice within 20 frames locks capitals; a tap on a lock releases it
    if (capsLock()) {
      setCapsLock(false);
      setMods((m) => ({ ...m, shift: false }));
      return;
    }
    if (frameCount - lastShift < 20) {
      setCapsLock(true);
      return;
    }
    lastShift = frameCount;
  }
  setMods((m) => ({ ...m, [modifier]: !m[modifier] }));
}

/** The keyboard starts fresh for a new sink: no latched modifiers, letters. */
export function resetKeyboard() {
  setMods({ shift: false, ctrl: false, alt: false });
  setCapsLock(false);
  setLayer("abc");
}

/** Says what a chord sent; the trackpad's line shows it for CHORD_S. */
export function showChord(name: string) {
  setChord(name);
  after(CHORD_S, () => setChord(""));
}
export { chord as chordSent };

/** A key was typed: the pointer steps aside, as a laptop's does. */
let typedHook: () => void = () => {};
export const onTyped = (hook: () => void) => (typedHook = hook);
const typed = () => typedHook();

const chordName = (m: { ctrl: boolean; alt: boolean }, name: string) => `${m.ctrl ? "^" : ""}${m.alt ? "M-" : ""}${name.length === 1 ? name.toUpperCase() : name}`;

/** Sends one key, with the latched modifiers; through pinyin composition in
 *  中 mode, except into a text field. */
export function sendKey(key: string, shifted?: string) {
  const m = mods();
  const shift = m.shift || capsLock();
  setMods({ shift: false, ctrl: false, alt: false });
  const name = shift && shifted ? shifted : key;
  if (m.ctrl || m.alt) showChord(chordName(m, name));
  typed();
  const sink = keySink();
  const direct = () => {
    if ([...key].length === 1 && !m.ctrl && !m.alt) sink.text(name);
    else sink.key(name, { ctrl: m.ctrl, alt: m.alt, shift: shift && !shifted });
  };
  if (m.ctrl || m.alt || sink.field) return direct();
  route(name, (text) => sink.text(text), direct);
}

/** A control key from the function row, whatever is latched. */
export function sendCtrl(ch: string) {
  showChord(chordName({ ctrl: true, alt: false }, ch));
  typed();
  keySink().key(ch, { ctrl: true, alt: false, shift: false });
}

const keyAt = (keys: Placed[], x: number, y: number) => keys.find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) ?? null;

function press(key: Placed) {
  if (watching()) console.log(`key ${key.label} press`);
  if (key.modifier) latch(key.modifier);
  else if (key.layer) setLayer(key.layer);
  else if (key.ime) toggleChinese();
  else sendKey(key.key, key.shifted);
}

/** frames each finger has been down and its repeats, for the repeat keys */
const held = new Map<number, { frames: number; repeats: number }>();

/** The keyboard's fingers this frame, in its own coordinates: the keys under
 *  them light, a finger that settles presses the key under it, and a repeat
 *  key keeps pressing while its finger stays. A finger that began off the
 *  keys is not the keyboard's. */
export function keyboardTouch(frame: TouchFrame, mode: KeyboardMode) {
  frameCount++;
  const { keys, top, bottom: edge } = layout(mode, layer());
  const onKeys = (c: Contact) => c.start.y >= top && c.start.y < edge;
  const down = frame.down.filter(onKeys);
  const now = down.map((c) => keyAt(keys, c.x, c.y)).filter((k) => k !== null);
  for (const k of pressed) if (!now.includes(k)) {
    k.setLit(false);
    if (watching()) console.log(`key ${k.label} unlit`);
  }
  for (const k of now) if (!pressed.includes(k)) {
    k.setLit(true);
    if (watching()) console.log(`key ${k.label} lit`);
  }
  pressed = now;
  for (const c of frame.presses) {
    if (!onKeys(c)) continue;
    const key = keyAt(keys, c.x, c.y);
    if (!key) continue;
    press(key);
    if (key.repeat) held.set(c.id, { frames: 0, repeats: 0 });
  }
  for (const c of down) {
    const h = held.get(c.id);
    if (!h) continue;
    h.frames++;
    const key = keyAt(keys, c.x, c.y);
    if (key?.repeat && h.repeats < REPEAT_MAX && h.frames > REPEAT_AFTER && (h.frames - REPEAT_AFTER) % REPEAT_EVERY === 0) {
      h.repeats++;
      sendRepeat(() => press(key));
    }
  }
  for (const t of frame.taps) held.delete(t.id);
}

export function Keyboard(props: { mode: KeyboardMode }) {
  const current = () => layout(props.mode, layer());
  const latched = (k: Placed) => (!!k.modifier && mods()[k.modifier]) || (k.modifier === "shift" && capsLock());
  /** a word on a key: the smaller type */
  const small = (k: Placed) => k.modifier === "ctrl" || k.modifier === "alt" || !!k.layer || !!k.ime;
  const fnKey = (k: Placed) => !k.char && k.key !== " ";
  const label = (k: Placed) => {
    if (k.ime) return chinese() ? "中" : "EN";
    if (k.modifier === "shift" && capsLock()) return "\u{21ea}";
    return (mods().shift || capsLock()) && k.shifted ? k.shifted : k.label;
  };
  return (
    <View class="absolute left-0 top-0 contain-strict" style={{ width: DECK_W, height: props.mode === "full" ? DECK_H : KEYS_BOTTOM + 2 }}>
      <Show when={props.mode === "full" && keySink().field}>
        {(field) => (
          <Text class="absolute left-0 text-center text-lg leading-[24]" style={{ width: DECK_W, insetT: current().top / 2 - 22, textColor: color("bright_foreground") }}>
            {field()()}
          </Text>
        )}
      </Show>
      <Show when={props.mode === "full"}>
        <Text class="absolute left-0 text-center font-mono text-xs leading-[14]" style={{ width: DECK_W, insetT: current().top / 2 + 10, textColor: color("dark_foreground") }}>
          {keySink().hint?.() ?? ""}
        </Text>
      </Show>
      <For each={current().keys}>
        {(k) => (
          <View
            class="absolute rounded-md"
            style={{
              insetL: k.x + GAP / 2,
              insetT: k.y + GAP / 2,
              width: k.w - GAP,
              height: k.h - GAP,
              bgColor: color(k.lit() ? "accent" : latched(k) ? "selection" : fnKey(k) ? "dark_background" : "background"),
            }}
          >
            <Text
              class={small(k) ? "absolute left-0 text-center font-mono text-xs leading-[14]" : "absolute left-0 text-center font-mono text-base leading-[18]"}
              style={{
                width: k.w - GAP,
                insetT: (k.h - GAP) / 2 - (small(k) ? 7 : 9),
                textColor: color(k.lit() ? "background" : latched(k) || (k.ime && chinese()) ? "accent" : fnKey(k) ? "foreground" : "bright_foreground"),
                ...(k.ime && chinese() ? cjk("中", CJK_SLOT_14) : {}),
              }}
            >
              {label(k)}
            </Text>
          </View>
        )}
      </For>
    </View>
  );
}
