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
