// Short notices in the stage's top-right corner, where Omarchy shows its
// notifications: a menu action that failed, a feature Omarchy Pocket does not
// have yet. At most three, newest on top.
import { createSignal, For } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { C } from "../classes.ts";
import { color } from "../theme.ts";

export interface Toast {
  id: number;
  icon: string;
  title: string;
  body: string;
  tone: "info" | "error";
}

const LIMIT = 3;
const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

export function toast(notice: Omit<Toast, "id">, seconds = notice.tone === "error" ? 8 : 4) {
  const id = nextId++;
  setToasts((list) => [{ ...notice, id }, ...list].slice(0, LIMIT));
  after(seconds, () => setToasts((list) => list.filter((t) => t.id !== id)));
}

export function Toasts() {
  return (
    <For each={toasts()}>
      {(t, index) => (
        <View
          class={C.toast}
          style={{ insetT: 24 + index() * 58, bgColor: color("background", 0.97), borderColor: color(t.tone === "error" ? "red" : "accent") }}
        >
          <Text class={C.toastIcon} style={{ textColor: color(t.tone === "error" ? "red" : "accent") }}>{t.icon}</Text>
          <Text class={C.toastTitle} style={{ textColor: color("bright_foreground") }}>{t.title}</Text>
          <Text class={C.toastBody} style={{ textColor: color("foreground") }}>{t.body}</Text>
        </View>
      )}
    </For>
  );
}
