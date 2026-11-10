// The deck's function row, along the hinge as on a laptop. Omarchy's logo
// (opens the menu, as L1 + A does) and Esc hold its left end in both layouts.
//
// In the keys layout the keys what has focus wants at one press follow them.
// A terminal gets Tab and its control keys; a touch app gets Back, which it
// hears as the Cross button; the menu, Pin for the app it has selected; other
// windows, Tab.
//
// In the pad layout (while the dock shows, deck/dock.tsx) the row is also
// Omarchy's bar: workspaces 1–5 and the layout badge after Esc (a press on a
// workspace switches to it; the badge, tile or scroll, toggles dwindle and
// scrolling), and the bar's panels at the right end (a press opens the
// panel's card on the stage, or closes it). A touch app keeps Back there as
// an arrow after Esc. The two sets cross-fade as the keys unfold or fold away.
//
// At the right end in both: play/pause while Spotify's Soloist plays or holds
// a track on this device (SystemState.media), and × while a text field has
// the keys. While a pinyin composition is open (the 中 key, term/ime.ts) the
// row holds its preedit and candidates.
import { createEffect, createMemo, createRoot, For, on, Show, untrack } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { perform, toggleMenu } from "../actions.ts";
import { request } from "../bridge.ts";
import { CJK_SLOT_14 } from "../../../daemon/protocol.ts";
import { keySink } from "../focus.ts";
import { cjk } from "../glyphs.ts";
import { audioGlyph, batteryGlyph, bluetoothGlyph, networkGlyph } from "../indicators.ts";
import { fieldSink } from "../keys.ts";
import { inkShift } from "../ink.ts";
import { glide } from "../motion.ts";
import { appletTyping, pressBack } from "../packages.ts";
import { card } from "../stage/card.tsx";
import { allApps, menuOpen, selectedItem } from "../stage/menu.tsx";
import { closePanel, openPanel, showPanel, type PanelName } from "../stage/panels.tsx";
import { composing, pick, snapshot } from "../term/ime.ts";
import { state } from "../system.ts";
import { sendCtrl, sendKey } from "../term/keyboard.tsx";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { current, focus, focused, layout, occupied, WORKSPACES } from "../workspaces.ts";
import { dockShown } from "./dock.tsx";
import { STRIP_H } from "./geometry.ts";
import { PIN, pinIds, pinnable, togglePin, UNPIN } from "./pins.ts";
import { pressed } from "./press.ts";
import { DECK_SCALE, DECK_W } from "../screen.ts";

const LOGO = "\u{e900}";
const CLOSE = "\u{f0156}";
const LEFT = "\u{f0141}";
const PLAY = "\u{f040a}";
const PAUSE = "\u{f03e4}";

const EDGE = 4;
const GAP = 4;
const CHIP_H = 28;
const CHIP_Y = 3;
const LOGO_W = 36;
const ESC_W = 44;
const END_W = 40;
const MAX_W = 84;
/** the pad layout's tabs: Back as an arrow, the badge wide enough for "scroll" */
const BACK_W = 30;
const BADGE_W = 46;
const TAB_GAP = 3;
/** between the row's groups: Esc, the workspaces, the panels */
const GROUP_GAP = 8;
/** the preedit's width, then five candidates (132 on the RG DS Plus's 512 points) */
const PREEDIT_W = Math.round(132 * DECK_SCALE);
const CANDIDATE_W = (DECK_W - PREEDIT_W) / 5;

interface Chip {
  id: string;
  label: string;
  /** a Nerd Font glyph before the label, or the whole label */
  glyph?: string;
  run: () => void;
  lit?: () => boolean;
  danger?: boolean;
  /** a tab of the pad layout: a digit, an indicator glyph, or the badge's word */
  tab?: "digit" | "icon" | "badge";
  /** a tab's label as it changes (an indicator, the badge) */
  text?: () => string;
  /** a tab's colour */
  tone?: () => string;
}
interface Placed extends Chip {
  x: number;
  w: number;
}

const ctrl = (ch: string): Chip => ({ id: `ctrl-${ch}`, label: `^${ch.toUpperCase()}`, run: () => sendCtrl(ch) });
const TAB: Chip = { id: "tab", label: "Tab", run: () => sendKey("Tab") };

