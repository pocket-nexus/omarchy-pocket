// The shell's end of the Omarchy bridge (daemon/protocol.ts). The host program
// installs globalThis.omarchyBridge.send(line) and, at the start of a tick,
// calls globalThis.__omarchyBridgeReceive(lines) with what omarchy-pocketd
// sent and the host's own events (package windows). Without a host bridge
// (the desktop simulator) requests reject.
import type { DaemonMessage, Event, RequestBody, RunResult, SystemState } from "../../daemon/protocol.ts";

export type { Event, RunResult, SystemState };

interface HostBridge {
  send(line: string): void;
}

const host = (globalThis as { omarchyBridge?: HostBridge }).omarchyBridge;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const listeners = new Set<(event: Event) => void>();
let nextId = 1;

export const connected = host !== undefined;

export function request<T = unknown>(body: RequestBody): Promise<T> {
  if (!host) return Promise.reject(new Error("no Omarchy bridge in this host"));
  const id = nextId++;
  host.send(JSON.stringify({ ...body, id }));
  return new Promise<T>((resolve, reject) => pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
}

export function onEvent(listener: (event: Event) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const run = (command: string) => request<RunResult>({ method: "run", command });
export const conditions = (commands: string[]) => request<boolean[]>({ method: "conditions", commands });

/** Answers an omarchy-shell call; unhandled calls make the CLI report the target missing. */
export function answer(call: number, handled: boolean, output = "") {
  void request({ method: "answer", call, handled, output });
}

(globalThis as { __omarchyBridgeReceive?: (lines: string[]) => void }).__omarchyBridgeReceive = (lines) => {
  for (const line of lines) {
    let message: DaemonMessage;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    // an event first: the host's app events carry an `id` of their own
    if ("event" in message) {
      for (const listener of listeners) listener(message);
    } else if ("id" in message) {
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error));
    }
  }
};
