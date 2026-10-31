// The lock screen `omarchy-system-lock` asks for (`omarchy-shell lock lock`),
// and the one the shell puts up before logind suspends: the clock over the
// dimmed wallpaper on the stage, the touch keyboard on the deck with a
// password field. omarchy-pocketd checks the password (unix_chkpwd); the
// gamepad's A is Enter, B Backspace and START clears the field.
import { createSignal, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { onEvent, request } from "../bridge.ts";
import { C } from "../classes.ts";
import { setFieldSink } from "../keys.ts";
import { serve } from "../system.ts";
import { color } from "../theme.ts";

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
    hint: () => "A Enter · B Backspace · START clears",
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
      <View class={C.cover} style={{ bgColor: color("background", 0.85) }}>
        <Text class={C.lockIcon} style={{ textColor: color("accent") }}>{LOCK}</Text>
        <Text class={C.lockClock} style={{ textColor: color("bright_foreground") }}>{props.clock()}</Text>
        <Text class={C.lockDate} style={{ textColor: color("foreground") }}>{props.date()}</Text>
      </View>
    </Show>
  );
}
