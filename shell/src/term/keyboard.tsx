// The deck's touch keyboard, laid out like a phone's in landscape: ten keys
// to a row, 46 points from row to row, sitting on the bottom edge, with a
// letters layer and two symbol layers (123, #+=). For a terminal or Notes a
// row of the keys a terminal needs rides above it (Esc, Tab, Ctrl, Alt and
// the arrows); a text field (a Wi-Fi password, the lock) has none. The space
// above the keys holds the strip: the sink's line and its close button, a
// text field's value, or, while a pinyin composition is open (the 中 key,
// ime.ts), its preedit and candidates along the keys' top edge.
//
// A key types when its finger lifts, where the finger is then: a finger that
// slides onto the next key types that one, as on a phone. While it is down a
// character key shows its preview above it, which springs up on the core's
// tracks and follows the finger; Backspace and the arrows repeat while held.
// Shift is one-shot, twice in a row locks capitals; Ctrl and Alt latch for
// the next key, and the chord they make shows on the preview and on the
// strip (Ctrl then L sends ^L, which clears a terminal and types nothing).
// Each finger is its own key press (touch.ts).
//
// Keys go to a sink: the focused window's (a terminal, Notes), or a text
// field that takes the keyboard over with setKeySink. For a terminal,
// characters go to the PTY as text; named keys and modified characters go as
// key names, which omarchy-pocketd encodes against the terminal's modes.
import { createSignal, For, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { animate, jump } from "@pocketjs/framework/animation";
import { after } from "@pocketjs/framework/clock";
import { request } from "../bridge.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { glide, slowed } from "../motion.ts";
import { color } from "../theme.ts";
import { chinese, composing, pick, route, snapshot, toggleChinese } from "./ime.ts";
import type { Contact, TouchFrame } from "../touch.ts";
import { BODY_H } from "../deck/geometry.ts";
import { active, closeTerminal } from "./store.ts";

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
const CHORD_S = 1.4;

/** Where the keys sit: the whole deck (the lock, a password field) or the
 *  deck's body under its strip. */
export type KeyboardMode = "full" | "body";
const HEIGHT: Record<KeyboardMode, number> = { full: 384, body: BODY_H };

interface Placed extends Key {
  x: number;
  y: number;
  w: number;
  h: number;
  /** a key that shows a preview */
  char: boolean;
}

const placeRow = (row: Key[], inset: number, y: number, h: number): Placed[] => {
  let x = inset * UNIT;
  return row.map((key) => {
    const w = (key.w ?? 1) * UNIT;
    const p = { ...key, x, y, w, h, char: [...key.key].length === 1 && key.key !== " " };
    x += w;
    return p;
  });
};

/** The keys of `layer` laid out for `mode`, the terminal's row above them when `extras`. */
function layoutFor(mode: KeyboardMode, layer: Layer, extras: boolean) {
  const height = HEIGHT[mode];
  const rowsTop = height - EDGE - LAYERS[layer].rows.length * PITCH;
  const extrasTop = rowsTop - EXTRA_PITCH;
  const keys = LAYERS[layer].rows.flatMap((row, r) => placeRow(row, LAYERS[layer].inset[r]!, rowsTop + r * PITCH, PITCH));
  if (extras) keys.push(...placeRow(EXTRAS.map((k) => ({ ...k, w: 10 / EXTRAS.length })), 0, extrasTop, EXTRA_PITCH));
  return { keys, stripH: (extras ? extrasTop : rowsTop) - 2 };
}
const LAYOUTS = new Map<string, ReturnType<typeof layoutFor>>();
const layout = (mode: KeyboardMode, layer: Layer, extras: boolean) => {
  const id = `${mode}:${layer}:${extras}`;
  let l = LAYOUTS.get(id);
  if (!l) LAYOUTS.set(id, (l = layoutFor(mode, layer, extras)));
  return l;
};

const [mods, setMods] = createSignal({ shift: false, ctrl: false, alt: false });
const [capsLock, setCapsLock] = createSignal(false);
const [layer, setLayer] = createSignal<Layer>("abc");
/** keys under a settled finger */
const [pressed, setPressed] = createSignal<Placed[]>([]);
/** the key the newest finger is on, for the preview */
const [preview, setPreview] = createSignal<Placed | null>(null);
/** the chord last sent, shown on the strip for CHORD_S */
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

/** Where keys go: a character (shift applied) or a key name with modifiers. */
export interface KeySink {
  text(ch: string): void;
  key(name: string, mods: { ctrl: boolean; alt: boolean; shift: boolean }): void;
  /** a text field's value, shown on the strip */
  field?: () => string;
  /** the strip's close button */
  close?(): void;
  /** the gamepad line on the strip */
  hint?: () => string;
}

const TERMINAL_HINT = "A Enter  B Bksp  X Tab  Y Space  START Esc  SELECT hides";

const terminalSink: KeySink = {
  text: (text) => {
    const sid = active();
    if (sid !== null) void request({ method: "termInput", sid, text });
  },
  key: (key, m) => {
    const sid = active();
    if (sid !== null) void request({ method: "termKey", sid, key, ctrl: m.ctrl, alt: m.alt, shift: m.shift });
  },
  close: () => {
    const sid = active();
    if (sid !== null) closeTerminal(sid);
  },
};
const [override, setOverride] = createSignal<KeySink | null>(null);
let windowSink: () => KeySink | null = () => null;
const sink = (): KeySink => override() ?? windowSink() ?? terminalSink;

/** Sends keys to `next` until called with null (back to the window's sink). */
export function setKeySink(next: KeySink | null) {
  setOverride(() => next);
  setMods({ shift: false, ctrl: false, alt: false });
  setLayer("abc");
}

/** The focused window's sink, when it is not a terminal (Notes). */
export function setWindowKeys(accessor: () => KeySink | null) {
  windowSink = accessor;
}

const chordName = (m: { ctrl: boolean; alt: boolean }, name: string) => `${m.ctrl ? "^" : ""}${m.alt ? "M-" : ""}${name.length === 1 ? name.toUpperCase() : name}`;

/** Sends one key, with the latched modifiers; through pinyin composition in
 *  中 mode, except into a password field. */
export function sendKey(key: string, shifted?: string) {
  const m = mods();
  const shift = m.shift || capsLock();
  setMods({ shift: false, ctrl: false, alt: false });
  const name = shift && shifted ? shifted : key;
  if (m.ctrl || m.alt) {
    setChord(chordName(m, name));
    after(CHORD_S, () => setChord(""));
  }
  const direct = () => {
    if ([...key].length === 1 && !m.ctrl && !m.alt) sink().text(name);
    else sink().key(name, { ctrl: m.ctrl, alt: m.alt, shift: shift && !shifted });
  };
  if (m.ctrl || m.alt || sink().field) return direct();
  route(name, (text) => sink().text(text), direct);
}

const keyAt = (keys: Placed[], x: number, y: number) => keys.find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) ?? null;

