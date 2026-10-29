// The stage's window manager as plain state and geometry, with no Solid in
// it: workspaces.ts wraps it in signals and motion. Two layouts per
// workspace, the way Omarchy configures Hyprland:
//
//   dwindle    a binary split tree. A new window splits the focused one along
//              its longer side and takes the right or bottom half
//              (`force_split = 2`); a split keeps its direction when a window
//              closes (`preserve_split`).
//   scrolling  columns on a horizontal strip wider than the panel. A new
//              window opens as a column after the focused one at 0.49 of the
//              workspace width, so two fit (Omarchy's `column_width`); the
//              strip scrolls to keep the focused column whole, and a column
//              can hold a stack.
//
// The gaps and border are Omarchy's (gaps_out, gaps_in, border_size) at the
// panel's scale: the bar's height off one edge, GAP_OUT around the tiled
// area, every window inset GAP_IN, so neighbours sit 2 * GAP_IN apart.

export const STAGE_W = 512;
export const STAGE_H = 384;
export const BAR_H = 18;
export const GAP_OUT = 6;
export const GAP_IN = 3;
export const BORDER = 2;
export const WORKSPACES = 5;
export const COLUMN_WIDTHS: readonly number[] = [0.33, 0.49, 0.66, 1];
const DEFAULT_COLUMN = 0.49;
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const RESIZE_STEP = 0.05;
const MIN_COLUMN = 0.2;
const PAN_STEP = 64;
const REOPEN_DEPTH = 8;

export type Dir = "left" | "right" | "up" | "down";
export type Layout = "dwindle" | "scrolling";
export type Content =
  | { kind: "terminal"; sid: number }
  | { kind: "applet"; applet: string }
  /** a PocketJS package running beside the shell (host/src/children.rs) */
  | { kind: "app"; app: number; path: string; title: string; aux: boolean; appletSurface: boolean };
export type Win = Content & { id: number; ws: number };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Leaf = { kind: "leaf"; win: number };
type Split = { kind: "split"; axis: "x" | "y"; ratio: number; a: Node; b: Node };
type Node = Leaf | Split;
interface Column {
  wins: number[];
  /** a fraction of the workspace width */
  width: number;
}

interface Workspace {
  layout: Layout;
  root: Node | null;
  columns: Column[];
  /** scrolling: strip points hidden left of the area */
  scroll: number;
  focus: number | null;
  /** the window that covers the workspace: "full" the whole panel, "max" the tiled area */
  fullscreen: { win: number; mode: "full" | "max" } | null;
}

export interface Placement {
  id: number;
  rect: Rect;
  /** under a fullscreen window */
  hidden: boolean;
}

/** A split boundary under a finger (dwindle), and the cell it divides. */
export interface SplitHandle {
  split: Split;
  cell: Rect;
}

export const contains = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (v: number) => ((v % WORKSPACES) + WORKSPACES) % WORKSPACES;

function leaves(node: Node | null, out: number[] = []): number[] {
  if (!node) return out;
  if (node.kind === "leaf") out.push(node.win);
  else {
    leaves(node.a, out);
    leaves(node.b, out);
  }
  return out;
}

/** The chain of splits from the root down to the leaf holding `win`, with the side taken at each. */
function path(node: Node | null, win: number, chain: { split: Split; side: "a" | "b" }[] = []): typeof chain | null {
  if (!node) return null;
  if (node.kind === "leaf") return node.win === win ? chain : null;
  for (const side of ["a", "b"] as const) {
    chain.push({ split: node, side });
    if (path(node[side], win, chain)) return chain;
    chain.pop();
  }
  return null;
}

function halves(split: Split, rect: Rect): [Rect, Rect] {
  if (split.axis === "x") {
    const w = Math.round(rect.w * split.ratio);
    return [{ ...rect, w }, { ...rect, x: rect.x + w, w: rect.w - w }];
  }
  const h = Math.round(rect.h * split.ratio);
  return [{ ...rect, h }, { ...rect, y: rect.y + h, h: rect.h - h }];
}

