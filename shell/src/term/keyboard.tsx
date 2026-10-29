// The deck's touch keyboard: a strip along the top and a US keyboard under
// it, for thumbs. It fills the deck's body under the deck strip while a
// terminal or Notes has focus, and the whole deck for the lock and a password
// field. Shift, Ctrl and Alt latch for the next key and show it. Keys go to a
// sink: the focused window's (a terminal, Notes), or a text field that takes
// the keyboard over with setKeySink (a Wi-Fi password, the lock). For a
// terminal, characters go to the PTY as text; named keys and modified
// characters go as key names, which omarchy-pocketd encodes against the
// terminal's modes. The strip shows the sink's gamepad line and its close
// button, a text field's value, or, while a pinyin composition is open (the
// 中 key, ime.ts), its preedit and candidates. Each finger is its own key
// press (touch.ts).
import { createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { request } from "../bridge.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { color } from "../theme.ts";
import { chinese, composing, pick, route, snapshot, toggleChinese } from "./ime.ts";
import type { TouchFrame } from "../touch.ts";
import { BODY_H } from "../deck/geometry.ts";
import { active, closeTerminal } from "./store.ts";

interface Key {
  label: string;
  /** a character, or a key name for host/keys.ts */
  key: string;
  shifted?: string;
  width?: number;
  modifier?: "shift" | "ctrl" | "alt";
  /** the 中/EN switch */
  ime?: boolean;
}

const c = (chars: string, shifted: string): Key[] => [...chars].map((ch, i) => ({ label: ch, key: ch, shifted: shifted[i] }));
const ROWS: Key[][] = [
  [{ label: "Esc", key: "Escape" }, ...c("1234567890-=", "!@#$%^&*()_+"), { label: "\u{f006e}", key: "Backspace", width: 2 }],
  [{ label: "Tab", key: "Tab", width: 1.5 }, ...c("qwertyuiop[]", "QWERTYUIOP{}"), { label: "\\", key: "\\", shifted: "|", width: 1.5 }],
  [{ label: "Ctrl", key: "", width: 1.75, modifier: "ctrl" }, ...c("asdfghjkl;'", 'ASDFGHJKL:"'), { label: "\u{f0311}", key: "Enter", width: 2.25 }],
  [{ label: "\u{f0636}", key: "", width: 2.25, modifier: "shift" }, ...c("zxcvbnm,./", "ZXCVBNM<>?"), { label: "\u{2191}", key: "Up" }, { label: "Del", key: "Delete", width: 1.75 }],
  [
    { label: "Alt", key: "", width: 1.5, modifier: "alt" },
    { label: "EN", key: "", ime: true },
    { label: "`", key: "`", shifted: "~" },
    { label: "", key: " ", width: 7 },
    { label: "\u{2190}", key: "Left" },
    { label: "\u{2193}", key: "Down" },
    { label: "\u{2192}", key: "Right" },
    { label: "PgUp", key: "PageUp", width: 1.5 },
  ],
];
const UNITS = 15;
const UNIT = 512 / UNITS;
const TABS_H = 26;
const KEYS_TOP = 28;

interface Placed extends Key {
  x: number;
  y: number;
  w: number;
}

/** Where the keys sit: the whole deck (the lock, a password field), with the
 *  gamepad line under the keys, or the deck's body under its strip. */
export type KeyboardMode = "full" | "body";
const HEIGHT: Record<KeyboardMode, number> = { full: 384, body: BODY_H };
const HINT_H: Record<KeyboardMode, number> = { full: 20, body: 0 };
const keyH = (mode: KeyboardMode) => (HEIGHT[mode] - KEYS_TOP - HINT_H[mode]) / ROWS.length;

function placed(mode: KeyboardMode): Placed[] {
  return ROWS.flatMap((row, r) => {
    let x = 0;
    return row.map((key) => {
      const w = (key.width ?? 1) * UNIT;
      const p = { ...key, x, y: KEYS_TOP + r * keyH(mode), w };
      x += w;
      return p;
    });
  });
}
const PLACED: Record<KeyboardMode, Placed[]> = { full: placed("full"), body: placed("body") };

const [mods, setMods] = createSignal({ shift: false, ctrl: false, alt: false });
/** keys under a settled finger */
const [pressed, setPressed] = createSignal<Placed[]>([]);

export const modifiers = mods;

export function latch(modifier: "shift" | "ctrl" | "alt") {
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
  /** the gamepad line under the keys */
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
}

/** The focused window's sink, when it is not a terminal (Notes). */
export function setWindowKeys(accessor: () => KeySink | null) {
  windowSink = accessor;
}



/** Sends one key, with the latched modifiers; through pinyin composition in
 *  中 mode, except into a password field. */
export function sendKey(key: string, shifted?: string) {
  const m = mods();
  setMods({ shift: false, ctrl: false, alt: false });
  const name = m.shift && shifted ? shifted : key;
  const direct = () => {
    if ([...key].length === 1 && !m.ctrl && !m.alt) sink().text(name);
    else sink().key(name, { ctrl: m.ctrl, alt: m.alt, shift: m.shift && !shifted });
  };
  if (m.ctrl || m.alt || sink().field) return direct();
  route(name, (text) => sink().text(text), direct);
}

/** The composition strip's candidate boxes, after the preedit. */
const PREEDIT_W = 132;
const CANDIDATE_W = (512 - PREEDIT_W) / 5;

const keyAt = (mode: KeyboardMode, x: number, y: number) => PLACED[mode].find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + keyH(mode)) ?? null;

