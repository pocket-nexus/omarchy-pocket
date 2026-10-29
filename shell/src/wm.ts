// The stage's window manager as plain state and geometry, with no Solid in
// it: workspaces.ts wraps it in signals. It tiles the way Omarchy configures
// Hyprland's dwindle layout: a binary split tree per workspace, where a new
// window splits the focused one along its longer side and takes the right or
// bottom half (`force_split = 2`), and a split keeps its direction when a
// window closes (`preserve_split`). The gaps and border are Omarchy's
// (gaps_out, gaps_in, border_size) at the panel's scale: the bar's height off
// the top, GAP_OUT around the tiled area, every window inset GAP_IN, so
// neighbours sit 2 * GAP_IN apart.

export const STAGE_W = 512;
export const STAGE_H = 384;
export const BAR_H = 18;
export const GAP_OUT = 6;
export const GAP_IN = 3;
export const BORDER = 2;
export const WORKSPACES = 5;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const RESIZE_STEP = 0.05;

export type Dir = "left" | "right" | "up" | "down";
export type Content = { kind: "terminal"; sid: number } | { kind: "applet"; applet: string };
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

interface Workspace {
  root: Node | null;
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

export const contains = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

function place(node: Node, rect: Rect, out: Map<number, Rect>) {
  if (node.kind === "leaf") return void out.set(node.win, rect);
  if (node.axis === "x") {
    const w = Math.round(rect.w * node.ratio);
    place(node.a, { ...rect, w }, out);
    place(node.b, { ...rect, x: rect.x + w, w: rect.w - w }, out);
  } else {
    const h = Math.round(rect.h * node.ratio);
    place(node.a, { ...rect, h }, out);
    place(node.b, { ...rect, y: rect.y + h, h: rect.h - h }, out);
  }
}

export class WindowManager {
  readonly windows = new Map<number, Win>();
  private readonly spaces: Workspace[] = Array.from({ length: WORKSPACES }, () => ({ root: null, focus: null, fullscreen: null }));
  active = 0;
  /** where Omarchy's bar sits (shell.json), which the tiled area leaves free */
  bar: "top" | "bottom" | "none" = "top";
  private nextId = 1;

  /** The tiled area: clear of the bar, inside GAP_OUT. */
  area(): Rect {
    const top = this.bar === "top" ? BAR_H : 0;
    const bottom = this.bar === "bottom" ? BAR_H : 0;
    return { x: GAP_OUT, y: top + GAP_OUT, w: STAGE_W - 2 * GAP_OUT, h: STAGE_H - top - bottom - 2 * GAP_OUT };
  }

  focused(ws = this.active): Win | null {
    const id = this.spaces[ws]!.focus;
    return id === null ? null : (this.windows.get(id) ?? null);
  }

  /** Window ids of a workspace, in tree order. */
  order(ws = this.active): number[] {
    return leaves(this.spaces[ws]!.root);
  }

