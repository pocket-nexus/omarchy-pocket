// The deck while a terminal has the stage: session tabs along the top and a
// US keyboard filling the panel, for thumbs (keys about 34 x 64 points).
// Shift, Ctrl and Alt latch for the next key and show it. Characters go to
// the PTY as text; named keys and modified characters go as key names, which
// omarchy-pocketd encodes against the terminal's modes. A text field (a
// Wi-Fi password) takes the keyboard over with setKeySink and shows its
// value in place of the tabs. The 中 key turns on pinyin (ime.ts): while a
// composition is open, the strip shows its preedit and candidates.
import { createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { request } from "../bridge.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { cjk } from "../glyphs.ts";
import { color } from "../theme.ts";
import { chinese, composing, pick, route, snapshot, toggleChinese } from "./ime.ts";
import { active, hide, sessions, show } from "./store.ts";

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
const KEYS_TOP = 30;
const KEY_H = 66;
const HINT_TOP = 364;

interface Placed extends Key {
  x: number;
  y: number;
  w: number;
}
const PLACED: Placed[] = ROWS.flatMap((row, r) => {
  let x = 0;
  return row.map((key) => {
    const w = (key.width ?? 1) * UNIT;
    const placed = { ...key, x, y: KEYS_TOP + r * KEY_H, w };
    x += w;
    return placed;
  });
});

const [mods, setMods] = createSignal({ shift: false, ctrl: false, alt: false });
const [pressed, setPressed] = createSignal<Placed | null>(null);

export const modifiers = mods;

export function latch(modifier: "shift" | "ctrl" | "alt") {
  setMods((m) => ({ ...m, [modifier]: !m[modifier] }));
}

/** Where keys go: a character (shift applied) or a key name with modifiers. */
export interface KeySink {
  text(ch: string): void;
  key(name: string, mods: { ctrl: boolean; alt: boolean; shift: boolean }): void;
  /** shown in place of the session tabs */
  field?: () => string;
}

const terminalSink: KeySink = {
  text: (text) => {
    const sid = active();
    if (sid !== null) void request({ method: "termInput", sid, text });
  },
  key: (key, m) => {
    const sid = active();
    if (sid !== null) void request({ method: "termKey", sid, key, ctrl: m.ctrl, alt: m.alt, shift: m.shift });
  },
};
const [sink, setSink] = createSignal<KeySink>(terminalSink);

/** Sends keys to `next` until called with null (back to the terminal). */
export function setKeySink(next: KeySink | null) {
  setSink(() => next ?? terminalSink);
  setMods({ shift: false, ctrl: false, alt: false });
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

const keyAt = (x: number, y: number) => PLACED.find((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + KEY_H) ?? null;

/** The finger on the deck (null once lifted); a lift over a key presses it. */
export function keyboardTouch(contact: { x: number; y: number } | null) {
  if (contact) {
    setPressed(keyAt(contact.x, contact.y));
    return;
  }
  const key = pressed();
  setPressed(null);
  if (!key) return;
  if (key.modifier) latch(key.modifier);
  else if (key.ime) toggleChinese();
  else sendKey(key.key, key.shifted);
}

/** A tap on the tab strip: a candidate while composing; otherwise Menu, a
 *  session, or a new one. */
export function tabsTap(x: number) {
  if (composing()) {
    if (x >= PREEDIT_W) pick(Math.floor((x - PREEDIT_W) / CANDIDATE_W), (text) => sink().text(text));
    return;
  }
  if (x < 56) return hide();
  if (x >= 512 - 30) {
    void request<number>({ method: "termOpen" }).then(show, () => {});
    return;
  }
  const index = Math.floor((x - 56) / 108);
  const target = sessions()[index];
  if (target) show(target.sid);
}

export const TABS_HEIGHT = TABS_H;

export function Keyboard() {
  const latched = (k: Placed) => !!k.modifier && mods()[k.modifier];
  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ bgColor: color("darker_background") }}>
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
        <Text class="absolute left-[8] top-[5] font-mono text-sm leading-[16]" style={{ textColor: color("accent") }}>{"\u{f035c} Menu"}</Text>
        <For each={sessions()}>
          {(s, i) => (
            <View class="absolute top-[3] h-[20] w-[104] overflow-hidden rounded-sm" style={{ insetL: 56 + i() * 108, bgColor: color(s.sid === active() ? "selection" : "dark_background") }}>
              <Text class="absolute left-[6] top-[2] font-mono text-xs leading-[16]" style={{ textColor: color(s.sid === active() ? "bright_foreground" : "foreground") }}>
                {s.title()}
              </Text>
            </View>
          )}
        </For>
        <Text class="absolute right-[10] top-[5] font-mono text-sm leading-[16]" style={{ textColor: color("accent") }}>+</Text>
      </View>
      </Show>
      <For each={PLACED}>
        {(k) => (
          <View
            class="absolute rounded-md"
            style={{
              insetL: k.x + 2,
              insetT: k.y + 2,
              width: k.w - 4,
              height: KEY_H - 4,
              bgColor: color(pressed() === k ? "accent" : latched(k) ? "selection" : k.modifier || k.key.length > 1 ? "dark_background" : "background"),
            }}
          >
            <Text
              class="absolute left-0 top-[24] text-center font-mono text-sm leading-[16]"
              style={{
                width: k.w - 4,
                textColor: color(pressed() === k ? "background" : latched(k) || (k.ime && chinese()) ? "accent" : "foreground"),
                ...(k.ime && chinese() ? cjk("中", CJK_SLOT_14) : {}),
              }}
            >
              {k.ime ? (chinese() ? "中" : "EN") : k.shifted && mods().shift ? k.shifted : k.label}
            </Text>
          </View>
        )}
      </For>
      <Text class="absolute left-[10] font-mono text-xs leading-[14]" style={{ insetT: HINT_TOP + 3, textColor: color("dark_foreground") }}>
        {sink().field ? "A Enter   B Backspace   X clear" : "A Enter  B Bksp  X Esc  Y Tab  L2 Ctrl  R2 Alt  Select next  Start back"}
      </Text>
    </View>
  );
}
