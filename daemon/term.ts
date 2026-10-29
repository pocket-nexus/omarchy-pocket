// Terminals for the shell. Each session is a PTY (Bun.Terminal) and Pocket
// Term's terminal authority: libghostty's VT core (@wterm/ghostty) parses
// what the program writes, and Pocket Term's grid code (vendor/pocket-term,
// host/grid.ts) turns each screen row into runs of same-coloured text. The
// shell holds a replica: the rows that changed, at most once per FLUSH_MS,
// and a full snapshot when it asks (after it reconnects). Keys arrive as names and are encoded
// here (host/keys.ts), beside the terminal modes that decide the bytes.
import { GhosttyCore } from "@wterm/ghostty";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCell, rowKey, rowRuns, type Cell } from "../vendor/pocket-term/host/grid.ts";
import { encodeKey } from "../vendor/pocket-term/host/keys.ts";
import { CJK_SLOT_12, needsRuntimeGlyph, TERM_COLS, TERM_ROWS, type Cursor, type TermRow } from "./protocol.ts";

const SCROLLBACK = 2000;
const FLUSH_MS = 16;
const BACKLOG_LIMIT = 1024 * 1024;

/** The VT core loads its WASM through fetch, so it gets the module as a data
 *  URL: read once, beside the bundled daemon (tools/build.ts copies it) or
 *  from node_modules when the daemon runs from source. */
let wasmUrl: string | null = null;
function ghosttyWasm(): string {
  if (wasmUrl) return wasmUrl;
  const beside = join(import.meta.dir, "ghostty-vt.wasm");
  let bytes: Buffer;
  try {
    bytes = readFileSync(beside);
  } catch {
    bytes = readFileSync(join(import.meta.dir, "node_modules", "@wterm", "ghostty", "wasm", "ghostty-vt.wasm"));
  }
  wasmUrl = `data:application/wasm;base64,${bytes.toString("base64")}`;
  return wasmUrl;
}

export interface TermEvents {
  /** characters a row draws from the run-time CJK atlas */
  want(text: string): void;
  rows(sid: number, rows: TermRow[], cursor: Cursor, full: boolean): void;
  title(sid: number, title: string): void;
  exit(sid: number, code: number | null): void;
}

export interface OpenOptions {
  argv: string[];
  title?: string;
  cwd?: string;
  env?: Record<string, string>;
}

/** A row's cells. A character the package has no glyph for (CJK, Cyrillic,
 *  ...) is drawn from the run-time atlas in slot 21; a wide one spans two
 *  cells and its continuation cell stays empty. */
function cellsOf(core: GhosttyCore, y: number, want: (text: string) => void): Cell[] {
  const cells: Cell[] = [];
  for (let x = 0; x < TERM_COLS; x++) {
    const cell = resolveCell(core.getCell(y, x));
    const cp = cell.ch.codePointAt(0);
    if (cell.width === 2 || (cp !== undefined && needsRuntimeGlyph(cp))) {
      cell.slot = CJK_SLOT_12;
      want(cell.ch);
    }
    cells.push(cell);
  }
  return cells;
}

class Session {
  readonly sid: number;
  title: string;
  core: GhosttyCore | null = null;
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly decoder = new TextDecoder();
  private backlog: string[] = [];
  private sent: string[] = [];
  private cursorKey = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = 0;
  closed = false;

  constructor(sid: number, options: OpenOptions, private readonly events: TermEvents) {
    this.sid = sid;
    this.title = options.title || options.argv[0]!.split("/").pop()!;
    this.proc = Bun.spawn(options.argv, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: TERM_COLS,
        rows: TERM_ROWS,
        data: (_, data) => this.parse(this.decoder.decode(data, { stream: true })),
      },
    });
    void this.proc.exited.then((code) => this.close(code));
    void GhosttyCore.load({ wasmPath: ghosttyWasm(), scrollbackLimit: SCROLLBACK }).then(
      (core) => {
        if (this.closed) return;
        core.init(TERM_COLS, TERM_ROWS);
        this.core = core;
        const waiting = this.backlog;
        this.backlog = [];
        for (const chunk of waiting) this.parse(chunk);
        this.schedule();
      },
      (error) => {
        console.error(`omarchy-pocketd: terminal #${sid}: VT core failed to load: ${error}`);
        this.kill();
      },
    );
  }

  private parse(data: string) {
    if (this.closed || !data) return;
    const core = this.core;
    if (!core) {
      if (this.backlog.reduce((n, s) => n + s.length, 0) + data.length > BACKLOG_LIMIT) return this.kill();
      this.backlog.push(data);
      return;
    }
    core.writeString(data);
    // the core composes replies to the program's queries (DA, DSR, colours)
    for (let guard = 0; guard < 16; guard++) {
      const response = core.getResponse();
      if (!response) break;
      this.proc.terminal?.write(response);
    }
    const explicit = core.getTitle()?.trim();
    if (explicit && explicit !== this.title) {
      this.title = explicit.slice(0, 48);
      this.events.title(this.sid, this.title);
    }
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    const wait = Math.max(0, this.lastFlush + FLUSH_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(false);
    }, wait);
  }

  /** Sends the rows that changed since the last flush (all of them when full). */
  flush(full: boolean) {
    const core = this.core;
    if (!core || this.closed) return;
    this.lastFlush = Date.now();
    if (full) this.sent = [];
    const rows: TermRow[] = [];
    for (let y = 0; y < TERM_ROWS; y++) {
      const runs = rowRuns(cellsOf(core, y, this.events.want));
      const key = rowKey(runs);
      if (this.sent[y] !== key) {
        this.sent[y] = key;
        rows.push([y, runs]);
      }
    }
    const c = core.getCursor();
    const cursor: Cursor = [c.col, c.row, c.visible ? 1 : 0];
    const cursorKey = cursor.join(",");
    if (!rows.length && cursorKey === this.cursorKey && !full) return;
    this.cursorKey = cursorKey;
    this.events.rows(this.sid, rows, cursor, full);
  }

  /** A full snapshot, for a shell that (re)connected. */
  attach() {
    this.flush(true);
  }

  input(text: string) {
    if (text) this.proc.terminal?.write(text);
  }

  key(name: string, ctrl: boolean, alt: boolean, shift: boolean) {
    this.input(encodeKey(name, ctrl, alt, this.core?.cursorKeysApp() ?? false, shift));
  }

  paste(text: string) {
    if (this.core?.bracketedPaste()) this.input(`\x1b[200~${text}\x1b[201~`);
    else this.input(text);
  }

  kill() {
    try {
      this.proc.kill("SIGHUP");
    } catch {}
  }

  private close(code: number | null) {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.proc.terminal?.close();
    this.core = null;
    this.events.exit(this.sid, code);
  }
}

export class Terminals {
  private readonly sessions = new Map<number, Session>();
  private nextSid = 1;

  constructor(private readonly events: TermEvents) {}

  open(options: OpenOptions): number {
    const sid = this.nextSid++;
    const session = new Session(sid, options, {
      ...this.events,
      exit: (id, code) => {
        this.sessions.delete(id);
        this.events.exit(id, code);
      },
    });
    this.sessions.set(sid, session);
    return sid;
  }

  get(sid: number): Session {
    const session = this.sessions.get(sid);
    if (!session) throw new Error(`no terminal ${sid}`);
    return session;
  }

  list(): { sid: number; title: string }[] {
    return [...this.sessions.values()].map((s) => ({ sid: s.sid, title: s.title }));
  }
}