  placements(ws = this.active): Placement[] {
    const space = this.spaces[ws]!;
    const cells = new Map<number, Rect>();
    if (space.root) place(space.root, this.area(), cells);
    const out: Placement[] = [];
    for (const [id, cell] of cells) {
      const rect = { x: cell.x + GAP_IN, y: cell.y + GAP_IN, w: cell.w - 2 * GAP_IN, h: cell.h - 2 * GAP_IN };
      out.push({ id, rect, hidden: false });
    }
    const full = space.fullscreen;
    if (full && cells.has(full.win)) {
      const area = this.area();
      for (const p of out) {
        if (p.id !== full.win) p.hidden = true;
        else p.rect = full.mode === "full" ? { x: 0, y: 0, w: STAGE_W, h: STAGE_H } : { x: area.x, y: area.y, w: area.w, h: area.h };
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

  /** Opens `content` on workspace `ws`, splitting the focused window. */
  open(content: Content, ws = this.active): number {
    const id = this.nextId++;
    this.windows.set(id, { ...content, id, ws });
    this.insert(ws, id);
    return id;
  }

  private insert(ws: number, id: number) {
    const space = this.spaces[ws]!;
    space.fullscreen = null;
    const leaf: Leaf = { kind: "leaf", win: id };
    const target = space.focus ?? this.order(ws).at(-1) ?? null;
    if (!space.root || target === null) {
      space.root = leaf;
    } else {
      const cells = new Map<number, Rect>();
      place(space.root, this.area(), cells);
      const cell = cells.get(target)!;
      const chain = path(space.root, target)!;
      const old: Leaf = { kind: "leaf", win: target };
      const split: Split = { kind: "split", axis: cell.w >= cell.h ? "x" : "y", ratio: 0.5, a: old, b: leaf };
      const parent = chain.at(-1);
      if (parent) parent.split[parent.side] = split;
      else space.root = split;
    }
    space.focus = id;
  }

  /** Takes the window out of its workspace's tree; its sibling takes the parent's place. */
  private remove(id: number) {
    const win = this.windows.get(id);
    if (!win) return;
    const space = this.spaces[win.ws]!;
    const chain = path(space.root, id);
    if (!chain) return;
    const parent = chain.at(-1);
    if (!parent) space.root = null;
    else {
      const sibling = parent.split[parent.side === "a" ? "b" : "a"];
      const grand = chain.at(-2);
      if (grand) grand.split[grand.side] = sibling;
      else space.root = sibling;
    }
    if (space.fullscreen?.win === id) space.fullscreen = null;
    if (space.focus === id) {
      // focus moves to the window that took the space, the way Hyprland hands it on
      const rest = this.order(win.ws);
      space.focus = parent ? (leaves(parent.split[parent.side === "a" ? "b" : "a"])[0] ?? rest[0] ?? null) : (rest[0] ?? null);
    }
  }

  close(id: number) {
    this.remove(id);
    this.windows.delete(id);
  }

  /** Focuses the window, switching to its workspace. */
  focusWin(id: number) {
    const win = this.windows.get(id);
    if (!win) return;
    this.active = win.ws;
    this.spaces[win.ws]!.focus = id;
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
    return true;
  }

  /** Exchanges the focused window with its neighbour in `dir`. */
  swapDir(dir: Dir): boolean {
    const space = this.spaces[this.active]!;
    const other = this.neighbor(dir);
    if (other === null || space.focus === null) return false;
    this.swap(space.focus, other);
    return true;
  }

  swap(a: number, b: number) {
    const wa = this.windows.get(a);
    const wb = this.windows.get(b);
    if (!wa || !wb || wa.ws !== wb.ws || a === b) return;
    const space = this.spaces[wa.ws]!;
    const swapIn = (node: Node | null): void => {
      if (!node) return;
      if (node.kind === "leaf") node.win = node.win === a ? b : node.win === b ? a : node.win;
      else {
        swapIn(node.a);
        swapIn(node.b);
      }
    };
    swapIn(space.root);
  }

  /** Grows (+1) or shrinks (-1) the focused window at the nearest split. */
  resize(delta: number) {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return;
    const parent = path(space.root, space.focus)?.at(-1);
    if (!parent) return;
    const grow = parent.side === "a" ? delta : -delta;
    parent.split.ratio = clamp(parent.split.ratio + grow * RESIZE_STEP, MIN_RATIO, MAX_RATIO);
  }

  /** Turns the split above the focused window from side by side to stacked, or back (Hyprland togglesplit). */
  toggleSplit(): boolean {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return false;
    const parent = path(space.root, space.focus)?.at(-1);
    if (!parent) return false;
    parent.split.axis = parent.split.axis === "x" ? "y" : "x";
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

  // ---- workspaces ------------------------------------------------------------

  switchWs(ws: number) {
    this.active = ((ws % WORKSPACES) + WORKSPACES) % WORKSPACES;
  }

  stepWs(delta: number) {
    this.switchWs(this.active + delta);
  }

  /** Moves a window to another workspace, which it opens on and focuses. */
  moveToWs(id: number, ws: number) {
    const win = this.windows.get(id);
    const target = ((ws % WORKSPACES) + WORKSPACES) % WORKSPACES;
    if (!win || win.ws === target) return;
    this.remove(id);
    win.ws = target;
    this.insert(target, id);
  }

  /** Carries the focused window to the next or previous workspace and follows it. */
  carry(delta: number) {
    const space = this.spaces[this.active]!;
    if (space.focus === null) return;
    const id = space.focus;
    this.moveToWs(id, this.active + delta);
    this.focusWin(id);
  }

  occupied(ws: number): boolean {
    return this.spaces[ws]!.root !== null;
  }
}
