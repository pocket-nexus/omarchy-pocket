// The deck's keyboard, laid out like a phone's in landscape: ten keys to a
// row, 46 points from row to row, sitting on the bottom edge, with a letters
// layer and two symbol layers (123, #+=), and above them the row every
// target takes: Esc, Tab, Ctrl, Alt and the arrows. It is the deck's `keys`
// layout, and the whole deck while the screen is locked. The space above
// the keys says where they go (focus.ts): the sink's hint and its close
// button, a text field's value, and, while a pinyin composition is open
// (the 中 key, ime.ts), its preedit and candidates along the keys' top edge.
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
import { watching } from "../remote-input.ts";
import { color } from "../theme.ts";
import { chinese, composing, pick, route, snapshot, toggleChinese } from "./ime.ts";
import type { Contact, TouchFrame } from "../touch.ts";
import { BODY_H } from "../deck/geometry.ts";

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
const backspace: Key = { label: BACKSPACE, key: "Backspace", w: 1.5, repeat: true };
const bottom = (layer: Layer): Key[] => [
  layer === "abc" ? { label: "123", key: "", w: 1.5, layer: "123" } : { label: "ABC", key: "", w: 1.5, layer: "abc" },
  { label: "EN", key: "", ime: true },
  { label: "space", key: " ", w: 5 },
  { label: ".", key: "." },
  { label: ENTER, key: "Enter", w: 1.5 },
];
const LAYERS: Record<Layer, { rows: Key[][]; inset: number[] }> = {
  abc: {
    rows: [
      chars("qwertyuiop"),
      chars("asdfghjkl"),
      [{ label: "\u{21e7}", key: "", w: 1.5, modifier: "shift" }, ...chars("zxcvbnm"), backspace],
      bottom("abc"),
    ],
    inset: [0, 0.5, 0, 0],
  },
  "123": {
    rows: [chars("1234567890", "1234567890"), chars('-/:;()$&@"', '-/:;()$&@"'), [{ label: "#+=", key: "", w: 1.5, layer: "sym" }, ...chars(".,?!'", ".,?!'", 1.4), backspace], bottom("123")],
    inset: [0, 0, 0, 0],
  },
  sym: {
    rows: [chars("[]{}#%^*+=", "[]{}#%^*+="), chars("_\\|~<>`¥£•", "_\\|~<>`¥£•"), [{ label: "123", key: "", w: 1.5, layer: "123" }, ...chars(".,?!'", ".,?!'", 1.4), backspace], bottom("sym")],
    inset: [0, 0, 0, 0],
  },
};
const EXTRAS: Key[] = [
  { label: "Esc", key: "Escape" },
  { label: "Tab", key: "Tab" },
  { label: "Ctrl", key: "", modifier: "ctrl" },
  { label: "Alt", key: "", modifier: "alt" },
  { label: "\u{2190}", key: "Left", repeat: true },
  { label: "\u{2193}", key: "Down", repeat: true },
  { label: "\u{2191}", key: "Up", repeat: true },
  { label: "\u{2192}", key: "Right", repeat: true },
];

const UNIT = 512 / 10;
const PITCH = 46;
const GAP = 6;
const EXTRA_PITCH = 38;
const EDGE = 6;
const REPEAT_AFTER = 24;
const REPEAT_EVERY = 4;
/** repeats one press may send: a lift the panel never reports ends there */
const REPEAT_MAX = 40;
const CHORD_S = 1.4;

/** Where the keys sit: the whole deck (the lock) or the deck's body under its strip. */
export type KeyboardMode = "full" | "body";
const HEIGHT: Record<KeyboardMode, number> = { full: 384, body: BODY_H };

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

/** The keys of `layer` laid out for `mode`, with the Esc/Tab/arrows row above them. */
function layoutFor(mode: KeyboardMode, layer: Layer) {
  const height = HEIGHT[mode];
  const rowsTop = height - EDGE - LAYERS[layer].rows.length * PITCH;
  const extrasTop = rowsTop - EXTRA_PITCH;
  const keys = LAYERS[layer].rows.flatMap((row, r) => placeRow(row, LAYERS[layer].inset[r]!, rowsTop + r * PITCH, PITCH));
  keys.push(...placeRow(EXTRAS.map((k) => ({ ...k, w: 10 / EXTRAS.length })), 0, extrasTop, EXTRA_PITCH));
  return { keys, stripH: extrasTop - 2 };
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

const chordName = (m: { ctrl: boolean; alt: boolean }, name: string) => `${m.ctrl ? "^" : ""}${m.alt ? "M-" : ""}${name.length === 1 ? name.toUpperCase() : name}`;

/** Sends one key, with the latched modifiers; through pinyin composition in
 *  中 mode, except into a text field. */
export function sendKey(key: string, shifted?: string) {
  const m = mods();
  const shift = m.shift || capsLock();
  setMods({ shift: false, ctrl: false, alt: false });
  const name = shift && shifted ? shifted : key;
  if (m.ctrl || m.alt) {
    setChord(chordName(m, name));
    after(CHORD_S, () => setChord(""));
  }
  const sink = keySink();
  const direct = () => {
    if ([...key].length === 1 && !m.ctrl && !m.alt) sink.text(name);
    else sink.key(name, { ctrl: m.ctrl, alt: m.alt, shift: shift && !shifted });
  };
  if (m.ctrl || m.alt || sink.field) return direct();
  route(name, (text) => sink.text(text), direct);
}

const keyAt = (keys: Placed[], x: number, y: number) => keys.find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) ?? null;

