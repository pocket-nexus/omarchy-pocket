// Omarchy Pocket's shell: Omarchy's desktop on the RG DS Plus's two
// 512x384-point panels. The top panel is the stage: the theme's wallpaper,
// the current workspace's windows tiled the way Omarchy tiles Hyprland
// (wm.ts), Omarchy's bar, the OSD and notices. The bottom panel is the deck,
// a touch surface in three bands: the strip (workspaces, the focused window's
// title, the L1/R1 pills, Go), the body (the focused window's touch controls,
// the Omarchy menu on an empty workspace or when opened, or the chord map
// while a layer is in force) and the dock. The gamepad is the window
// manager's keyboard: chords.ts maps every button under each shoulder layer,
// and the buttons with no shoulder go to the focused window. The lock screen
// covers both panels and takes input first; the screensaver covers
// everything.
// The bottom panel has one AuxiliarySurface: each portal is a flex child of
// the panel's root, so two would share its width. The portal inserts its
// child once (framework renderPortalChild calls the accessor), so the deck's
// Show chain sits inside a View.
import { createEffect, createSignal, on, Show } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { perform } from "./actions.ts";
import { appletOf, focusedApplet, type Applet } from "./applets/applet.ts";
import "./applets/keys.tsx";
import { request, type SystemState } from "./bridge.ts";
import { chordFor, layerOf, MODIFIERS } from "./chords.ts";
import { ChordMap, chordMapTouch } from "./deck/chord-map.tsx";
import { setDeckOpen } from "./deck/deck-state.ts";
import { Dock, dockTap, dockTouch } from "./deck/dock.tsx";
import { BODY_H, BODY_TOP, DOCK_TOP, STRIP_H } from "./deck/geometry.ts";
import { layer, releasePills, setHeld } from "./deck/layer.ts";
import { BACK, OPEN } from "./deck/menu-deck.tsx";
import { OmarchyDeck, omarchyDeckPress, omarchyDeckShown, omarchyDeckTap, toggleOmarchyDeck } from "./deck/omarchy-deck.tsx";
import { openPanel, passwordEntry } from "./deck/panels.tsx";
import { Picker, pickerOpen, pickerPress, pickerTap } from "./deck/picker.tsx";
import { Strip, stripTap } from "./deck/strip.tsx";
import { remoteButtons } from "./remote-input.ts";
import { Bar } from "./stage/bar.tsx";
import { lock, locked, LockStage } from "./stage/lock.tsx";
import { Osd } from "./stage/osd.tsx";
import { Screensaver, screensaverActive, ScreensaverDeck, startScreensaver, stopScreensaver } from "./stage/screensaver.tsx";
import { Toasts } from "./stage/toasts.tsx";
import { Wallpaper } from "./stage/wallpaper.tsx";
import { Windows } from "./stage/windows.tsx";
import { state } from "./system.ts";
import { composing } from "./term/ime.ts";
import { Keyboard, keyboardTouch, sendKey, setWindowKeys } from "./term/keyboard.tsx";
import { band, trackTouches } from "./touch.ts";
import "./windows.ts";
import { current, focused, visibleWindows } from "./workspaces.ts";