/** The menu's Pin key, while it has an app selected. */
function pinChip(): Chip[] {
  const item = menuOpen() ? selectedItem() : undefined;
  if (!pinnable(item)) return [];
  const on = pinIds(allApps()).includes(item.id);
  return [{ id: "pin", label: on ? "Unpin" : "Pin", glyph: on ? UNPIN : PIN, run: () => togglePin(item, allApps()) }];
}

/** A touch app with no field open takes Back, which it hears as the Cross button. */
const backs = () => {
  const w = focused();
  return w?.kind === "app" && !appletTyping(w.app);
};

/** The keys layout's middle of the row, for what has focus. */
function context(): Chip[] {
  if (fieldSink()) return [];
  if (card()) return [...pinChip(), TAB];
  const w = focused();
  if (!w) return [];
  if (w.kind === "terminal") return [TAB, ctrl("c"), ctrl("d"), ctrl("l"), ctrl("r")];
  if (backs()) return [{ id: "back", label: "Back", glyph: LEFT, run: pressBack }];
  return [TAB];
}

// ---- the pad layout's tabs -------------------------------------------------

const PANEL_LIST: PanelName[] = ["tailscale", "proxy", "bluetooth", "network", "audio", "power"];
/** the panels this device has: the proxy and Tailscale while they are installed */
const panels = createRoot(() => createMemo(() => PANEL_LIST.filter((p) => (p !== "proxy" || !!state()?.proxy) && (p !== "tailscale" || !!state()?.tailscale)), undefined, { equals: (a, b) => a.join() === b.join() }));
const panelGlyph = (p: PanelName) => {
  const s = state();
  return p === "tailscale" ? "\u{f0318}" : p === "proxy" ? "\u{f0582}" : p === "power" ? batteryGlyph(s?.battery ?? null) : p === "audio" ? audioGlyph(s?.audio ?? null) : p === "network" ? networkGlyph(s?.network) : bluetoothGlyph(s?.bluetooth ?? null);
};
const panelDim = (p: PanelName) => (p === "proxy" && state()?.proxy?.running === false) || (p === "tailscale" && state()?.tailscale?.state !== "Running");

const workspaceTab = (i: number): Chip => ({
  id: `ws${i}`,
  label: String(i + 1),
  tab: "digit",
  run: () => focus(i),
  lit: () => current() === i,
  tone: () => (current() === i ? "accent" : occupied(i) ? "foreground" : "muted"),
});
const BADGE: Chip = {
  id: "layout",
  label: "",
  tab: "badge",
  text: () => (layout() === "dwindle" ? "tile" : "scroll"),
  tone: () => "dark_foreground",
  run: () => perform("layout"),
};
const panelTab = (p: PanelName): Chip => ({
  id: `panel-${p}`,
  label: "",
  tab: "icon",
  text: () => panelGlyph(p),
  run: () => (openPanel() === p ? closePanel() : showPanel(p)),
  lit: () => openPanel() === p,
  tone: () => (openPanel() === p ? "accent" : panelDim(p) ? "muted" : "foreground"),
});
const BACK_TAB: Chip = { id: "pad-back", label: "", glyph: LEFT, run: pressBack };

// ---- placing the row -------------------------------------------------------

const closes = () => keySink().close;
/** the play/pause key: whether what is on this device plays, or null with nothing on it.
 *  Its own memo, so the row is not placed again at every state the daemon sends */
const playing = createRoot(() => createMemo(() => {
  const media = state()?.media;
  return media ? media.playing : null;
}));

/** Logo and Esc at the left, play/pause and × at the right, and the room between. */
const ends = createRoot(() =>
  createMemo(() => {
    const close = closes();
    const media = playing();
    const end: Chip[] = [
      // what plays here: pause it, or play it again
      ...(media === null ? [] : [{ id: "media", label: "", glyph: media ? PAUSE : PLAY, run: () => void request({ method: "mediaToggle" }).catch(() => {}), lit: () => playing() === true }]),
      ...(close ? [{ id: "close", label: "", glyph: CLOSE, run: () => keySink().close?.(), danger: true }] : []),
    ];
    const start: Placed[] = [
      { id: "menu", label: "", glyph: LOGO, run: toggleMenu, lit: menuOpen, x: EDGE, w: LOGO_W },
      { id: "esc", label: "Esc", run: () => sendKey("Escape"), x: EDGE + LOGO_W + GAP, w: ESC_W },
    ];
    const endX = DECK_W - EDGE - end.length * END_W - (end.length - 1) * GAP;
    return {
      chips: [...start, ...end.map((c, i): Placed => ({ ...c, x: endX + i * (END_W + GAP), w: END_W }))],
      left: EDGE + LOGO_W + GAP + ESC_W + GAP,
      right: end.length ? endX - GAP : DECK_W - EDGE,
    };
  }),
);