function press(key: Placed) {
  if (key.modifier) latch(key.modifier);
  else if (key.layer) setLayer(key.layer);
  else if (key.ime) toggleChinese();
  else sendKey(key.key, key.shifted);
}

/** frames each finger has been down and its repeats, for the repeat keys */
const held = new Map<number, { frames: number; repeats: number }>();

/** The keyboard's fingers this frame, in its own coordinates: the keys under
 *  them light, a finger that settles presses the key under it, and a
 *  repeat key keeps pressing while its finger stays. A finger that settles
 *  above the keys picks a candidate or the close button. */
export function keyboardTouch(frame: TouchFrame, mode: KeyboardMode) {
  frameCount++;
  const { keys, stripH } = layout(mode, layer());
  const onKeys = (c: Contact) => c.start.y >= stripH;
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
    if (!onKeys(c)) {
      stripTap(c.x, c.y, stripH);
      continue;
    }
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
      press(key);
    }
  }
  for (const t of frame.taps) held.delete(t.id);
}

/** The candidate boxes along the strip's bottom edge, after the preedit. */
const PREEDIT_W = 132;
const CANDIDATE_W = (512 - PREEDIT_W) / 5;
const CANDIDATES_H = 32;
const CLOSE_X = 512 - 40;

/** A press above the keys: a candidate while composing; otherwise the close button. */
function stripTap(x: number, y: number, stripH: number) {
  if (composing()) {
    if (y >= stripH - CANDIDATES_H && x >= PREEDIT_W) pick(Math.floor((x - PREEDIT_W) / CANDIDATE_W), (text) => keySink().text(text));
    return;
  }
  if (x >= CLOSE_X && y < 30) keySink().close?.();
}

export function Keyboard(props: { mode: KeyboardMode }) {
  const current = () => layout(props.mode, layer());
  const sink = keySink;
  const latched = (k: Placed) => (!!k.modifier && mods()[k.modifier]) || (k.modifier === "shift" && capsLock());
  const fnKey = (k: Placed) => !k.char && k.key !== " ";
  const label = (k: Placed) => {
    if (k.ime) return chinese() ? "中" : "EN";
    if (k.modifier === "shift" && capsLock()) return "\u{21ea}";
    return (mods().shift || capsLock()) && k.shifted ? k.shifted : k.label;
  };
  const hint = () => (chord() ? `sent ${chord()}` : (sink().hint?.() ?? ""));
  return (
    <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: HEIGHT[props.mode], bgColor: color("darker_background") }}>
      <Show when={sink().field}>
        {(field) => (
          <>
            <Text class="absolute left-0 w-[512] text-center text-lg leading-[24]" style={{ insetT: current().stripH / 2 - 22, textColor: color("bright_foreground") }}>
              {field()()}
            </Text>
            <Text class="absolute left-0 w-[512] text-center font-mono text-xs leading-[14]" style={{ insetT: current().stripH / 2 + 10, textColor: color("dark_foreground") }}>
              {hint()}
            </Text>
          </>
        )}
      </Show>
      <Show when={!sink().field}>
        <Text class="absolute left-[12] top-[8] w-[440] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ textColor: color(chord() ? "accent" : "dark_foreground") }}>
          {hint()}
        </Text>
        <Show when={sink().close}>
          <Text class="absolute right-[14] top-[6] font-mono text-sm leading-[16]" style={{ textColor: color("red") }}>{"\u{f0156}"}</Text>
        </Show>
      </Show>
      <Show when={composing()}>
        <View class="absolute left-0 w-[512]" style={{ insetT: current().stripH - CANDIDATES_H, height: CANDIDATES_H, bgColor: color("dark_background") }}>
          <Text class="absolute left-[10] top-[7] h-[18] overflow-hidden font-mono text-sm leading-[18]" style={{ width: PREEDIT_W - 14, textColor: color("accent"), ...cjk(snapshot()?.preedit ?? "", CJK_SLOT_14) }}>
            {snapshot()?.preedit ?? ""}
          </Text>
          <For each={snapshot()?.candidates ?? []}>
            {(candidate, i) => (
              <Text
                class="absolute top-[7] h-[18] overflow-hidden text-center font-mono text-sm leading-[18]"
                style={{ insetL: PREEDIT_W + i() * CANDIDATE_W, width: CANDIDATE_W - 4, textColor: color(i() === 0 ? "bright_foreground" : "foreground"), ...cjk(candidate, CJK_SLOT_14) }}
              >
                {candidate}
              </Text>
            )}
          </For>
        </View>
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
              bgColor: color(k.lit() ? (k.char ? "background" : "accent") : latched(k) ? "selection" : fnKey(k) ? "dark_background" : "muted"),
            }}
          >
            <Text
              class="absolute left-0 text-center font-mono text-base leading-[18]"
              style={{
                width: k.w - GAP,
                insetT: (k.h - GAP) / 2 - 9,
                textColor: color(k.lit() && !k.char ? "background" : latched(k) || (k.ime && chinese()) ? "accent" : "bright_foreground"),
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
