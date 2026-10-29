// Omarchy Pocket's shell: Omarchy's desktop elements on the RG DS Plus's two
// 512x384-point panels. The top panel is the stage: the theme's wallpaper
// under Omarchy's bar, the OSD and notices. The bottom panel is the deck: the
// Omarchy menu, read from Omarchy's own omarchy-menu.jsonc, driven by the
// gamepad and by touch. Select brings up Pocket Term: the terminal on the
// stage and a keyboard on the deck (term/). The lock screen covers both and
// takes input first.
// The bottom panel has one AuxiliarySurface: each portal is a flex child of
// the panel's root, so two would share its width.
import { createSignal, Show } from "solid-js";
import { AuxiliarySurface, Image, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { auxiliaryTouches, BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { BACK, deckPress, deckTap, MenuDeck, OPEN } from "./deck/menu-deck.tsx";
import { remoteButtons, remoteContact } from "./remote-input.ts";
import { Bar } from "./stage/bar.tsx";
import { LockDeck, lockFrame, LockStage } from "./stage/lock.tsx";
import { Osd } from "./stage/osd.tsx";
import { Toasts } from "./stage/toasts.tsx";
import { TermGrid } from "./term/grid.tsx";
import { Keyboard, keyboardTouch, latch, sendKey, TABS_HEIGHT, tabsTap } from "./term/keyboard.tsx";
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
    if (termShown()) return termPress(key);
    if (key & BTN.SELECT) openTerminal();
    else if (key & BTN.ZL) setWorkspace((w) => (w > 1 ? w - 1 : 5));
    else if (key & BTN.ZR) setWorkspace((w) => (w < 5 ? w + 1 : 1));
    else deckPress(key);
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
    for (const [mask, name] of TERM_KEYS) if (key & mask) return sendKey(name);
  };

  let held = 0;
  let heldFor = 0;
  let touch: { x: number; y: number } | null = null;
  onFrame((pressed: number) => {
    const buttons = pressed | remoteButtons();
    const contact = auxiliaryTouches()[0] ?? remoteContact();
    if (lockFrame(buttons)) {
      held = buttons;
      touch = null;
      return;
    }
    const down = buttons & ~held;
    if (buttons & held & REPEATS) heldFor++;
    else heldFor = 0;
    held = buttons;
    for (const key of KEYS) {
      if (down & key) press(key);
      else if (key & REPEATS & buttons && heldFor > REPEAT_AFTER && (heldFor - REPEAT_AFTER) % REPEAT_EVERY === 0) press(key);
    }
    if (termShown()) {
      // the tab strip acts on release; the keyboard tracks the finger
      if (contact && (contact.y >= TABS_HEIGHT || touch)) keyboardTouch(contact);
      if (contact) touch = { x: contact.x, y: contact.y };
      else if (touch) {
        if (touch.y < TABS_HEIGHT) tabsTap(touch.x);
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
      <Image class="absolute left-0 top-0 w-[256] h-[256]" src="wall-0-0.png" />
      <Image class="absolute left-[256] top-0 w-[256] h-[256]" src="wall-1-0.png" />
      <Image class="absolute left-0 top-[256] w-[256] h-[128]" src="wall-0-1.png" />
      <Image class="absolute left-[256] top-[256] w-[256] h-[128]" src="wall-1-1.png" />
      <Show when={termShown()}>
        <TermGrid />
      </Show>
      <Bar clock={clock} workspace={workspace} />
      <Osd />
      <Toasts />
      <LockStage clock={time} date={date} />
      <AuxiliarySurface>
        <Show when={termShown()} fallback={<MenuDeck />}>
          <Keyboard />
        </Show>
        <LockDeck />
      </AuxiliarySurface>
    </View>
  );
}