function place(node: Node, rect: Rect, out: Map<number, Rect>) {
  if (node.kind === "leaf") return void out.set(node.win, rect);
  const [a, b] = halves(node, rect);
  place(node.a, a, out);
  place(node.b, b, out);
}

export class WindowManager {
  readonly windows = new Map<number, Win>();
  private readonly spaces: Workspace[] = Array.from({ length: WORKSPACES }, () => ({
    layout: "dwindle" as Layout,
    root: null,
    columns: [],
    scroll: 0,
    focus: null,
    fullscreen: null,
  }));
  active = 0;
  /** where Omarchy's bar sits (shell.json), which the tiled area leaves free */
  bar: "top" | "bottom" | "none" = "top";
  /** what closed most recently, newest last */
  readonly closed: Content[] = [];
  private nextId = 1;

  /** The tiled area: clear of the bar, inside GAP_OUT. */
  area(): Rect {
    const top = this.bar === "top" ? BAR_H : 0;
    const bottom = this.bar === "bottom" ? BAR_H : 0;
    return { x: GAP_OUT, y: top + GAP_OUT, w: STAGE_W - 2 * GAP_OUT, h: STAGE_H - top - bottom - 2 * GAP_OUT };
  }

  layout(ws = this.active): Layout {
    return this.spaces[ws]!.layout;
  }

  focused(ws = this.active): Win | null {
    const id = this.spaces[ws]!.focus;
    return id === null ? null : (this.windows.get(id) ?? null);
  }

  /** Window ids of a workspace in layout order. */
  order(ws = this.active): number[] {
    const space = this.spaces[ws]!;
    return space.layout === "dwindle" ? leaves(space.root) : space.columns.flatMap((c) => c.wins);
  }

  occupied(ws: number): boolean {
    return this.order(ws).length > 0;
  }

  private cells(ws: number): Map<number, Rect> {
    const space = this.spaces[ws]!;
    const area = this.area();
    const out = new Map<number, Rect>();
    if (space.layout === "dwindle") {
      if (space.root) place(space.root, area, out);
      return out;
    }
    let x = area.x - space.scroll;
    for (const column of space.columns) {
      const w = Math.round(area.w * column.width);
      const h = area.h / column.wins.length;
      column.wins.forEach((id, i) => out.set(id, { x, y: Math.round(area.y + i * h), w, h: Math.round(h) }));
      x += w;
    }
    return out;
  }

  placements(ws = this.active): Placement[] {
    const space = this.spaces[ws]!;
    const out: Placement[] = [];
    for (const [id, cell] of this.cells(ws)) {
      out.push({ id, rect: { x: cell.x + GAP_IN, y: cell.y + GAP_IN, w: cell.w - 2 * GAP_IN, h: cell.h - 2 * GAP_IN }, hidden: false });
    }
    const full = space.fullscreen;
    if (full && this.windows.has(full.win)) {
      const area = this.area();
      for (const p of out) {
        if (p.id !== full.win) p.hidden = true;
        else p.rect = full.mode === "full" ? { x: 0, y: 0, w: STAGE_W, h: STAGE_H } : { ...area };
      }
    }
    return out;
  }

  windowAt(x: number, y: number, ws = this.active): number | null {
    return this.placements(ws).find((p) => !p.hidden && contains(p.rect, x, y))?.id ?? null;
  }

  find(match: (w: Win) => boolean): Win | null {
    for (const w of this.windows.values()) if (match(w)) return w;
    return null;
  }

  // ---- windows ---------------------------------------------------------------

  /** Opens `content` on workspace `ws` beside the focused window. */
  open(content: Content, ws = this.active): number {
    const id = this.nextId++;
    this.windows.set(id, { ...content, id, ws });
    this.insert(ws, id);
    return id;
  }

