// Omarchy Pocket's shell: Omarchy's desktop elements on the RG DS Plus's two
// 512x384-point panels. The top panel is the stage: the theme's wallpaper
// under Omarchy's bar, the OSD and notices. The bottom panel is the deck: the
// Omarchy menu, read from Omarchy's own omarchy-menu.jsonc, driven by the
// gamepad and by touch. Select brings up Pocket Term: the terminal on the
// stage and a keyboard on the deck (term/). R2 opens the bar indicators'
// panels on the deck (Network, Audio, Power, Bluetooth). The lock screen
// covers both and takes input first.
// The bottom panel has one AuxiliarySurface: each portal is a flex child of
// the panel's root, so two would share its width.
import { createSignal, Show } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { auxiliaryTouches, BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { BACK, deckPress, deckTap, MenuDeck, OPEN } from "./deck/menu-deck.tsx";
import { openPanel, Panels, panelPress, panelTap, passwordEntry, showPanel } from "./deck/panels.tsx";
import { Picker, pickerOpen, pickerPress, pickerTap } from "./deck/picker.tsx";
import { remoteButtons, remoteContact } from "./remote-input.ts";
import { Bar } from "./stage/bar.tsx";
import { locked, LockStage } from "./stage/lock.tsx";
import { Osd } from "./stage/osd.tsx";
import { actOnNewest, Toasts } from "./stage/toasts.tsx";
import { Wallpaper } from "./stage/wallpaper.tsx";
import { TermGrid } from "./term/grid.tsx";
import { Keyboard, keyboardTouch, latch, sendKey, TABS_HEIGHT, tabsTap } from "./term/keyboard.tsx";
import { composing } from "./term/ime.ts";
import { cycle, hide, openTerminal, shown as termShown } from "./term/store.ts";

const REPEATS = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;
const REPEAT_AFTER = 18;
const REPEAT_EVERY = 4;
const KEYS = [
  BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, OPEN, BACK, BTN.TRIANGLE, BTN.SQUARE,
  BTN.START, BTN.SELECT, BTN.LTRIGGER, BTN.RTRIGGER, BTN.ZL, BTN.ZR,
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
  const clock = () => `${WEEKDAYS[now().getDay()]} ${time()}`;
  const date = () => `${WEEKDAYS[now().getDay()]}, ${now().getDate()} ${MONTHS[now().getMonth()]}`;

  const [workspace, setWorkspace] = createSignal(1);
  const press = (key: number) => {
    if (locked() || passwordEntry()) return entryPress(key);
    if (pickerOpen()) return pickerPress(key);
    if (openPanel()) return panelPress(key);
    if (termShown()) return termPress(key);
    if (key & BTN.ZR) showPanel("network");
    else if (key & BTN.SELECT) openTerminal();
    else if (key & BTN.SQUARE) actOnNewest(true);
    else if (key & BTN.TRIANGLE) actOnNewest(false);
    else if (key & BTN.ZL) setWorkspace((w) => (w < 5 ? w + 1 : 1));
    else deckPress(key);
  };
  // The gamepad while a panel's password field has the keyboard.
  const entryPress = (key: number) => {
    if (key & OPEN) sendKey("Enter");
    else if (key & BACK) sendKey("Backspace");
    else if (key & (BTN.TRIANGLE | BTN.START)) sendKey("Escape");
  };
  // The gamepad in a terminal: the D-pad is the arrow keys, the face buttons
  // the keys a shell and a TUI need most, L2/R2 latch Ctrl/Alt.
  const TERM_KEYS: [number, string][] = [
    [BTN.UP, "Up"], [BTN.DOWN, "Down"], [BTN.LEFT, "Left"], [BTN.RIGHT, "Right"],
    [OPEN, "Enter"], [BACK, "Backspace"], [BTN.TRIANGLE, "Escape"], [BTN.SQUARE, "Tab"],
    [BTN.LTRIGGER, "PageUp"], [BTN.RTRIGGER, "PageDown"],
  ];
  const termPress = (key: number) => {
    if (key & BTN.START) return hide();
    if (key & BTN.SELECT) return cycle();
    if (key & BTN.ZL) return latch("ctrl");
    if (key & BTN.ZR) return latch("alt");
    // A picks the first candidate while a pinyin composition is open
    if (key & OPEN && composing()) return sendKey(" ");
    for (const [mask, name] of TERM_KEYS) if (key & mask) return sendKey(name);
  };

  let held = 0;
  let heldFor = 0;
  let touch: { x: number; y: number } | null = null;
  onFrame((pressed: number) => {
    const buttons = pressed | remoteButtons();
    const contact = auxiliaryTouches()[0] ?? remoteContact();
    const down = buttons & ~held;
    if (buttons & held & REPEATS) heldFor++;
    else heldFor = 0;
    held = buttons;
    for (const key of KEYS) {
      if (down & key) press(key);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) press(key);
    }
    if (pickerOpen() && !locked()) {
      if (contact) touch = { x: contact.x, y: contact.y };
      else if (touch) {
        pickerTap(touch.y);
        touch = null;
      }
      return;
    }
    if (openPanel() && !passwordEntry() && !locked()) {
      if (contact) touch = { x: contact.x, y: contact.y };
      else if (touch) {
        panelTap(touch.x, touch.y);
        touch = null;
      }
      return;
    }
    if (termShown() || passwordEntry() || locked()) {
      // the tab strip acts on release; the keyboard tracks the finger
      if (contact && (contact.y >= TABS_HEIGHT || touch)) keyboardTouch(contact);
      if (contact) touch = { x: contact.x, y: contact.y };
      else if (touch) {
        if (touch.y < TABS_HEIGHT) {
          if (!passwordEntry() && !locked()) tabsTap(touch.x);
        }
        else keyboardTouch(null);
        touch = null;
      }
      return;
    }
    if (contact) touch = { x: contact.x, y: contact.y };
    else if (touch) {
      deckTap(touch.y);
      touch = null;
    }
  });

  return (
    <View class="absolute left-0 top-0 w-[512] h-[384]">
      <Wallpaper />
      <Show when={termShown()}>
        <TermGrid />
      </Show>
      <Bar clock={clock} workspace={workspace} focused={openPanel} />
      <Osd />
      <Toasts />
      <LockStage clock={time} date={date} />
      <AuxiliarySurface>
        <Show when={!pickerOpen() || locked()} fallback={<Picker />}>
          <Show when={termShown() || passwordEntry() || locked()} fallback={<Show when={openPanel()} fallback={<MenuDeck />}><Panels /></Show>}>
            <Keyboard />
          </Show>
        </Show>
      </AuxiliarySurface>
    </View>
  );
}
