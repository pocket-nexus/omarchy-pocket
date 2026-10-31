// The shell's replica of omarchy-pocketd's terminals: per session, one signal
// per grid row (Pocket Term runs) and the cursor. Rows arrive as `termRows`
// events. Each session is a window on the stage (workspaces.ts); a session
// some program started (`termOpened`) opens beside the focused window, and a
// session that ends closes its window.
import { createSignal, type Accessor, type Setter } from "solid-js";
import { onEvent, request } from "../bridge.ts";
import { TERM_ROWS, type Cursor, type Run } from "../../../daemon/protocol.ts";
import type { KeySink } from "../keys.ts";
import { closeWindow, find, focused, focusWindow, open } from "../workspaces.ts";
import { watching } from "../watch.ts";

/** sessions whose first rows are still to come, logged while a watch is on */
const awaitingRows = new Set<number>();

export interface TermSession {
  sid: number;
  title: Accessor<string>;
  setTitle: Setter<string>;
  rows: Accessor<Run[]>[];
  setRows: Setter<Run[]>[];
  cursor: Accessor<Cursor>;
  setCursor: Setter<Cursor>;
}

const [sessions, setSessions] = createSignal<TermSession[]>([]);

export { sessions };

/** The session in the focused window, when that window is a terminal. */
export const active = (): number | null => {
  const w = focused();
  return w?.kind === "terminal" ? w.sid : null;
};

function session(sid: number, title: string): TermSession {
  const existing = sessions().find((s) => s.sid === sid);
  if (existing) return existing;
  const [t, setTitle] = createSignal(title);
  const rows: Accessor<Run[]>[] = [];
  const setRows: Setter<Run[]>[] = [];
  for (let y = 0; y < TERM_ROWS; y++) {
    const [row, setRow] = createSignal<Run[]>([]);
    rows.push(row);
    setRows.push(setRow);
  }
  const [cursor, setCursor] = createSignal<Cursor>([0, 0, 1]);
  const created = { sid, title: t, setTitle, rows, setRows, cursor, setCursor };
  setSessions((list) => [...list, created]);
  return created;
}

export const activeSession = () => sessions().find((s) => s.sid === active()) ?? null;

/** Where keys go while a terminal has focus: characters to the PTY as text,
 *  named keys and modified characters as key names, which omarchy-pocketd
 *  encodes against the terminal's modes. */
export const terminalSink: KeySink = {
  text: (text) => {
    const sid = active();
    if (sid !== null) void request({ method: "termInput", sid, text });
  },
  key: (key, m) => {
    const sid = active();
    if (sid !== null) void request({ method: "termKey", sid, key, ctrl: m.ctrl, alt: m.alt, shift: m.shift });
  },
  close: () => {
    const sid = active();
    if (sid !== null) closeTerminal(sid);
  },
  hint: () => "A Enter · B Backspace · X Tab · Y Space · START Esc",
};

const isSession = (sid: number) => (w: { kind: string; sid?: number }) => w.kind === "terminal" && w.sid === sid;

/** A session's window: focused when it exists, opened when it does not. */
function windowFor(sid: number) {
  const existing = find(isSession(sid));
  if (existing) focusWindow(existing.id);
  else open({ kind: "terminal", sid });
}

export const sessionById = (sid: number) => sessions().find((s) => s.sid === sid) ?? null;

/** Opens a login shell in a new window. */
/** A new session in a window: a shell, or `argv` titled `title`. */
export function openTerminal(argv?: string[], title = "bash") {
  if (watching()) console.log(`term open asked: ${title}`);
  request<number>({ method: "termOpen", ...(argv ? { argv, title } : {}) }).then((sid) => {
    if (watching()) {
      console.log(`term ${sid} opened`);
      awaitingRows.add(sid);
    }
    session(sid, title);
    windowFor(sid);
  }, () => {});
}

/** Ends the session; its window closes when the daemon reports the exit. */
export function closeTerminal(sid: number) {
  void request({ method: "termClose", sid });
}

/** Sets the session's grid to the window's size (the PTY gets SIGWINCH). */
export function resizeTerminal(sid: number, cols: number, rows: number) {
  void request({ method: "termResize", sid, cols, rows });
}

onEvent((event) => {
  switch (event.event) {
    case "termOpened":
      session(event.sid, event.title);
      windowFor(event.sid);
      break;
    case "termRows": {
      if (awaitingRows.delete(event.sid)) console.log(`term ${event.sid} first rows: ${event.rows.length}`);
      const s = session(event.sid, "");
      for (const [y, runs] of event.rows) s.setRows[y]?.(runs);
      s.setCursor(event.cursor);
      break;
    }
    case "termTitle":
      session(event.sid, event.title).setTitle(event.title);
      break;
    case "termExit": {
      setSessions(sessions().filter((s) => s.sid !== event.sid));
      const existing = find(isSession(event.sid));
      if (existing) closeWindow(existing.id);
      break;
    }
  }
});

/** The daemon's sessions: keeps those it still has (it re-sends their
 *  screens) and closes the windows of the rest, which ended with an earlier
 *  daemon. */
function reconcile() {
  request<{ sid: number; title: string }[]>({ method: "termList" }).then((list) => {
    const live = new Set(list.map((s) => s.sid));
    setSessions(sessions().filter((s) => live.has(s.sid)));
    for (const s of list) {
      session(s.sid, s.title).setTitle(s.title);
      // a session that outlived a shell restart gets its window back
      if (!find(isSession(s.sid))) open({ kind: "terminal", sid: s.sid });
    }
    for (;;) {
      const dead = find((w) => w.kind === "terminal" && !live.has(w.sid));
      if (!dead) break;
      closeWindow(dead.id);
    }
  }, () => {});
}

onEvent((event) => {
  if (event.event === "hello") reconcile();
});
