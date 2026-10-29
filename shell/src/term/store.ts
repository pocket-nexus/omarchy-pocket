// The shell's replica of omarchy-pocketd's terminals: per session, one signal
// per grid row (Pocket Term runs) and the cursor. Rows arrive as `termRows`
// events; a session some program started (`termOpened`) becomes the active
// one and brings the terminal up on the stage.
import { createSignal, type Accessor, type Setter } from "solid-js";
import { onEvent, request } from "../bridge.ts";
import { TERM_ROWS, type Cursor, type Run } from "../../../daemon/protocol.ts";

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
const [active, setActive] = createSignal<number | null>(null);
/** True while the terminal has the stage and the deck. */
const [shown, setShown] = createSignal(false);

export { active, sessions, shown };

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

export function show(sid: number) {
  setActive(sid);
  setShown(true);
}

export function hide() {
  setShown(false);
}

/** Opens a login shell, or shows the active session if there is one. */
export function openTerminal() {
  const current = activeSession() ?? sessions()[0];
  if (current) return show(current.sid);
  request<number>({ method: "termOpen" }).then((sid) => {
    session(sid, "bash");
    show(sid);
  }, () => {});
}

/** The next session after the active one, wrapping. */
export function cycle() {
  const list = sessions();
  if (!list.length) return;
  const at = list.findIndex((s) => s.sid === active());
  setActive(list[(at + 1) % list.length]!.sid);
}

onEvent((event) => {
  switch (event.event) {
    case "termOpened":
      session(event.sid, event.title);
      show(event.sid);
      break;
    case "termRows": {
      const s = session(event.sid, "");
      for (const [y, runs] of event.rows) s.setRows[y]?.(runs);
      s.setCursor(event.cursor);
      break;
    }
    case "termTitle":
      session(event.sid, event.title).setTitle(event.title);
      break;
    case "termExit": {
      const rest = sessions().filter((s) => s.sid !== event.sid);
      setSessions(rest);
      if (active() === event.sid) {
        setActive(rest[0]?.sid ?? null);
        if (!rest.length) setShown(false);
      }
      break;
    }
  }
});

/** The daemon's sessions: keeps those it still has (it re-sends their
 *  screens) and drops the rest, which ended with an earlier daemon. */
function reconcile() {
  request<{ sid: number; title: string }[]>({ method: "termList" }).then((list) => {
    const live = new Set(list.map((s) => s.sid));
    const rest = sessions().filter((s) => live.has(s.sid));
    setSessions(rest);
    for (const s of list) session(s.sid, s.title).setTitle(s.title);
    if (active() !== null && !live.has(active()!)) {
      setActive(rest[0]?.sid ?? null);
      if (!rest.length) setShown(false);
    }
  }, () => {});
}

onEvent((event) => {
  if (event.event === "hello") reconcile();
});
