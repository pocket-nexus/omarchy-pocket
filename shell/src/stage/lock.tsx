// The lock screen `omarchy-system-lock` asks for (`omarchy-shell lock lock`):
// the clock over the dimmed wallpaper on the stage, and on the deck a meter
// that fills while A is held. Holding A for a second unlocks; password entry
// waits for the on-screen keyboard.
import { createSignal, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { C } from "../classes.ts";
import { serve } from "../system.ts";
import { color } from "../theme.ts";

const HOLD_TICKS = 60;
const [locked, setLocked] = createSignal(false);
const [held, setHeld] = createSignal(0);

export { locked };

serve("lock", {
  lock: () => (setLocked(true), setHeld(0), "locked"),
  isLocked: () => String(locked()),
  status: () => (locked() ? "locked" : "unlocked"),
});

/** Takes the buttons while locked; true when it consumed them. */
export function lockFrame(buttons: number): boolean {
  if (!locked()) return false;
  if (buttons & BTN.CIRCLE) {
    setHeld((n) => n + 1);
    if (held() >= HOLD_TICKS) {
      setLocked(false);
      setHeld(0);
    }
  } else if (held()) setHeld(0);
  return true;
}

/** The stage half: the clock over the dimmed wallpaper. */
export function LockStage(props: { clock: () => string; date: () => string }) {
  return (
    <Show when={locked()}>
      <View class={C.cover} style={{ bgColor: color("background", 0.85) }}>
        <Text class={C.lockClock} style={{ textColor: color("bright_foreground") }}>{props.clock()}</Text>
        <Text class={C.lockDate} style={{ textColor: color("foreground") }}>{props.date()}</Text>
      </View>
    </Show>
  );
}

/** The deck half, drawn over the menu: the unlock meter. */
export function LockDeck() {
  return (
    <Show when={locked()}>
      <View class={C.cover} style={{ bgColor: color("darker_background") }}>
        <Text class={C.lockIcon} style={{ textColor: color("accent") }}>{"\u{f033e}"}</Text>
        <Text class={C.lockHint} style={{ textColor: color("foreground") }}>Hold A to unlock</Text>
        <View class={C.lockMeter} style={{ width: Math.round((160 * held()) / HOLD_TICKS), bgColor: color("accent") }} />
      </View>
    </Show>
  );
}
