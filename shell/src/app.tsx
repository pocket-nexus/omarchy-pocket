// Omarchy Pocket's shell: Omarchy's desktop on the RG DS Plus's two
// 512x384-point panels, with Pocket Shell's 3DS interaction. The top panel is
// the stage, a screen on the wall that takes no touch: the wallpaper, the
// current workspace's windows tiled the way Omarchy tiles Hyprland (wm.ts)
// and moved on the core's animation tracks (workspaces.ts), Omarchy's bar,
// the card (Omarchy's menu, the bar's panels, the theme picker), the OSD,
// notices and the key sheet. The bottom panel is the deck, the stage's
// remote: the strip (L1/R1 pills, workspaces, layout, the bar's
// indicators), the body (deck/body.ts: the live minimap unless a chord card,
// the card's remote or the focused window's controls are asked for) and the
// dock.
//
// The gamepad: L1, R1 and both together are the chord layers of chords.ts;
// with no shoulder held the buttons belong to the focused window, SELECT
// brings up its keyboard or controls on the deck, and L2/R2 step workspaces.
// A PocketJS package runs in a window like any other (packages.ts): the
// focused one gets the buttons the window manager does not take.
// The lock screen covers both panels and takes input first; the screensaver
// covers everything.
//
// What the deck shows follows what asked for it, so nothing stays once its
// asker is gone: a chord card lasts while a shoulder or a pill's finger is
// down (or a pill's latch, which any other tap lets go), a card's remote
// while the card is up (a menu row that runs closes the menu; locking closes
// the card), and a window's body while there is a focused window.
//
// The bottom panel has one AuxiliarySurface: each portal is a flex child of
// the panel's root, so two would share its width. The portal inserts its
// child once (framework renderPortalChild calls the accessor), so the deck's
// switching sits inside a View.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { perform, toggleControls } from "./actions.ts";
import { appletOf, focusedApplet, type Applet } from "./applets/applet.ts";
import { request, type SystemState } from "./bridge.ts";
import { chordFor, HELD_LAYERS, layerOf, MODIFIERS } from "./chords.ts";
import { body, setBody } from "./deck/body.ts";
import { ChordCard, chordCardTouch, chordTarget } from "./deck/chord-card.tsx";
import { Dock, dockTap, dockTarget } from "./deck/dock.tsx";
import { BODY_H, BODY_TOP, DOCK_TOP, STRIP_H } from "./deck/geometry.ts";
import { latchedAny, layer, releasePills, setHeld } from "./deck/layer.ts";
import { BACK, closeMenu, OPEN } from "./stage/menu.tsx";
import { Minimap, minimapTouch } from "./deck/minimap.tsx";
import { openPanel, passwordEntry } from "./stage/panels.tsx";
import { Card, card, cardPress, closeCard } from "./stage/card.tsx";
import { Remote, remoteTouch } from "./deck/remote.tsx";
import { Touchpad, touchpadTouch } from "./deck/touchpad.tsx";
import { TermRemote, termRemoteTouch } from "./deck/term-remote.tsx";
import { Pointer, pointerContacts } from "./stage/pointer.tsx";
import { pressAt } from "./deck/press.ts";
import { Strip, stripTarget, stripTouch, takesKeys } from "./deck/strip.tsx";
import { remoteButtons } from "./remote-input.ts";
import { Bar } from "./stage/bar.tsx";
import { KeySheet } from "./stage/keysheet.tsx";
import { lock, locked, LockStage } from "./stage/lock.tsx";
import { Osd } from "./stage/osd.tsx";
import { Screensaver, screensaverActive, ScreensaverDeck, startScreensaver, stopScreensaver } from "./stage/screensaver.tsx";
import { Toasts } from "./stage/toasts.tsx";
import { Wallpaper } from "./stage/wallpaper.tsx";
import { Windows } from "./stage/windows.tsx";
import { state } from "./system.ts";
import { color } from "./theme.ts";
import { composing } from "./term/ime.ts";
import { Keyboard, keyboardTouch, sendKey, setWindowKeys } from "./term/keyboard.tsx";
import { band, trackTouches, type TouchFrame } from "./touch.ts";
import "./windows.ts";
import { current, focused, revision, visibleWindows, windowsOn, WORKSPACES } from "./workspaces.ts";
import { appletRefused, feedPackage, showPackage } from "./packages.ts";
import { AppControls, appControlsTouch } from "./deck/app-controls.tsx";

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

/** A terminal's keys with no shoulder held, as Pocket Shell's term takes
 *  them: the D-pad is the arrows, A Enter, B Backspace, X Tab, Y Space, and
 *  START Escape. */