function press(key: Placed) {
  if (key.modifier) latch(key.modifier);
  else if (key.layer) setLayer(key.layer);
  else if (key.ime) toggleChinese();
  else sendKey(key.key, key.shifted);
}

/** frames each settled finger has been down, for the repeat keys */
const held = new Map<number, { frames: number; repeated: boolean }>();

/** The keyboard's fingers this frame, in its own coordinates: the keys under
 *  them light, the newest shows its preview, and a finger lifted over a key
 *  presses it. A finger that landed on the strip taps it. */
export function keyboardTouch(frame: TouchFrame, mode: KeyboardMode) {
  frameCount++;
  const { keys, stripH } = layout(mode, layer(), !sink().field);
  const onKeys = (c: Contact) => c.start.y >= stripH;
  const down = frame.down.filter(onKeys);
  setPressed(down.map((c) => keyAt(keys, c.x, c.y)).filter((k) => k !== null));
  const newest = down[down.length - 1];
  const under = newest ? keyAt(keys, newest.x, newest.y) : null;
  setPreview(under?.char ? under : null);
  for (const c of down) {
    const h = held.get(c.id) ?? { frames: 0, repeated: false };
    h.frames++;
    held.set(c.id, h);
    const key = keyAt(keys, c.x, c.y);
    if (key?.repeat && h.frames > REPEAT_AFTER && (h.frames - REPEAT_AFTER) % REPEAT_EVERY === 0) {
      h.repeated = true;
      press(key);
    }
  }
  for (const tap of frame.taps) {
    const h = held.get(tap.id);
    held.delete(tap.id);
    if (!onKeys(tap)) {
      stripTap(tap.start.x, tap.start.y, stripH);
      continue;
    }
    const key = keyAt(keys, tap.x, tap.y);
    if (key && !h?.repeated) press(key);
  }
}

/** The candidate boxes along the strip's bottom edge, after the preedit. */
const PREEDIT_W = 132;
const CANDIDATE_W = (512 - PREEDIT_W) / 5;
const CANDIDATES_H = 32;
const CLOSE_X = 512 - 40;

/** A tap on the strip: a candidate while composing; otherwise the close
 *  button. A text field's strip takes no taps. */
