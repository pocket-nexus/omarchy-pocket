// The deck while a terminal has the stage: session tabs along the top and a
// US keyboard filling the panel, for thumbs (keys about 34 x 64 points).
// Shift, Ctrl and Alt latch for the next key and show it. Characters go to
// the PTY as text; named keys and modified characters go as key names, which
// omarchy-pocketd encodes against the terminal's modes.
import { createSignal, For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { request } from "../bridge.ts";
import { color } from "../theme.ts";
import { active, hide, sessions, show } from "./store.ts";

interface Key {
  label: string;
  /** a character, or a key name for host/keys.ts */
  key: string;
  shifted?: string;
  width?: number;
  modifier?: "shift" | "ctrl" | "alt";
}

const c = (chars: string, shifted: string): Key[] => [...chars].map((ch, i) => ({ label: ch, key: ch, shifted: shifted[i] }));
const ROWS: Key[][] = [
  [{ label: "Esc", key: "Escape" }, ...c("1234567890-=", "!@#$%^&*()_+"), { label: "\u{f006e}", key: "Backspace", width: 2 }],
  [{ label: "Tab", key: "Tab", width: 1.5 }, ...c("qwertyuiop[]", "QWERTYUIOP{}"), { label: "\\", key: "\\", shifted: "|", width: 1.5 }],
  [{ label: "Ctrl", key: "", width: 1.75, modifier: "ctrl" }, ...c("asdfghjkl;'", 'ASDFGHJKL:"'), { label: "\u{f0311}", key: "Enter", width: 2.25 }],
  [{ label: "\u{f0636}", key: "", width: 2.25, modifier: "shift" }, ...c("zxcvbnm,./", "ZXCVBNM<>?"), { label: "\u{2191}", key: "Up" }, { label: "Del", key: "Delete", width: 1.75 }],
  [
    { label: "Alt", key: "", width: 1.5, modifier: "alt" },
    { label: "`", key: "`", shifted: "~" },
    { label: "", key: " ", width: 8 },
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

/** Sends one key to the active session, with the latched modifiers. */
export function sendKey(key: string, shifted?: string) {
  const sid = active();
  if (sid === null) return;
  const m = mods();
  setMods({ shift: false, ctrl: false, alt: false });
  if ([...key].length === 1 && !m.ctrl && !m.alt) {
    void request({ method: "termInput", sid, text: m.shift && shifted ? shifted : key });
  } else {
    void request({ method: "termKey", sid, key: m.shift && shifted ? shifted : key, ctrl: m.ctrl, alt: m.alt, shift: m.shift && !shifted });
  }
}

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
  else sendKey(key.key, key.shifted);
}

/** A tap on the tab strip: Menu, a session, or a new one. */
export function tabsTap(x: number) {
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
              style={{ width: k.w - 4, textColor: color(pressed() === k ? "background" : latched(k) ? "accent" : "foreground") }}
            >
              {k.shifted && mods().shift ? k.shifted : k.label}
            </Text>
          </View>
        )}
      </For>
      <Text class="absolute left-[10] font-mono text-xs leading-[14]" style={{ insetT: HINT_TOP + 3, textColor: color("dark_foreground") }}>
        {"A Enter  B Bksp  X Esc  Y Tab  L2 Ctrl  R2 Alt  Select next  Start back"}
      </Text>
    </View>
  );
}
