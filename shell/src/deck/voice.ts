// Voice input from the deck's round microphone button: one press opens the
// microphone, the next closes it, and what was said types into what has the keys
// (focus.ts), as a keyboard would. The words come from omarchy-pocketd (daemon/
// voice.ts), recognized on the device with no network.
import { createSignal } from "solid-js";
import { onEvent, request } from "../bridge.ts";
import { keySink } from "../focus.ts";
import { NO_SINK } from "../keys.ts";
import { toast } from "../stage/toasts.tsx";

export type VoiceState = "idle" | "listening" | "decoding";
const [state, setState] = createSignal<VoiceState>("idle");
const [level, setLevel] = createSignal(0);
export const voiceState = state;
export const voiceLevel = level;

const MIC = "\u{f036c}";
const say = (title: string, body = "") => toast({ icon: MIC, title, body, tone: "info" }, 2.4);

function deliver(text: string) {
  if (!text) return say("Nothing heard");
  const sink = keySink();
  // a touch app with no field open has nowhere to type: show the words instead
  if (sink === NO_SINK) return say("Nothing takes text here", text);
  sink.text(text);
}

const failed = (error: unknown) => {
  setState("idle");
  toast({ icon: MIC, title: "Voice input", body: error instanceof Error ? error.message : String(error), tone: "error" }, 3);
};

export function toggleVoice() {
  const now = state();
  if (now === "decoding") return;
  if (now === "listening") {
    setState("decoding");
    return void request<string>({ method: "voiceStop" }).then(deliver, failed);
  }
  setState("listening");
  void request({ method: "voiceStart" }).catch(failed);
}

onEvent((event) => {
  if (event.event === "voice") {
    setState(event.state);
    setLevel(event.level);
  } else if (event.event === "voiceText") deliver(event.text);
});