/** The keys layout's middle: what has focus wants, as wide as the room allows. */
const keysRow = createRoot(() =>
  createMemo((): Placed[] => {
    const { left, right } = ends();
    const middle = context();
    const room = right - left - (middle.length - 1) * GAP;
    const w = middle.length ? Math.min(MAX_W, Math.floor(room / middle.length)) : 0;
    return middle.map((c, i) => ({ ...c, x: left + i * (w + GAP), w }));
  }),
);

/** The pad layout's middle: Back for a touch app, the workspaces and the
 *  badge, and the panels flush with the right end; the tabs share the room. */
const padRow = createRoot(() =>
  createMemo((): Placed[] => {
    const { left, right } = ends();
    const out: Placed[] = [];
    let x = left;
    if (backs()) {
      out.push({ ...BACK_TAB, x, w: BACK_W });
      x += BACK_W + GAP;
    }
    x += GROUP_GAP - GAP;
    const list = panels();
    const n = list.length;
    const w = (right - x - BADGE_W - (4 + n) * TAB_GAP - GROUP_GAP) / (WORKSPACES + n);
    for (let i = 0; i < WORKSPACES; i++) out.push({ ...workspaceTab(i), x: x + i * (w + TAB_GAP), w });
    out.push({ ...BADGE, x: x + WORKSPACES * (w + TAB_GAP), w: BADGE_W });
    const panelsX = right - n * w - (n - 1) * TAB_GAP;
    list.forEach((p, i) => out.push({ ...panelTab(p), x: panelsX + i * (w + TAB_GAP), w }));
    return out;
  }),
);

/** The chips a finger can press now. */
const live = () => [...ends().chips, ...(dockShown() ? padRow() : keysRow())];
const chipAt = (x: number) => live().find((c) => x >= c.x - GAP / 2 && x < c.x + c.w + GAP / 2);

/** The row's target under `x`, for the pressed look. */
export function stripTarget(x: number): string | null {
  if (composing()) return null;
  const chip = chipAt(x);
  return chip ? `strip:${chip.id}` : null;
}

/** The row's fingers this frame: a press acts on the chip or the candidate under it. */
export function stripTouch(frame: TouchFrame) {
  for (const c of frame.presses) {
    if (composing()) {
      if (c.x >= PREEDIT_W) pick(Math.floor((c.x - PREEDIT_W) / CANDIDATE_W), (text) => keySink().text(text));
      continue;
    }
    chipAt(c.x)?.run();
  }
}

// ---- drawing ---------------------------------------------------------------

/** A key of the row: a label, a glyph, or a glyph and a label. */
function Key(props: { chip: Placed }) {
  const chip = props.chip;
  const lit = () => chip.lit?.() === true;
  return (
    <View class="absolute rounded-md" style={{ insetL: chip.x, insetT: CHIP_Y, width: chip.w, height: CHIP_H, bgColor: color(lit() || pressed(`strip:${chip.id}`) ? "selection" : "dark_background") }}>
      <Show when={chip.glyph && chip.label}>
        <Text class="absolute top-[6] w-[16] text-center font-mono text-xs leading-[16]" style={{ insetL: 6 - inkShift(chip.glyph!, 12), textColor: color("foreground") }}>
          {chip.glyph}
        </Text>
      </Show>
      <Text
        class={chip.id === "menu" ? "absolute left-0 top-[8] h-[16] overflow-hidden text-center font-mono text-sm leading-[16]" : "absolute left-0 top-[6] h-[16] overflow-hidden text-center font-mono text-xs leading-[16]"}
        style={{ width: chip.w, insetL: chip.glyph && chip.label ? 11 : chip.label ? 0 : -inkShift(chip.glyph ?? "", chip.id === "menu" ? 14 : 12), textColor: color(chip.danger ? "red" : lit() ? "accent" : "foreground") }}
      >
        {chip.label || chip.glyph}
      </Text>
    </View>
  );
}