const TERM_KEYS: [number, string][] = [
  [BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"],
  [OPEN, "Enter"], [BACK, "Backspace"], [BTN.TRIANGLE, "Tab"], [BTN.SQUARE, " "], [BTN.START, "Escape"],
];

/** What the body shows, by the rules in deck/body.ts. */
type Shown = "chords" | "remote" | "keys" | "touchpad" | "controls" | "map";

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
  const focusedPackage = () => {
    const w = focused();
    return w?.kind === "app" ? w : null;
  };
  const shown = (): Shown => {
    if (layer() !== "plain") return "chords";
    if (card()) return "remote";
    if (body() === "keys" && takesKeys()) return "keys";
    // an applet is a touch app: its remote is the touchpad on the stage
    if (body() === "controls" && focusedPackage()?.appletSurface) return "touchpad";
    if (body() === "controls" && focused()) return "controls";
    return "map";
  };
  setWindowKeys(() => focusedApplet()?.keys?.() ?? null);
  // A window opened from the menu takes focus; the menu makes way for it.
  createEffect(on([current, focused], () => closeMenu(), { defer: true }));
  // With no focused window the body goes back to the map, so a window's body
  // does not come back with the next window.
  createEffect(on(focused, (w) => !w && setBody("map"), { defer: true }));
  // A card takes the deck: a latched pill lets go. Locking puts the card away.
  createEffect(on(card, (c) => c && releasePills(), { defer: true }));
  createEffect(
    on(
      locked,
      (l) => {
        if (!l) return;
        closeCard();
        releasePills();
      },
      { defer: true },
    ),
  );
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
    const chord = chordFor("plain", key);
    if (chord) return perform(chord.action);
    // a card on the stage has the D-pad and the face buttons while it is up
    if (card()) return cardPress(key);
    if (key & BTN.SELECT) return toggleControls();
    // a package takes the buttons itself, each frame (feed)
    if (focusedPackage()) return;
    if (terminal()) return termPress(key);
    focusedApplet()?.press?.(key);
  };
  /** the package fed last, released when it loses focus */
  let fed: number | null = null;
  const feed = (buttons: number, body: TouchFrame) => {
    const w = focusedPackage();
    if (fed !== null && fed !== w?.app) {
      feedPackage(fed, 0, []);
      fed = null;
    }
    if (!w) return;
    const view = shown();
    // an applet answers touch only (the pointer's); the buttons are the shell's
    if (w.appletSurface) {
      feedPackage(w.app, 0, pointerContacts(w.app));
      fed = w.app;
      return;
    }
    let mask = layer() === "plain" && (view === "map" || view === "controls") ? buttons & ~(MODIFIERS | BTN.SELECT | BTN.ZL | BTN.ZR) : 0;
    let contacts: number[] = [];
    if (view === "controls") {
      const touched = appControlsTouch(body, w);
      mask |= touched.buttons;
      contacts = touched.contacts;
    }
    feedPackage(w.app, mask, contacts);
    fed = w.app;
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

  const bodyTouch = (frame: TouchFrame) => {
    switch (shown()) {
      case "chords":
        return chordCardTouch(frame);
      case "remote":
        return remoteTouch(frame);
      case "touchpad":
        return touchpadTouch(frame);
      case "keys":
        return keyboardTouch(frame, "body");
      case "controls": {
        if (focusedPackage()) return;
        if (terminal()) return termRemoteTouch(frame);
        const applet = focusedApplet();
        if (applet?.touches) return applet.touches(frame);
        for (const tap of frame.taps) if (!tap.moved) applet?.tap?.(tap.x, tap.y);
        return;
      }
      case "map":
        return minimapTouch(frame);
    }
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

    // the pressed look follows the oldest finger
    const first = touch.down[0];
    pressAt(
      !first
        ? null
        : first.start.y < STRIP_H
          ? stripTarget(first.x)
          : first.start.y >= DOCK_TOP
            ? dockTarget(first.x)
            : shown() === "chords"
              ? chordTarget(first.x, first.y - BODY_TOP)
              : null,
    );
    stripTouch(band(touch, 0, STRIP_H));
    for (const tap of band(touch, DOCK_TOP, 384).taps) if (!tap.moved) dockTap(tap.x);
    const body = band(touch, BODY_TOP, DOCK_TOP);
    feed(buttons, body);
    bodyTouch(body);
    // a latched pill lets go at any tap that is not on a pill
    const onPill = (x: number) => stripTarget(x) === "strip:L" || stripTarget(x) === "strip:R";
    if (latchedAny() && touch.taps.some((t) => !(t.start.y < STRIP_H && onPill(t.start.x)))) releasePills();
  });

  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]">
      <Wallpaper />
      <Windows />
      <Bar now={now} focused={openPanel} />
      <Card />
      <KeySheet />
      <Osd />
      <Toasts />
      <Pointer shown={() => shown() === "touchpad"} />
      <LockStage clock={time} date={date} />
      <Screensaver />
      <AuxiliarySurface>
        <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ bgColor: color("darker_background") }}>
          <Show when={!screensaverActive()} fallback={<ScreensaverDeck />}>
            <Show when={!(locked() || passwordEntry())} fallback={<Keyboard mode="full" />}>
              <View class="absolute left-0 w-[512] overflow-hidden contain-strict" style={{ insetT: BODY_TOP, height: BODY_H }}>
                {/* the map and the chord cards stay mounted and show by opacity,
                    so a shoulder press repaints instead of building its body;
                    the rest mount on demand */}
                <View class="absolute left-0 top-0 w-[512] h-[318] contain-strict" style={{ opacity: shown() === "map" ? 1 : 0 }}>
                  <Minimap />
                </View>
                <For each={HELD_LAYERS}>{(l) => <ChordCard layer={l} />}</For>
                <Show when={shown() === "remote"}>
                  <Remote />
                </Show>
                <Show when={shown() === "touchpad"}>
                  <Touchpad />
                </Show>
                <Show when={shown() === "keys"}>
                  <Keyboard mode="body" />
                </Show>
                <Show when={shown() === "controls"}>
                  <Show when={!terminal()} fallback={<TermRemote />}>
                    <Show when={focusedPackage()} keyed fallback={<Show when={focusedApplet()} keyed>{(applet) => <applet.Deck />}</Show>}>
                      {(w) => <AppControls win={w} />}
                    </Show>
                  </Show>
                </Show>
              </View>
              <Strip />
              <Dock />
            </Show>
          </Show>
        </View>
      </AuxiliarySurface>
    </View>
  );
}