function stripTap(x: number, y: number, stripH: number) {
  if (composing()) {
    if (y >= stripH - CANDIDATES_H && x >= PREEDIT_W) pick(Math.floor((x - PREEDIT_W) / CANDIDATE_W), (text) => sink().text(text));
    return;
  }
  if (sink().field) return;
  if (x >= CLOSE_X && y < 30) sink().close?.();
}

/** The key preview: one balloon over the key the newest finger is on. */
function Preview() {
  let node: NodeMirror | undefined;
  let shown: Placed | null = null;
  const box = () => {
    const k = preview() ?? shown;
    if (!k) return { x: 0, y: 0, w: 0, h: 0 };
    const w = k.w + 12;
    const h = k.h + 40;
    return { x: Math.max(2, Math.min(510 - w, k.x - 6)), y: k.y + k.h - h, w, h };
  };
  const text = () => {
    const k = preview() ?? shown;
    if (!k) return "";
    const m = mods();
    const ch = (m.shift || capsLock()) && k.shifted ? k.shifted : k.label;
    return m.ctrl || m.alt ? chordName(m, ch) : ch;
  };
  /** the balloon is up: it springs up on a press and fades at the lift,
   *  keeping the last key's place while it fades */
  let up = false;
  const track = () => {
    const k = preview();
    if (k && !up && node) {
      jump(node, "scaleY", 0.6);
      jump(node, "opacity", 0.2);
      animate(node, "scaleY", 1, { dur: slowed(80), easing: "out" });
      animate(node, "opacity", 1, { dur: slowed(60), easing: "out" });
      up = true;
    } else if (!k && up) {
      glide(node, "opacity", 0, 90);
      up = false;
    }
    if (k) shown = k;
    return box();
  };
  return (
    <View
      class="absolute rounded-lg"
      ref={(n: NodeMirror) => (node = n)}
      style={{ insetL: track().x, insetT: box().y, width: box().w, height: box().h, originX: 0, originY: 0.5, opacity: 0, bgColor: color("lighter_background") }}
    >
      <Text class="absolute left-0 top-[6] text-center text-2xl leading-[30]" style={{ width: box().w, textColor: color("bright_foreground") }}>
        {text()}
      </Text>
    </View>
  );
}

export function Keyboard(props: { mode: KeyboardMode }) {
  const current = () => layout(props.mode, layer(), !sink().field);
  const latched = (k: Placed) => (!!k.modifier && mods()[k.modifier]) || (k.modifier === "shift" && capsLock());
  const fnKey = (k: Placed) => !k.char && k.key !== " ";
  const label = (k: Placed) => {
    if (k.ime) return chinese() ? "中" : "EN";
    if (k.modifier === "shift" && capsLock()) return "\u{21ea}";
    return (mods().shift || capsLock()) && k.shifted ? k.shifted : k.label;
  };
  return (
    <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: HEIGHT[props.mode], bgColor: color("darker_background") }}>
      <Show when={sink().field}>
        {(field) => (
          <>
            <Text class="absolute left-0 w-[512] text-center text-lg leading-[24]" style={{ insetT: current().stripH / 2 - 22, textColor: color("bright_foreground") }}>
              {field()()}
            </Text>
            <Text class="absolute left-0 w-[512] text-center font-mono text-xs leading-[14]" style={{ insetT: current().stripH / 2 + 10, textColor: color("dark_foreground") }}>
              {"A Enter   B Backspace   X Cancel"}
            </Text>
          </>
        )}
      </Show>
      <Show when={!sink().field}>
        <Text class="absolute left-[12] top-[8] w-[440] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ textColor: color(chord() ? "accent" : "dark_foreground") }}>
          {chord() ? `sent ${chord()}` : (sink().hint?.() ?? TERMINAL_HINT)}
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
              bgColor: color(pressed().includes(k) ? (k.char ? "background" : "accent") : latched(k) ? "selection" : fnKey(k) ? "dark_background" : "muted"),
            }}
          >
            <Text
              class="absolute left-0 text-center font-mono text-base leading-[18]"
              style={{
                width: k.w - GAP,
                insetT: (k.h - GAP) / 2 - 9,
                textColor: color(pressed().includes(k) && !k.char ? "background" : latched(k) || (k.ime && chinese()) ? "accent" : "bright_foreground"),
                ...(k.ime && chinese() ? cjk("中", CJK_SLOT_14) : {}),
              }}
            >
              {label(k)}
            </Text>
          </View>
        )}
      </For>
      <Preview />
    </View>
  );
}