  private insert(ws: number, id: number) {
    const space = this.spaces[ws]!;
    space.fullscreen = null;
    const target = space.focus ?? this.order(ws).at(-1) ?? null;
    if (space.layout === "scrolling") {
      const at = target === null ? -1 : space.columns.findIndex((c) => c.wins.includes(target));
      space.columns.splice(at + 1, 0, { wins: [id], width: DEFAULT_COLUMN });
    } else if (!space.root || target === null) {
      space.root = { kind: "leaf", win: id };
    } else {
      const cell = this.cells(ws).get(target)!;
      const chain = path(space.root, target)!;
      const split: Split = { kind: "split", axis: cell.w >= cell.h ? "x" : "y", ratio: 0.5, a: { kind: "leaf", win: target }, b: { kind: "leaf", win: id } };
      const parent = chain.at(-1);
      if (parent) parent.split[parent.side] = split;
      else space.root = split;
    }
    space.focus = id;
    this.reveal(ws);
  }

  /** Takes the window out of its workspace; its neighbour takes the space and the focus. */
  private remove(id: number) {
    const win = this.windows.get(id);
    if (!win) return;
    const space = this.spaces[win.ws]!;
    let next: number | null = null;
    if (space.layout === "scrolling") {
      const ci = space.columns.findIndex((c) => c.wins.includes(id));
      if (ci < 0) return;
      const column = space.columns[ci]!;
      const row = column.wins.indexOf(id);
      column.wins.splice(row, 1);
      if (!column.wins.length) space.columns.splice(ci, 1);
      const near = space.columns[Math.min(ci, space.columns.length - 1)];
      next = column.wins[Math.min(row, column.wins.length - 1)] ?? near?.wins[0] ?? null;
    } else {
      const chain = path(space.root, id);
      if (!chain) return;
      const parent = chain.at(-1);
      if (!parent) space.root = null;
      else {
        const sibling = parent.split[parent.side === "a" ? "b" : "a"];
        const grand = chain.at(-2);
        if (grand) grand.split[grand.side] = sibling;
        else space.root = sibling;
        next = leaves(sibling)[0] ?? null;
      }
    }
    if (space.fullscreen?.win === id) space.fullscreen = null;
    if (space.focus === id) space.focus = next ?? this.order(win.ws)[0] ?? null;
    this.reveal(win.ws);
  }

  close(id: number) {
    const win = this.windows.get(id);
    if (!win) return;
    this.remove(id);
    this.windows.delete(id);
    const { id: _, ws: __, ...content } = win;
    this.closed.push(content as Content);
    if (this.closed.length > REOPEN_DEPTH) this.closed.shift();
  }

  /** Focuses the window, switching to its workspace. */
  focusWin(id: number) {
    const win = this.windows.get(id);
    if (!win) return;
    this.active = win.ws;
    this.spaces[win.ws]!.focus = id;
    this.reveal(win.ws);
  }

  /** The nearest window from the focused one in a direction: its rect lies past
   *  the focused one's edge and overlaps it across. */
  neighbor(dir: Dir): number | null {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return null;
    const all = this.placements().filter((p) => !p.hidden || p.id === space.focus);
    const from = all.find((p) => p.id === space.focus)?.rect;
    if (!from) return null;
    let best: { id: number; d: number } | null = null;
    for (const p of all) {
      if (p.id === space.focus) continue;
      const r = p.rect;
      const across = dir === "left" || dir === "right" ? Math.min(r.y + r.h, from.y + from.h) - Math.max(r.y, from.y) : Math.min(r.x + r.w, from.x + from.w) - Math.max(r.x, from.x);
      if (across <= 0) continue;
      const d = dir === "left" ? from.x - (r.x + r.w) : dir === "right" ? r.x - (from.x + from.w) : dir === "up" ? from.y - (r.y + r.h) : r.y - (from.y + from.h);
      if (d < -GAP_IN * 2) continue;
      if (!best || d < best.d) best = { id: p.id, d };
    }
    return best?.id ?? null;
  }

  focusDir(dir: Dir): boolean {
    const next = this.neighbor(dir);
    if (next === null) return false;
    this.spaces[this.active]!.focus = next;
    this.reveal(this.active);
    return true;
  }