function press(key: Placed) {
  if (key.modifier) latch(key.modifier);
  else if (key.ime) toggleChinese();
  else sendKey(key.key, key.shifted);
}

/** The keyboard's fingers this frame, in its own coordinates: the keys under
 *  them light, and a finger lifted over a key presses it. A finger that landed
 *  on the strip taps it. */
export function keyboardTouch(frame: TouchFrame, mode: KeyboardMode) {
  setPressed(frame.down.filter((p) => p.start.y >= TABS_H).map((p) => keyAt(mode, p.x, p.y)).filter((k) => k !== null));
  for (const tap of frame.taps) {
    if (tap.start.y < TABS_H) stripTap(tap.start.x);
    else {
      const key = keyAt(mode, tap.x, tap.y);
      if (key) press(key);
    }
  }
}

const CLOSE_X = 512 - 34;

/** A tap on the strip: a candidate while composing; otherwise Menu, or the
 *  close button. A text field's strip takes no taps. */
function stripTap(x: number) {
  if (composing()) {
    if (x >= PREEDIT_W) pick(Math.floor((x - PREEDIT_W) / CANDIDATE_W), (text) => sink().text(text));
    return;
  }
  if (sink().field) return;
  if (x >= CLOSE_X) sink().close?.();
}


export function Keyboard(props: { mode: KeyboardMode }) {
  const latched = (k: Placed) => !!k.modifier && mods()[k.modifier];
  const h = keyH(props.mode);
  return (
    <View class="absolute left-0 top-0 w-[512]" style={{ height: HEIGHT[props.mode], bgColor: color("darker_background") }}>
      <Show when={sink().field}>
        {(field) => (
          <View class="absolute left-0 top-0 w-[512]" style={{ height: TABS_H, bgColor: color("dark_background") }}>
            <Text class="absolute left-[10] top-[5] font-mono text-sm leading-[16]" style={{ textColor: color("bright_foreground") }}>{field()()}</Text>
          </View>
        )}
      </Show>
      <Show when={composing()}>
        <View class="absolute left-0 top-0 w-[512]" style={{ height: TABS_H, bgColor: color("dark_background") }}>
          <Text class="absolute left-[8] top-[4] h-[18] overflow-hidden font-mono text-sm leading-[18]" style={{ width: PREEDIT_W - 12, textColor: color("accent"), ...cjk(snapshot()?.preedit ?? "", CJK_SLOT_14) }}>
            {snapshot()?.preedit ?? ""}
          </Text>
          <For each={snapshot()?.candidates ?? []}>
            {(candidate, i) => (
              <Text
                class="absolute top-[4] h-[18] overflow-hidden font-mono text-sm leading-[18]"
                style={{ insetL: PREEDIT_W + i() * CANDIDATE_W, width: CANDIDATE_W - 4, textColor: color(i() === 0 ? "bright_foreground" : "foreground"), ...cjk(`${i() + 1}${candidate}`, CJK_SLOT_14) }}
              >
                {`${i() + 1}${candidate}`}
              </Text>
            )}
          </For>
        </View>
      </Show>
      <Show when={!sink().field && !composing()}>
        <View class="absolute left-0 top-0 w-[512]" style={{ height: TABS_H, bgColor: color("dark_background") }}>
          <Text class="absolute left-[10] top-[6] w-[440] h-[14] overflow-hidden font-mono text-xs leading-[14]" style={{ textColor: color("dark_foreground") }}>
            {sink().hint?.() ?? TERMINAL_HINT}
          </Text>
          <Show when={sink().close}>
            <Text class="absolute right-[10] top-[5] font-mono text-sm leading-[16]" style={{ textColor: color("red") }}>{"\u{f0156}"}</Text>
          </Show>
        </View>
      </Show>
      <For each={PLACED[props.mode]}>
        {(k) => (
          <View
            class="absolute rounded-md"
            style={{
              insetL: k.x + 2,
              insetT: k.y + 2,
              width: k.w - 4,
              height: h - 4,
              bgColor: color(pressed().includes(k) ? "accent" : latched(k) ? "selection" : k.modifier || k.key.length > 1 ? "dark_background" : "background"),
            }}
          >
            <Text
              class="absolute left-0 text-center font-mono text-sm leading-[16]"
              style={{
                width: k.w - 4,
                insetT: (h - 4) / 2 - 8,
                textColor: color(pressed().includes(k) ? "background" : latched(k) || (k.ime && chinese()) ? "accent" : "foreground"),
                ...(k.ime && chinese() ? cjk("中", CJK_SLOT_14) : {}),
              }}
            >
              {k.ime ? (chinese() ? "中" : "EN") : k.shifted && mods().shift ? k.shifted : k.label}
            </Text>
          </View>
        )}
      </For>
      <Show when={HINT_H[props.mode] > 0}>
        <Text class="absolute left-[10] font-mono text-xs leading-[14]" style={{ insetT: 384 - 17, textColor: color("dark_foreground") }}>
          {sink().field ? "A Enter   B Backspace   X Cancel" : (sink().hint?.() ?? TERMINAL_HINT)}
        </Text>
      </Show>
    </View>
  );
}