const REPEATS = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;
const REPEAT_AFTER = 18;
const REPEAT_EVERY = 4;
const KEYS = [
  BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, OPEN, BACK, BTN.TRIANGLE, BTN.SQUARE,
  BTN.START, BTN.SELECT, BTN.ZL, BTN.ZR,
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const two = (n: number) => (n < 10 ? `0${n}` : String(n));

/** The gamepad in a terminal with no shoulder held: the D-pad is the arrow
 *  keys, the face buttons the keys a shell and a TUI need most. */
const TERM_KEYS: [number, string][] = [
  [BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"],
  [OPEN, "Enter"], [BACK, "Backspace"], [BTN.TRIANGLE, "Escape"], [BTN.SQUARE, "Tab"],
];

export default function Shell() {
  const [now, setNow] = createSignal(new Date());
  const tick = () => {
    setNow(new Date());
    after(1, tick);
  };
  after(1, tick);
  const time = () => `${two(now().getHours())}:${two(now().getMinutes())}`;
  const date = () => `${WEEKDAYS[now().getDay()]}, ${now().getDate()} ${MONTHS[now().getMonth()]}`;

  const terminal = () => focused()?.kind === "terminal";
  setWindowKeys(() => focusedApplet()?.keys?.() ?? null);
  // A window that gains focus takes the body back from the Omarchy menu.
  createEffect(on([current, focused], () => setDeckOpen(false), { defer: true }));
  // Applets hear when their window comes onto the current workspace and leaves it.
  let seen = new Set<Applet>();
  createEffect(() => {
    const next = new Set(visibleWindows().map(appletOf).filter((a) => a !== undefined));
    for (const a of seen) if (!next.has(a)) a.hidden?.();
    for (const a of next) if (!seen.has(a)) a.shown?.();
    seen = next;
  });

  // Omarchy's idle actions (hypridle on a desktop): the screensaver, then the
  // lock, after shell.json's `idle` seconds without input; none while Stay
  // Awake is on, no screensaver while the screensaver-off toggle is on. The
  // toggles are read again when a timeout passes.
  let lastInput = Date.now();
  let saverDue = true;
  let lockDue = true;
  const fresh = (act: (idle: NonNullable<SystemState["idle"]>) => void) =>
    request<SystemState>({ method: "state" }).then((s) => s.idle && !s.idle.stayAwake && act(s.idle), () => {});
  const idleTick = () => {
    after(1, idleTick);
    const settings = state()?.idle;
    if (!settings) return;
    const idle = (Date.now() - lastInput) / 1000;
    if (saverDue && settings.screensaver > 0 && idle >= settings.screensaver) {
      saverDue = false;
      fresh((s) => !s.screensaverOff && startScreensaver());
    }
    if (lockDue && settings.lock > 0 && idle >= settings.lock) {
      lockDue = false;
      fresh(() => lock());
    }
  };
  after(1, idleTick);
  const input = () => {
    lastInput = Date.now();
    saverDue = lockDue = true;
  };

  const press = (key: number) => {
    if (screensaverActive()) return stopScreensaver();
    if (locked() || passwordEntry()) return entryPress(key);
    const l = layer();
    if (l !== "plain") {
      const chord = chordFor(l, key);
      if (!chord) return;
      releasePills();
      return perform(chord.action);
    }
    if (pickerOpen()) return pickerPress(key);
    if (key & BTN.START) return toggleOmarchyDeck();
    const chord = chordFor("plain", key);
    if (chord) return perform(chord.action);
    if (omarchyDeckShown()) return omarchyDeckPress(key);
    if (terminal()) return termPress(key);
    focusedApplet()?.press?.(key);
  };
  // The gamepad while the lock or a panel's password field has the keyboard.
  const entryPress = (key: number) => {
    if (key & OPEN) sendKey("Enter");
    else if (key & BACK) sendKey("Backspace");
    else if (key & (BTN.TRIANGLE | BTN.START)) sendKey("Escape");
  };
  const termPress = (key: number) => {
    // A picks the first candidate while a pinyin composition is open
    if (key & OPEN && composing()) return sendKey(" ");
    for (const [mask, name] of TERM_KEYS) if (key & mask) return sendKey(name);
  };

  let held = 0;
  let heldFor = 0;
  /** the screensaver's dismissing touch: nothing acts until every finger lifts */
  let swallow = false;
  onFrame((pressed: number) => {
    const buttons = pressed | remoteButtons();
    const touch = trackTouches();
    const down = buttons & ~held;
    if (down || touch.raw) input();
    if (buttons & held & REPEATS) heldFor++;
    else heldFor = 0;
    held = buttons;
    setHeld(layerOf(buttons & MODIFIERS));
    for (const key of KEYS) {
      if (down & key) press(key);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) press(key);
    }
    if (screensaverActive() && touch.raw) {
      stopScreensaver();
      swallow = true;
    }
    if (swallow) {
      swallow = touch.raw > 0;
      return;
    }
    if (locked() || passwordEntry()) return keyboardTouch(touch, "full");

    const strip = band(touch, 0, STRIP_H);
    for (const tap of strip.taps) stripTap(tap.start.x);
    const dock = band(touch, DOCK_TOP, 384);
    dockTouch(dock.down.map((c) => c.x));
    for (const tap of dock.taps) if (!tap.moved) dockTap(tap.x);

    const body = band(touch, BODY_TOP, DOCK_TOP);
    if (layer() !== "plain") return chordMapTouch(body);
    if (pickerOpen()) {
      for (const tap of body.taps) pickerTap(tap.y);
      return;
    }
    if (omarchyDeckShown()) {
      for (const tap of body.taps) omarchyDeckTap(tap.x, tap.y);
      return;
    }
    if (terminal()) return keyboardTouch(body, "body");
    const applet = focusedApplet();
    if (applet?.touches) applet.touches(body);
    else for (const tap of body.taps) if (!tap.moved) applet?.tap?.(tap.x, tap.y);
  });

  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]">
      <Wallpaper />
      <Windows />
      <Bar now={now} focused={openPanel} />
      <Osd />
      <Toasts />
      <LockStage clock={time} date={date} />
      <Screensaver />
      <AuxiliarySurface>
        <View class="absolute left-0 top-0 w-[512] h-[384]">
          <Show when={!screensaverActive()} fallback={<ScreensaverDeck />}>
            <Show when={!(locked() || passwordEntry())} fallback={<Keyboard mode="full" />}>
              <Strip />
              <View class="absolute left-0 w-[512] overflow-hidden" style={{ insetT: BODY_TOP, height: BODY_H }}>
                <Show when={layer() === "plain"} fallback={<ChordMap />}>
                  <Show when={!pickerOpen()} fallback={<Picker />}>
                    <Show when={!omarchyDeckShown()} fallback={<OmarchyDeck />}>
                      <Show when={!terminal()} fallback={<Keyboard mode="body" />}>
                        <Show when={focusedApplet()} keyed>
                          {(applet) => <applet.Deck />}
                        </Show>
                      </Show>
                    </Show>
                  </Show>
                </Show>
              </View>
              <Dock />
            </Show>
          </Show>
        </View>
      </AuxiliarySurface>
    </View>
  );
}