  /** Exchanges the focused window with its neighbour in `dir`. */
  swapDir(dir: Dir): boolean {
    const space = this.spaces[this.active]!;
    const other = this.neighbor(dir);
    if (other === null || space.focus === null) return false;
    this.swap(space.focus, other);
    this.reveal(this.active);
    return true;
  }

  swap(a: number, b: number) {
    const wa = this.windows.get(a);
    const wb = this.windows.get(b);
    if (!wa || !wb || wa.ws !== wb.ws || a === b) return;
    const space = this.spaces[wa.ws]!;
    const other = (id: number) => (id === a ? b : id === b ? a : id);
    const swapIn = (node: Node | null): void => {
      if (!node) return;
      if (node.kind === "leaf") node.win = other(node.win);
      else {
        swapIn(node.a);
        swapIn(node.b);
      }
    };
    swapIn(space.root);
    for (const column of space.columns) column.wins = column.wins.map(other);
  }

  private parentOfFocus() {
    const space = this.spaces[this.active]!;
    return space.focus === null ? null : (path(space.root, space.focus)?.at(-1) ?? null);
  }

  private focusedColumn(): Column | null {
    const space = this.spaces[this.active]!;
    return space.columns.find((c) => space.focus !== null && c.wins.includes(space.focus)) ?? null;
  }

  /** Grows (+1) or shrinks (-1) the focused window: the nearest split's ratio,
   *  or the column's width. */
  resize(delta: number): boolean {
    if (this.layout() === "scrolling") {
      const column = this.focusedColumn();
      if (!column) return false;
      column.width = clamp(column.width + delta * RESIZE_STEP, MIN_COLUMN, 1);
      this.reveal(this.active);
      return true;
    }
    const parent = this.parentOfFocus();
    if (!parent) return false;
    const grow = parent.side === "a" ? delta : -delta;
    parent.split.ratio = clamp(parent.split.ratio + grow * RESIZE_STEP, MIN_RATIO, MAX_RATIO);
    return true;
  }

  /** dwindle: side by side becomes stacked, or back (togglesplit);
   *  scrolling: the column's width steps through ⅓ ½ ⅔ 1. */
  toggleSplit(): boolean {
    if (this.layout() === "scrolling") {
      const column = this.focusedColumn();
      if (!column) return false;
      const at = COLUMN_WIDTHS.findIndex((w) => w > column.width + 0.01);
      column.width = COLUMN_WIDTHS[at < 0 ? 0 : at]!;
      this.reveal(this.active);
      return true;
    }
    const parent = this.parentOfFocus();
    if (!parent) return false;
    parent.split.axis = parent.split.axis === "x" ? "y" : "x";
    return true;
  }

  /** dwindle: the split's halves trade places (swapsplit); scrolling: the
   *  focused window stacks into the column on its left, or leaves its stack. */
  swapSplit(): boolean {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return false;
    if (space.layout === "dwindle") {
      const parent = this.parentOfFocus();
      if (!parent) return false;
      [parent.split.a, parent.split.b] = [parent.split.b, parent.split.a];
      return true;
    }
    const ci = space.columns.findIndex((c) => c.wins.includes(space.focus!));
    const column = space.columns[ci]!;
    if (column.wins.length > 1) {
      column.wins.splice(column.wins.indexOf(space.focus), 1);
      space.columns.splice(ci + 1, 0, { wins: [space.focus], width: column.width });
    } else if (ci > 0) {
      space.columns.splice(ci, 1);
      space.columns[ci - 1]!.wins.push(space.focus);
    } else return false;
    this.reveal(this.active);
    return true;
  }

  toggleFullscreen(mode: "full" | "max") {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return;
    space.fullscreen = space.fullscreen?.win === space.focus && space.fullscreen.mode === mode ? null : { win: space.focus, mode };
  }

  fullscreen(ws = this.active) {
    return this.spaces[ws]!.fullscreen;
  }

