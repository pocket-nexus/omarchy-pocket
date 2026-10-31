// The stage's card: Omarchy's menu, the bar's panels and the theme picker
// open over the windows in one card, as Omarchy's launcher opens over a
// desktop, and the stage dims behind it. While a card is up it has the keys
// (focus.ts): the deck's keyboard and the gamepad's plain buttons drive it,
// and a pointer click lands on its rows. The card fades and lifts in on the
// core's tracks; the last card's content stays while it fades out.
import { createEffect, createSignal, on, Show } from "solid-js";
import { View, type NodeMirror } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { C } from "../classes.ts";
import type { KeySink } from "../keys.ts";
import { glide } from "../motion.ts";
import { color } from "../theme.ts";
import type { TouchFrame } from "../touch.ts";
import { CARD_H, CARD_W, CARD_X, CARD_Y } from "./geometry.ts";
import { closeMenu, MenuCard, menuKey, menuOpen, menuText, menuTitle, menuTouch } from "./menu.tsx";
import { closePanel, openPanel, panelKey, panelTitle, Panels, panelTouch } from "./panels.tsx";
import { Picker, pickerKey, pickerOpen, pickerTitle, pickerTouch } from "./picker.tsx";

export type CardKind = "picker" | "panel" | "menu";

/** The card that is up, the picker over a panel over the menu. */
export const card = (): CardKind | null => (pickerOpen() ? "picker" : openPanel() ? "panel" : menuOpen() ? "menu" : null);

/** A key for the card that is up: a name (Up, Enter, Escape, ...). */
export function cardKey(name: string) {
  switch (card()) {
    case "picker":
      return pickerKey(name);
    case "panel":
      return panelKey(name);
    case "menu":
      return menuKey(name);
  }
}

/** A character typed at the card: the menu filters by it. */
export function cardText(ch: string) {
  if (card() === "menu") menuText(ch);
}

/** A plain gamepad button the card takes beyond the keys: Y forgets a
 *  network or a device in a panel. */
export function cardButton(button: number): boolean {
  if (card() === "panel" && button & BTN.SQUARE) {
    panelKey("Forget");
    return true;
  }
  return false;
}

export const cardSink = (): KeySink => ({ text: cardText, key: cardKey, hint: cardHint });

/** The card's title, for the strip. */
export function cardTitle(): string {
  switch (card()) {
    case "picker":
      return pickerTitle();
    case "panel":
      return panelTitle();
    case "menu":
      return menuTitle();
    default:
      return "";
  }
}

function cardHint(): string {
  switch (card()) {
    case "menu":
      return "type to filter · ↑↓ move · Enter opens · Esc closes";
    case "panel":
      return "↑↓ move · ←→ adjust · Enter acts · Esc closes";
    case "picker":
      return "↑↓ preview · Enter applies · Esc cancels";
    default:
      return "";
  }
}

/** Fingers on the card, in its own coordinates (the touchpad's clicks). */
export function cardTouch(frame: TouchFrame) {
  switch (card()) {
    case "picker":
      return pickerTouch(frame);
    case "panel":
      return panelTouch(frame);
    case "menu":
      return menuTouch(frame);
  }
}

/** Closes whatever card is up. */
export function closeCard() {
  switch (card()) {
    case "picker":
      return pickerKey("Escape");
    case "panel":
      return closePanel();
    case "menu":
      return closeMenu();
  }
}

/** Whether stage point (x, y) is on the card. */
export const onCard = (x: number, y: number) => card() !== null && x >= CARD_X && x < CARD_X + CARD_W && y >= CARD_Y && y < CARD_Y + CARD_H;

export function Card() {
  let frame: NodeMirror | undefined;
  let dim: NodeMirror | undefined;
  const [content, setContent] = createSignal<CardKind | null>(null);
  createEffect(
    on(
      card,
      (kind) => {
        if (kind) setContent(kind);
        glide(dim, "opacity", kind ? 1 : 0, 140);
        glide(frame, "opacity", kind ? 1 : 0, kind ? 150 : 110);
        glide(frame, "translateY", kind ? 0 : 10, 170);
      },
      { defer: true },
    ),
  );
  return (
    <>
      <View class="absolute left-0 top-0 w-[512] h-[384]" style={{ bgColor: color("background", 0.45), opacity: 0 }} ref={(n: NodeMirror) => (dim = n)} />
      <View
        class="absolute overflow-hidden rounded-md"
        style={{ insetL: CARD_X - 2, insetT: CARD_Y - 2, width: CARD_W + 4, height: CARD_H + 4, bgColor: color("accent"), opacity: 0, translateY: 10 }}
        ref={(n: NodeMirror) => (frame = n)}
      >
        <View class="absolute left-[2] top-[2] overflow-hidden rounded-sm" style={{ width: CARD_W, height: CARD_H, bgColor: color("darker_background") }}>
          {/* the menu stays laid out (its levels slide); the others mount when asked for */}
          <View class={C.card} style={{ opacity: content() === "menu" ? 1 : 0 }}>
            <MenuCard />
          </View>
          <Show when={content() === "panel"}>
            <Panels />
          </Show>
          <Show when={content() === "picker"}>
            <Picker />
          </Show>
        </View>
      </View>
    </>
  );
}