/** A tab of the pad layout: a workspace's digit, an indicator, or the badge. */
function Tab(props: { chip: Placed }) {
  const chip = props.chip;
  const label = () => chip.text?.() ?? chip.label;
  const tone = () => chip.tone?.() ?? "foreground";
  const bg = () => (chip.lit?.() || pressed(`strip:${chip.id}`) ? "selection" : chip.tab === "badge" ? "background" : "dark_background");
  return (
    <View class="absolute rounded-md" style={{ insetL: chip.x, insetT: CHIP_Y, width: chip.w, height: CHIP_H, bgColor: color(bg()) }}>
      <Show
        when={chip.tab === "icon"}
        fallback={
          <Text class={chip.tab === "badge" ? "absolute left-0 top-[7] h-[14] text-center font-mono text-xs leading-[14]" : "absolute left-0 top-[6] h-[16] text-center font-mono text-sm leading-[16]"} style={{ width: chip.w, textColor: color(tone()) }}>
            {label()}
          </Text>
        }
      >
        <Text class="absolute left-0 top-[5] h-[18] text-center font-mono text-base leading-[18]" style={{ width: chip.w, insetL: -inkShift(label(), 16), textColor: color(tone()) }}>
          {label()}
        </Text>
      </Show>
    </View>
  );
}

const Chips = (props: { each: () => Placed[] }) => <For each={props.each()}>{(chip) => (chip.tab ? <Tab chip={chip} /> : <Key chip={chip} />)}</For>;

/** how far a set travels as it fades */
const SLIDE = 6;

export function Strip() {
  let keysSet: NodeMirror | undefined;
  let padSet: NodeMirror | undefined;
  // the keys layout's keys and the pad layout's tabs cross-fade
  createEffect(
    on(dockShown, (pad) => {
      glide(keysSet, "opacity", pad ? 0 : 1, 140);
      glide(keysSet, "translateY", pad ? SLIDE : 0, 180);
      glide(padSet, "opacity", pad ? 1 : 0, 140);
      glide(padSet, "translateY", pad ? 0 : -SLIDE, 180);
    }, { defer: true }),
  );
  return (
    <View class="absolute left-0 top-0 contain-strict" style={{ width: DECK_W, height: STRIP_H }}>
      <Show
        when={composing()}
        fallback={
          <>
            <Chips each={() => ends().chips} />
            {/* the layout as the row mounts (again after a composition); glides after */}
            <View class="absolute left-0 top-0" style={{ width: DECK_W, height: STRIP_H, opacity: untrack(dockShown) ? 0 : 1, translateY: untrack(dockShown) ? SLIDE : 0 }} ref={(n: NodeMirror) => (keysSet = n)}>
              <Chips each={keysRow} />
            </View>
            <View class="absolute left-0 top-0" style={{ width: DECK_W, height: STRIP_H, opacity: untrack(dockShown) ? 1 : 0, translateY: untrack(dockShown) ? 0 : -SLIDE }} ref={(n: NodeMirror) => (padSet = n)}>
              <Chips each={padRow} />
            </View>
          </>
        }
      >
        <View class="absolute left-0 top-0" style={{ width: DECK_W, height: STRIP_H, bgColor: color("dark_background") }}>
          <Text class="absolute left-[10] top-[8] h-[18] overflow-hidden font-mono text-sm leading-[18]" style={{ width: PREEDIT_W - 14, textColor: color("accent"), ...cjk(snapshot()?.preedit ?? "", CJK_SLOT_14) }}>
            {snapshot()?.preedit ?? ""}
          </Text>
          <For each={snapshot()?.candidates ?? []}>
            {(candidate, i) => (
              <Text
                class="absolute top-[8] h-[18] overflow-hidden text-center font-mono text-sm leading-[18]"
                style={{ insetL: PREEDIT_W + i() * CANDIDATE_W, width: CANDIDATE_W - 4, textColor: color(i() === 0 ? "bright_foreground" : "foreground"), ...cjk(candidate, CJK_SLOT_14) }}
              >
                {candidate}
              </Text>
            )}
          </For>
        </View>
      </Show>
    </View>
  );
}
