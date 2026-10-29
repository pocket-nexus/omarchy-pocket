// Notices in the stage's top-right corner, where Omarchy shows its
// notifications: desktop notifications from omarchy-pocketd's
// org.freedesktop.Notifications server, and the shell's own notices (a menu
// action that failed, a panel Omarchy Pocket does not have). At most three,
// newest on top. In the menu, Y runs the newest notification's command and X
// dismisses it.
import { createSignal, For, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { onEvent, request } from "../bridge.ts";
import { C } from "../classes.ts";
import { color } from "../theme.ts";

export interface Toast {
  /** a notification's id, or a negative id for the shell's own notices */
  id: number;
  icon: string;
  title: string;
  body: string;
  tone: "info" | "error";
  /** a notification whose command or first action Y runs */
  actionable?: boolean;
}

const LIMIT = 3;
const BELL = "\u{f009a}";
const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextLocal = -1;

function put(toast: Toast) {
  setToasts((list) => [toast, ...list.filter((t) => t.id !== toast.id)]);
}

function drop(id: number) {
  setToasts((list) => list.filter((t) => t.id !== id));
}

/** One of the shell's own notices. */
export function toast(notice: Omit<Toast, "id">, seconds = notice.tone === "error" ? 8 : 4) {
  const id = nextLocal--;
  put({ ...notice, id });
  after(seconds, () => drop(id));
}

/** Y: run the newest notification's command; X: dismiss it. */
export function actOnNewest(run: boolean) {
  const newest = toasts()[0];
  if (!newest) return false;
  if (newest.id < 0) drop(newest.id);
  else if (run && newest.actionable) void request({ method: "notifyInvoke", notice: newest.id, action: -1 });
  else void request({ method: "notifyDismiss", notice: newest.id });
  return true;
}

onEvent((event) => {
  if (event.event === "notify") {
    const n = event.notice;
    put({
      id: n.id,
      icon: n.glyph || BELL,
      title: n.summary,
      body: n.body.split("\n")[0] ?? "",
      tone: n.urgency === 2 ? "error" : "info",
      actionable: true,
    });
  } else if (event.event === "notifyClosed") drop(event.notice);
});

export function Toasts() {
  return (
    <For each={toasts().slice(0, LIMIT)}>
      {(t, index) => (
        <View
          class={C.toast}
          style={{ insetT: 24 + index() * 58, bgColor: color("background", 0.97), borderColor: color(t.tone === "error" ? "red" : "accent") }}
        >
          <Text class={C.toastIcon} style={{ textColor: color(t.tone === "error" ? "red" : "accent") }}>{t.icon}</Text>
          <Text class={C.toastTitle} style={{ textColor: color("bright_foreground") }}>{t.title}</Text>
          <Text class={C.toastBody} style={{ textColor: color("foreground") }}>{t.body}</Text>
          <Show when={index() === 0 && t.actionable}>
            <Text class={C.toastKeys} style={{ textColor: color("dark_foreground") }}>Y open  X close</Text>
          </Show>
        </View>
      )}
    </For>
  );
}