  /** dwindle → scrolling makes a column per window in tree order; back again
   *  inserts the windows in strip order, each splitting the one before. */
  toggleLayout(ws = this.active): Layout {
    const space = this.spaces[ws]!;
    const order = this.order(ws);
    const focus = space.focus;
    space.fullscreen = null;
    if (space.layout === "dwindle") {
      space.layout = "scrolling";
      space.root = null;
      space.columns = order.map((id) => ({ wins: [id], width: DEFAULT_COLUMN }));
      space.scroll = 0;
    } else {
      space.layout = "dwindle";
      space.columns = [];
      space.root = null;
      space.focus = null;
      for (const id of order) this.insert(ws, id);
    }
    space.focus = focus;
    this.reveal(ws);
    return space.layout;
  }

  /** scrolling: moves the strip by PAN_STEP points. */
  pan(delta: number): boolean {
    return this.panBy(delta * PAN_STEP);
  }

  /** scrolling: moves the strip by `points`, a finger's drag on the map. */
  panBy(points: number): boolean {
    const space = this.spaces[this.active]!;
    if (space.layout !== "scrolling") return false;
    space.scroll = clamp(space.scroll + points, 0, this.maxScroll(this.active));
    return true;
  }

  private maxScroll(ws: number): number {
    const space = this.spaces[ws]!;
    const area = this.area();
    const total = space.columns.reduce((n, c) => n + Math.round(area.w * c.width), 0);
    return Math.max(0, total - area.w);
  }

  /** scrolling: the strip moves so the focused column is whole on the panel. */
  private reveal(ws: number) {
    const space = this.spaces[ws]!;
    if (space.layout !== "scrolling") return;
    const area = this.area();
    let x = 0;
    for (const column of space.columns) {
      const w = Math.round(area.w * column.width);
      if (space.focus !== null && column.wins.includes(space.focus)) {
        if (x + w > space.scroll + area.w) space.scroll = x + w - area.w;
        if (x < space.scroll) space.scroll = x;
        break;
      }
      x += w;
    }
    space.scroll = clamp(space.scroll, 0, this.maxScroll(ws));
  }

  /** The dwindle boundary within `tolerance` of a point, for dragging. */
  splitAt(x: number, y: number, tolerance: number): SplitHandle | null {
    const space = this.spaces[this.active]!;
    if (space.layout !== "dwindle" || !space.root) return null;
    const visit = (node: Node, cell: Rect): SplitHandle | null => {
      if (node.kind === "leaf") return null;
      const [a, b] = halves(node, cell);
      const edge = node.axis === "x" ? b.x : b.y;
      const along = node.axis === "x" ? y >= cell.y && y < cell.y + cell.h : x >= cell.x && x < cell.x + cell.w;
      if (along && Math.abs((node.axis === "x" ? x : y) - edge) <= tolerance) return { split: node, cell };
      return visit(node.a, a) ?? visit(node.b, b);
    };
    return visit(space.root, this.area());
  }

  dragSplit(handle: SplitHandle, x: number, y: number) {
    const { split, cell } = handle;
    split.ratio = clamp(split.axis === "x" ? (x - cell.x) / cell.w : (y - cell.y) / cell.h, MIN_RATIO, MAX_RATIO);
  }

  // ---- workspaces ------------------------------------------------------------

  switchWs(ws: number) {
    this.active = wrap(ws);
  }

  stepWs(delta: number) {
    this.switchWs(this.active + delta);
  }

  /** Moves a window to another workspace, beside its focused window. */
  moveToWs(id: number, ws: number) {
    const win = this.windows.get(id);
    const target = wrap(ws);
    if (!win || win.ws === target) return;
    this.remove(id);
    win.ws = target;
    this.insert(target, id);
  }

  /** Carries the focused window to the next or previous workspace and follows it. */
  carry(delta: number): boolean {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return false;
    const id = space.focus;
    this.moveToWs(id, this.active + delta);
    this.focusWin(id);
    return true;
  }
}
