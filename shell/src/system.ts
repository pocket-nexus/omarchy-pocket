// The system as omarchy-pocketd reports it (battery, network, audio,
// Bluetooth, power profile, theme), and Omarchy's IPC targets: `omarchy-shell
// <target> <method> [args...]` reaches the function a module registered with
// serve(), the way a Quickshell plugin declares a ShellIpc target.
import { createSignal } from "solid-js";
import { answer, onEvent, request, type SystemState } from "./bridge.ts";

const [state, setState] = createSignal<SystemState | null>(null);
export { state };

export type Method = (...args: string[]) => string | void;
const targets = new Map<string, Record<string, Method>>();

/** Answers `omarchy-shell <target> <method> ...`; a method's return value is
 * what the CLI prints. */
export function serve(target: string, methods: Record<string, Method>) {
  targets.set(target, { ...targets.get(target), ...methods });
}

onEvent((event) => {
  if (event.event === "state") {
    setState(event.state);
    return;
  }
  if (event.event !== "shell") return;
  const method = targets.get(event.target)?.[event.method];
  if (!method) return answer(event.call, false);
  let output: string | void;
  try {
    output = method(...event.args);
  } catch (error) {
    console.log(`omarchy-shell ${event.target} ${event.method}: ${error}`);
    return answer(event.call, false);
  }
  answer(event.call, true, output ?? "");
});

request<SystemState>({ method: "state" }).then(setState, () => {});
