// The lock screen `omarchy-system-lock` asks for (`omarchy-shell lock lock`),
// and the one the shell puts up before logind suspends: the clock over the
// dimmed wallpaper on the stage, the touch keyboard on the deck with a
// password field (on the uConsole the field is on the stage, stage/field.tsx,
// and its own keyboard types it). omarchy-pocketd checks the password (unix_chkpwd); the
// gamepad's A is Enter, B Backspace and START clears the field.
import { createSignal, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { onEvent, request } from "../bridge.ts";
import { C } from "../classes.ts";
import { setFieldSink } from "../keys.ts";
import { serve } from "../system.ts";
import { color } from "../theme.ts";
import { STAGE_H, STAGE_W, UCONSOLE } from "../screen.ts";

/** the clock's block sits on the stage's middle (192 on the RG DS Plus) */
const MIDDLE = Math.round(STAGE_H / 2);

const LOCK = "\u{f033e}";
const [locked, setLocked] = createSignal(false);
const [password, setPassword] = createSignal("");
const [status, setStatus] = createSignal("");

export { locked };

function verify() {
  const attempt = password();
  setPassword("");
  setStatus("Checking...");
  request<boolean>({ method: "checkPassword", password: attempt }).then(
    (ok) => {
      if (!ok) return setStatus("Wrong password");
      setLocked(false);
      setStatus("");
      setFieldSink(null);
    },
    (error) => setStatus(String(error)),
  );
}

export function lock() {
  if (locked()) return;
  setLocked(true);
  setPassword("");
  setStatus("");
  setFieldSink({
    text: (ch) => setPassword((p) => p + ch),
    key: (name) => {
      if (name === "Enter") verify();
      else if (name === "Backspace") setPassword((p) => [...p].slice(0, -1).join(""));
      else if (name === "Escape") setPassword("");
    },
    field: () => `${LOCK} ${status() || "Password"}: ${"•".repeat([...password()].length)}_`,
    hint: () => (UCONSOLE ? "type your password · Enter unlocks · Esc clears" : "A Enter · B Backspace · START clears"),
  });
}

serve("lock", {
  lock: () => (lock(), "locked"),
  isLocked: () => String(locked()),
  status: () => (locked() ? "locked" : "unlocked"),
});

onEvent((event) => {
  if (event.event === "sleep") lock();
});

/** The stage half: the clock over the dimmed wallpaper. */
export function LockStage(props: { clock: () => string; date: () => string }) {
  return (
    <Show when={locked()}>
      <View class={C.cover} style={{ width: STAGE_W, height: STAGE_H, bgColor: color("background", 0.85) }}>
        <Text class={C.lockIcon} style={{ width: STAGE_W, insetT: MIDDLE - 74, textColor: color("accent") }}>{LOCK}</Text>
        <Text class={C.lockClock} style={{ width: STAGE_W, insetT: MIDDLE - 32, textColor: color("bright_foreground") }}>{props.clock()}</Text>
        <Text class={C.lockDate} style={{ width: STAGE_W, insetT: MIDDLE + 10, textColor: color("foreground") }}>{props.date()}</Text>
      </View>
    </Show>
  );
}
