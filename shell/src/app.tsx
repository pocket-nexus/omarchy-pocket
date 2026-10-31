// Omarchy Pocket's shell on the RG DS Plus's two 512x384-point panels.
// docs/interaction.md states the system in three lines:
//
//   The stage is the monitor.   The top panel takes no touch: the wallpaper,
//                               the current workspace's windows tiled the way
//                               Omarchy tiles Hyprland (wm.ts) and moved on
//                               the core's tracks (workspaces.ts), Omarchy's
//                               bar, the card (the menu, the panels, the
//                               theme picker), the OSD, notices, the legend
//                               and the key sheet.
//   The deck is the keyboard.   The bottom panel has three layouts and one
//                               rule picks them (focus.ts): keys for what
//                               takes keys, the pad for a touch app, home
//                               when nothing has focus. The strip's tabs
//                               pick one by hand until the focus changes;
//                               the strip's logo opens Omarchy's menu.
//   The gamepad is SUPER.       L1, R1 and both are the chord layers of
//                               chords.ts and last as long as the shoulder;
//                               with no shoulder the buttons are keys for
//                               what has focus (keys.ts), SELECT turns the
//                               deck's layout and L2/R2 step workspaces.
//
// A PocketJS package runs in a window like any other (packages.ts): a touch
// app's touches come from the pad's pointer, and any other package gets the
// buttons the window manager does not take. The lock screen covers both
// panels and takes input first; the screensaver covers everything.
//
// The bottom panel has one AuxiliarySurface: each portal is a flex child of
// the panel's root, so two would share its width. The portal inserts its
// child once (framework renderPortalChild calls the accessor), so the deck's
// switching sits inside a View.
import { createEffect, createSignal, on, Show } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { perform } from "./actions.ts";
import { appletOf, type Applet } from "./applets/applet.ts";
import { request, type SystemState } from "./bridge.ts";
import { chordFor, layerOf, MODIFIERS } from "./chords.ts";
import { BODY_H, BODY_TOP, STRIP_H } from "./deck/geometry.ts";
import { Home, homeTarget, homeTouch } from "./deck/home.tsx";
import { pressAt } from "./deck/press.ts";
import { Strip, stripTarget, stripTouch } from "./deck/strip.tsx";
import { surfacePackage, Touchpad, touchpadTouch } from "./deck/touchpad.tsx";
import { card, cardButton, closeCard } from "./stage/card.tsx";
import { closeMenu } from "./stage/menu.tsx";
import { cycleLayout, layout } from "./focus.ts";
import { setHeldLayer } from "./held.ts";
import { buttonKey, fieldSink } from "./keys.ts";
import { appletRefused, feedPackage, showPackage } from "./packages.ts";
import { remoteButtons } from "./remote-input.ts";
import { Bar } from "./stage/bar.tsx";
import { Card } from "./stage/card.tsx";
import { KeySheet, Legend, tickLegend } from "./stage/keysheet.tsx";
import { lock, locked, LockStage } from "./stage/lock.tsx";
import { Osd } from "./stage/osd.tsx";
import { openPanel } from "./stage/panels.tsx";
import { Pointer, pointerContacts } from "./stage/pointer.tsx";
import { Screensaver, screensaverActive, ScreensaverDeck, startScreensaver, stopScreensaver } from "./stage/screensaver.tsx";
import { Toasts } from "./stage/toasts.tsx";
import { Wallpaper } from "./stage/wallpaper.tsx";
import { Windows } from "./stage/windows.tsx";
import { state } from "./system.ts";
import { composing } from "./term/ime.ts";
import { Keyboard, keyboardTouch, resetKeyboard, sendKey } from "./term/keyboard.tsx";
import { color } from "./theme.ts";
import { band, trackTouches, type TouchFrame } from "./touch.ts";
import "./windows.ts";
import { current, focused, revision, visibleWindows, windowsOn, WORKSPACES } from "./workspaces.ts";

