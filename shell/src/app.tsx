// Omarchy Pocket's shell on two panels: the RG DS Plus's two of 512 x 384
// points, or the AYN Thor's 640 x 360 over 413 x 360 (screen.ts); or on the
// ClockworkPi uConsole's one of 640 x 360, where its keyboard, its trackball
// and START as SUPER take the deck's place (uconsoleFrame below,
// docs/clockwork-uconsole.md).
// docs/interaction.md states the system in three lines:
//
//   The stage is the monitor.   The top panel takes no touch: the wallpaper,
//                               the current workspace's windows tiled the way
//                               Omarchy tiles Hyprland (wm.ts) and moved on
//                               the core's tracks (workspaces.ts), Omarchy's
//                               bar, the card (the menu, the panels, the
//                               theme picker), the OSD, notices and the
//                               key sheet.
//   The deck is the keyboard.   The bottom panel is a laptop's lower half: a
//                               function row, keys and a trackpad. It has two
//                               layouts and one rule picks them (focus.ts):
//                               keys for what takes keys, the pad for a touch
//                               app and when nothing has focus. The pad is the
//                               trackpad with the pins under it (deck/dock.tsx)
//                               and the workspaces and the bar's panels in the
//                               function row (deck/strip.tsx). The keyboard
//                               button picks one by hand until the focus
//                               changes; the row's logo opens Omarchy's menu.
//                               While a shoulder is held the deck draws the
//                               controls around it and what each does
//                               (deck/legend.tsx).
//   The gamepad is SUPER.       L1, R1 and both are the chord layers of
//                               chords.ts and last as long as the shoulder;
//                               with no shoulder the buttons are keys for
//                               what has focus (keys.ts), SELECT unfolds or
//                               folds the keys and L2/R2 step workspaces.
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
import { createEffect, createMemo, createSignal, on, Show, untrack } from "solid-js";
import { AuxiliarySurface, View, type NodeMirror } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { perform } from "./actions.ts";
import { appletOf, type Applet } from "./applets/applet.ts";
import { request, type SystemState } from "./bridge.ts";
import { chordFor, layerOf, MODIFIERS } from "./chords.ts";
import { BODY_H, BODY_TOP, STRIP_H } from "./deck/geometry.ts";
import { DeckLegend, tickLegend } from "./deck/legend.tsx";
import { Dock, dockTarget, dockTouch } from "./deck/dock.tsx";
import { pressAt } from "./deck/press.ts";
import { Strip, stripTarget, stripTouch } from "./deck/strip.tsx";
import { pointerAwake, roundTarget, surfacePackage, Touchpad, touchpadTouch } from "./deck/touchpad.tsx";
import { card, cardButton, closeCard } from "./stage/card.tsx";
import { closeMenu } from "./stage/menu.tsx";
import { layout, toggleKeys } from "./focus.ts";
import { setHeldLayer } from "./held.ts";
import { buttonKey, fieldSink, sendRepeat } from "./keys.ts";
import { appletRefused, feedPackage, showPackage, mediaPlaying, touchAppButtons } from "./packages.ts";
import { glide } from "./motion.ts";
import { remoteButtons } from "./remote-input.ts";
import { stickTick } from "./stick.ts";
import { Bar } from "./stage/bar.tsx";
import { Card } from "./stage/card.tsx";
import { KeySheet } from "./stage/keysheet.tsx";
import { closeQr, qrOpen, QrSheet } from "./stage/qrsheet.tsx";
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
import { DECK_H, DECK_W, HAS_DECK, STAGE_H, STAGE_W, UCONSOLE } from "./screen.ts";
import { onHardInput, onHardKey } from "./hardkeys.ts";
import { discardTrackball, sleepPointer, trackballAwake, trackballTick, wheeledWhile } from "./trackball.ts";
import { closeHelp, panelDark, startPressed, startReleased, superLayer, superTick, toggleHelp, used } from "./super.ts";
import { STEPS } from "./chords.ts";
import { Controls } from "./stage/controls.tsx";
import { FieldLine } from "./stage/field.tsx";

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
  // current() and focused() re-run on every change to the windows (a bar
  // setting from the daemon's state is one): the menu closes only when the
  // workspace or the focused window is another one.
  const shownWs = createMemo(current);
  const focusedId = createMemo(() => focused()?.id ?? null);
  createEffect(on([shownWs, focusedId], () => closeMenu(), { defer: true }));
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
    // a package playing media counts as input: no screensaver or lock over a film
    if (mediaPlaying()) lastInput = Date.now();
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
    if (qrOpen()) return closeQr();
    const layer = UCONSOLE ? (locked() ? "plain" : superLayer()) : layerOf(held & MODIFIERS);
    if (layer !== "plain") {
      if (locked()) return;
      const chord = chordFor(layer, key);
      if (chord) {
        if (UCONSOLE) used(STEPS.includes(chord.action) ? "step" : "verb");
        perform(chord.action);
      }
      return;
    }
    const chord = chordFor("plain", key);
    if (chord) return locked() ? undefined : perform(chord.action);
    if (key & BTN.SELECT) return locked() ? undefined : toggleKeys();
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
    if (w.appletSurface) return feedPackage(w.app, touchAppButtons(), pointerContacts(w.app));
    const plain = UCONSOLE ? superLayer() === "plain" : layerOf(buttons & MODIFIERS) === "plain";
    // the uConsole's START is SUPER: a game hears a tap of it as START (uconsoleFrame)
    const own = UCONSOLE ? (buttons & ~(BTN.START | BTN.SELECT)) | (startPulse > 0 ? BTN.START : 0) : buttons & ~(MODIFIERS | BTN.SELECT | BTN.ZL | BTN.ZR);
    const mask = plain && !locked() && !card() && !fieldSink() ? own : 0;
    feedPackage(w.app, mask, contacts);
  };

  const bodyTouch = (frame: TouchFrame): number[] => {
    switch (layout()) {
      case "keys":
        keyboardTouch(frame, "body");
        return touchpadTouch(frame);
      case "pad":
        dockTouch(frame);
        return touchpadTouch(frame);
    }
  };

  // the keys fold away upward as the trackpad grows, and come back
  let keysNode: NodeMirror | undefined;
  createEffect(
    on(layout, (l) => {
      glide(keysNode, "opacity", l === "keys" ? 1 : 0, 140);
      glide(keysNode, "translateY", l === "keys" ? 0 : -14, 180);
    }, { defer: true }),
  );

  let held = 0;
  let heldFor = 0;
  let shoulderFor = 0;
  /** frames a game still hears START after a tap of it (the uConsole's) */
  let startPulse = 0;

  // The uConsole: one panel, its keyboard (hardkeys.ts), its trackball
  // (trackball.ts) and START as SUPER (super.ts). The buttons go through
  // press() as the RG DS Plus's do, with the layer from super.ts.
  onHardInput(input);
  onHardKey(sleepPointer);
  const uconsoleFrame = (buttons: number) => {
    const down = buttons & ~held;
    const up = held & ~buttons;
    // the key or roll that lights a dark panel only lights it
    if (panelDark()) {
      held = buttons;
      return discardTrackball();
    }
    const rolled = trackballTick();
    if (down || rolled) input();
    if (buttons & held & REPEATS) heldFor++;
    else heldFor = 0;
    held = buttons;
    if (startPulse > 0) startPulse--;
    if (down & ~BTN.SELECT) closeHelp();
    if (screensaverActive() && (down || rolled)) return stopScreensaver();
    // START: SUPER, or the lock's Escape; a game hears a tap of it
    if (down & BTN.START) {
      if (locked()) press(BTN.START, buttons);
      else startPressed();
    }
    if (up & BTN.START && !locked()) {
      const game = focusedPackage() && !focusedPackage()!.appletSurface && !card() && superLayer() === "window";
      if (startReleased(!game) === "tap" && game) startPulse = 4;
    }
    superTick();
    setHeldLayer(superLayer());
    // SELECT is the firmware's wheel while held: up again with no wheel in
    // between, it is the controls row, or its chord under SUPER
    if (down & BTN.SELECT) wheeledWhile(true);
    if (up & BTN.SELECT && !wheeledWhile(false) && !locked()) {
      if (superLayer() === "plain") toggleHelp();
      else press(BTN.SELECT, buttons | BTN.SELECT);
    }
    for (const key of KEYS) {
      if (key & (BTN.START | BTN.SELECT)) continue;
      if (down & key) press(key, buttons);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) sendRepeat(() => press(key, buttons));
    }
    if (locked()) return;
    feed(buttons, []);
  };
  /** the screensaver's dismissing touch: nothing acts until every finger lifts */
  let swallow = false;
  onFrame((pressed: number) => {
    const buttons = pressed | remoteButtons();
    if (UCONSOLE) return uconsoleFrame(buttons);
    const touch = trackTouches();
    const down = buttons & ~held;
    if (down || touch.raw) input();
    if (buttons & held & REPEATS) heldFor++;
    else heldFor = 0;
    held = buttons;
    setHeldLayer(layerOf(buttons & MODIFIERS));
    shoulderFor = buttons & MODIFIERS ? shoulderFor + 1 : 0;
    tickLegend(!locked() && !!(buttons & MODIFIERS), shoulderFor);
    stickTick(!locked() && layerOf(buttons & MODIFIERS) === "move");
    for (const key of KEYS) {
      if (down & key) press(key, buttons);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) sendRepeat(() => press(key, buttons));
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
    pressAt(!first ? null : first.start.y < STRIP_H ? stripTarget(first.x) : (dockTarget(first.x, first.y - BODY_TOP, first.moved) ?? roundTarget(first.x, first.y - BODY_TOP)));
    stripTouch(band(touch, 0, STRIP_H));
    const contacts = bodyTouch(band(touch, BODY_TOP, DECK_H));
    feed(buttons, contacts);
  });

  return (
    <View class="absolute left-0 top-0" style={{ width: STAGE_W, height: STAGE_H }}>
      <Wallpaper />
      <Windows />
      <Bar now={now} focused={openPanel} />
      <Card />
      <KeySheet />
      <QrSheet />
      <Osd />
      <Toasts />
      <Pointer shown={() => !locked() && (UCONSOLE ? trackballAwake() : layout() === "pad" ? !surfacePackage() : layout() === "keys" && pointerAwake())} />
      <LockStage clock={time} date={date} />
      <Show when={UCONSOLE}>
        <Controls />
        <FieldLine />
      </Show>
      <Screensaver />
      <Show when={HAS_DECK}>
      <AuxiliarySurface>
        <View class="absolute left-0 top-0" style={{ width: DECK_W, height: DECK_H, bgColor: color("darker_background") }}>
          <Show when={!screensaverActive()} fallback={<ScreensaverDeck />}>
            {/* the deck and the lock's keyboard both stay mounted and show by
                opacity: unlocking repaints the deck instead of building it */}
            <View class="absolute left-0 top-0 contain-strict" style={{ width: DECK_W, height: DECK_H, opacity: locked() ? 0 : 1 }}>
              <View class="absolute left-0 overflow-hidden contain-strict" style={{ width: DECK_W, insetT: BODY_TOP, height: BODY_H }}>
                {/* everything stays mounted and shows by opacity, so a change of
                    focus repaints instead of building a layout; the dock
                    draws after the trackpad, as its pin editor covers it */}
                <View class="absolute left-0 top-0 contain-strict" style={{ width: DECK_W, height: BODY_H }}>
                  <Touchpad />
                </View>
                <View class="absolute left-0 top-0 contain-strict" style={{ width: DECK_W, height: BODY_H }}>
                  <Dock />
                </View>
                <View
                  class="absolute left-0 top-0 contain-strict"
                  style={{ width: DECK_W, height: BODY_H, opacity: untrack(layout) === "keys" ? 1 : 0, translateY: untrack(layout) === "keys" ? 0 : -14 }}
                  ref={(n: NodeMirror) => (keysNode = n)}
                >
                  <Keyboard mode="body" />
                </View>
              </View>
              <Strip />
            </View>
            <View class="absolute left-0 top-0 contain-strict" style={{ width: DECK_W, height: DECK_H, opacity: locked() ? 1 : 0 }}>
              <Keyboard mode="full" />
            </View>
            {/* over the deck while a shoulder is held: the controls around it and what they do */}
            <DeckLegend />
          </Show>
        </View>
      </AuxiliarySurface>
      </Show>
    </View>
  );
}
