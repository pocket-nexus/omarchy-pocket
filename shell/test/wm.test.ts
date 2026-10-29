import { expect, test } from "bun:test";
import { WindowManager } from "../src/wm.ts";

const term = (sid: number) => ({ kind: "terminal" as const, sid });

test("new windows split the focused one along its longer side", () => {
  const wm = new WindowManager();
  const a = wm.open(term(1));
  expect(wm.placements()[0]!.rect).toEqual({ x: 9, y: 27, w: 494, h: 348 });
  const b = wm.open(term(2));
  const [pa, pb] = [a, b].map((id) => wm.placements().find((p) => p.id === id)!.rect);
  expect(pa!.x).toBeLessThan(pb!.x);
  expect(pa!.y).toBe(pb!.y);
  const c = wm.open(term(3));
  const pc = wm.placements().find((p) => p.id === c)!.rect;
  const pb2 = wm.placements().find((p) => p.id === b)!.rect;
  expect(pc.x).toBe(pb2.x);
  expect(pc.y).toBeGreaterThan(pb2.y);
  expect(wm.focused()!.id).toBe(c);
});

test("focus, swap, close and workspaces", () => {
  const wm = new WindowManager();
  const a = wm.open(term(1));
  const b = wm.open(term(2));
  expect(wm.focusDir("left")).toBe(true);
  expect(wm.focused()!.id).toBe(a);
  expect(wm.focusDir("left")).toBe(false);
  wm.swapDir("right");
  expect(wm.order()).toEqual([b, a]);
  wm.close(a);
  expect(wm.order()).toEqual([b]);
  expect(wm.focused()!.id).toBe(b);
  wm.carry(1);
  expect(wm.active).toBe(1);
  expect(wm.occupied(0)).toBe(false);
  expect(wm.focused()!.id).toBe(b);
});

test("resize, toggle split and fullscreen", () => {
  const wm = new WindowManager();
  const a = wm.open(term(1));
  wm.open(term(2));
  wm.focusWin(a);
  wm.resize(1);
  const ra = wm.placements().find((p) => p.id === a)!.rect;
  expect(ra.w).toBeGreaterThan(250);
  wm.toggleSplit();
  const rb = wm.placements().find((p) => p.id !== a)!.rect;
  expect(rb.y).toBeGreaterThan(ra.y);
  wm.toggleFullscreen("full");
  const ps = wm.placements();
  expect(ps.find((p) => p.id === a)!.rect).toEqual({ x: 0, y: 0, w: 512, h: 384 });
  expect(ps.find((p) => p.id !== a)!.hidden).toBe(true);
});

test("the scrolling strip keeps the focused column whole and toggles back", () => {
  const wm = new WindowManager();
  const ids = [1, 2, 3].map((sid) => wm.open(term(sid)));
  expect(wm.toggleLayout()).toBe("scrolling");
  // the third column is focused: the strip scrolled so it is on the panel
  const third = wm.placements().find((p) => p.id === ids[2])!.rect;
  expect(third.x + third.w).toBeLessThanOrEqual(512);
  wm.focusWin(ids[0]!);
  expect(wm.placements().find((p) => p.id === ids[0])!.rect.x).toBe(9);
  // Y: column width steps 0.49 -> 0.66
  wm.toggleSplit();
  expect(wm.placements().find((p) => p.id === ids[0])!.rect.w).toBe(Math.round(500 * 0.66) - 6);
  // R + Y on the second column stacks it into the first
  wm.focusWin(ids[1]!);
  wm.swapSplit();
  const [a, b] = [ids[0], ids[1]].map((id) => wm.placements().find((p) => p.id === id)!.rect);
  expect(a!.x).toBe(b!.x);
  expect(b!.y).toBeGreaterThan(a!.y);
  expect(wm.toggleLayout()).toBe("dwindle");
  expect(wm.order()).toEqual([ids[0], ids[1], ids[2]]);
  expect(wm.focused()!.id).toBe(ids[1]);
});

test("swap split, drag a split, reopen", () => {
  const wm = new WindowManager();
  const a = wm.open(term(1));
  const b = wm.open(term(2));
  wm.swapSplit();
  expect(wm.order()).toEqual([b, a]);
  const handle = wm.splitAt(256, 200, 6)!;
  expect(handle).not.toBeNull();
  wm.dragSplit(handle, 306, 200);
  expect(wm.placements()[0]!.rect.w).toBeGreaterThan(280);
  wm.close(a);
  expect(wm.closed.at(-1)).toEqual({ kind: "terminal", sid: 1 });
});
