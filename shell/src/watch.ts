// Whether a watch is on (`omarchy-shell pocket.input watch <frames>`): the
// deck logs its contacts and its keys lighting, and a terminal logs its
// opening, to the host's stderr (the journal). A module of its own with no
// imports, so the terminal store reads it without a cycle through the IPC
// module, the keyboard and itself.
let frames = 0;

export const watching = () => frames > 0;

export function watchFor(n: number) {
  frames = n;
}

/** One frame of the watch passes; whether it is still on. */
export function watchTick(): boolean {
  if (frames <= 0) return false;
  frames--;
  return true;
}