const REPEATS = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;
const REPEAT_AFTER = 18;
const REPEAT_EVERY = 4;
const KEYS = [
  BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, BTN.CIRCLE, BTN.CROSS, BTN.TRIANGLE, BTN.SQUARE,
  BTN.START, BTN.SELECT, BTN.ZL, BTN.ZR,
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const two = (n: number) => (n < 10 ? `0${n}` : String(n));

export default function Shell() {
  const [now, setNow] = createSignal(new Date());
  const tick = () => {
    setNow(new Date());
    after(1, tick);
  };
  after(1, tick);
  const time = () => `${two(now().getHours())}:${two(now().getMinutes())}`;
  const date = () => `${WEEKDAYS[now().getDay()]}, ${now().getDate()} ${MONTHS[now().getMonth()]}`;

  const focusedPackage = () => {
    const w = focused();
    return w?.kind === "app" ? w : null;
  };
  // A window opened from the menu takes focus; the menu makes way for it.
  createEffect(on([current, focused], () => closeMenu(), { defer: true }));
  // Locking puts the card away.
  createEffect(on(locked, (l) => l && closeCard(), { defer: true }));
  // A new focus gets a fresh keyboard: no latched modifiers, the letters.
  createEffect(on(() => `${fieldSink() ? 1 : 0}:${card() ?? ""}:${focused()?.id ?? ""}`, resetKeyboard, { defer: true }));
  // A package off the current workspace is paused.
  createEffect(() => {
    revision();
    for (let ws = 0; ws < WORKSPACES; ws++) for (const w of windowsOn(ws)) if (w.kind === "app") showPackage(w.app, ws === current() && !appletRefused(w.app));
  });
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

  /** A button pressed this frame. */
  const press = (key: number, held: number) => {
    if (screensaverActive()) return stopScreensaver();
    const layer = layerOf(held & MODIFIERS);
    if (layer !== "plain") {
      if (locked()) return;
      const chord = chordFor(layer, key);
      if (chord) perform(chord.action);
      return;
    }
    const chord = chordFor("plain", key);
    if (chord) return locked() ? undefined : perform(chord.action);
    if (key & BTN.SELECT) return locked() ? undefined : cycleLayout();
    if (!locked() && card() && cardButton(key)) return;
    // a package that is not a touch app takes the buttons itself, each frame (feed)
    if (!locked() && !fieldSink() && focusedPackage() && !focusedPackage()!.appletSurface) return;
    // A picks the first candidate while a pinyin composition is open
    if (key & BTN.CIRCLE && composing()) return sendKey(" ");
    const name = buttonKey(key);
    if (name) sendKey(name);
  };

  /** the package fed last, released when it loses focus */
  let fed: number | null = null;
  const feed = (buttons: number, contacts: number[]) => {
    const w = focusedPackage();
    if (fed !== null && fed !== w?.app) {
      feedPackage(fed, 0, []);
      fed = null;
    }
    if (!w) return;
    fed = w.app;
    // a touch app answers touch only (the pointer's); the buttons are the shell's
    if (w.appletSurface) return feedPackage(w.app, 0, pointerContacts(w.app));
    const mask = layerOf(buttons & MODIFIERS) === "plain" && !locked() && !card() && !fieldSink() ? buttons & ~(MODIFIERS | BTN.SELECT | BTN.ZL | BTN.ZR) : 0;
    feedPackage(w.app, mask, contacts);
  };

  const bodyTouch = (frame: TouchFrame): number[] => {
    switch (layout()) {
      case "keys":
        keyboardTouch(frame, "body");
        return [];
      case "pad":
        return touchpadTouch(frame);
      case "home":
        homeTouch(frame);
        return [];
    }
  };

  let held = 0;
  let heldFor = 0;
  let shoulderFor = 0;
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
    setHeldLayer(layerOf(buttons & MODIFIERS));
    shoulderFor = buttons & MODIFIERS ? shoulderFor + 1 : 0;
    tickLegend(!locked() && !!(buttons & MODIFIERS), shoulderFor);
    for (const key of KEYS) {
      if (down & key) press(key, buttons);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) press(key, buttons);
    }
    if (screensaverActive() && touch.raw) {
      stopScreensaver();
      swallow = true;
    }
    if (swallow) {
      swallow = touch.raw > 0;
      return;
    }
    if (locked()) return keyboardTouch(touch, "full");

    // the pressed look follows the oldest finger
    const first = touch.down[0];
    pressAt(!first ? null : first.start.y < STRIP_H ? stripTarget(first.x) : layout() === "home" ? homeTarget(first.x, first.y - BODY_TOP) : null);
    stripTouch(band(touch, 0, STRIP_H));
    const contacts = bodyTouch(band(touch, BODY_TOP, 384));
    feed(buttons, contacts);
  });

  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]">
      <Wallpaper />
      <Windows />
      <Bar now={now} focused={openPanel} />
      <Card />
      <KeySheet />
      <Legend />
      <Osd />
      <Toasts />
      <Pointer shown={() => layout() === "pad" && !surfacePackage() && !locked()} />
      <LockStage clock={time} date={date} />
      <Screensaver />
      <AuxiliarySurface>
        <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ bgColor: color("darker_background") }}>
          <Show when={!screensaverActive()} fallback={<ScreensaverDeck />}>
            {/* the deck and the lock's keyboard both stay mounted and show by
                opacity: unlocking repaints the deck instead of building it */}
            <View class="absolute left-0 top-0 w-[512] h-[384] contain-strict" style={{ opacity: locked() ? 0 : 1 }}>
              <View class="absolute left-0 w-[512] overflow-hidden contain-strict" style={{ insetT: BODY_TOP, height: BODY_H }}>
                {/* the keys and home stay mounted and show by opacity, so a change of
                    focus repaints instead of building a layout; the pad mounts on demand */}
                <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: BODY_H, opacity: layout() === "home" ? 1 : 0 }}>
                  <Home />
                </View>
                <View class="absolute left-0 top-0 w-[512] contain-strict" style={{ height: BODY_H, opacity: layout() === "keys" ? 1 : 0 }}>
                  <Keyboard mode="body" />
                </View>
                <Show when={layout() === "pad"}>
                  <Touchpad />
                </Show>
              </View>
              <Strip />
            </View>
            <View class="absolute left-0 top-0 w-[512] h-[384] contain-strict" style={{ opacity: locked() ? 1 : 0 }}>
              <Keyboard mode="full" />
            </View>
          </Show>
        </View>
      </AuxiliarySurface>
    </View>
  );
}
