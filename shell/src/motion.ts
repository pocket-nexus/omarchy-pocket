// Moves on the core's animation tracks. `flip` takes a node laid out at `to`
// and has it drawn at `from`, then hands the return to the core (FLIP: one
// script call per change, no relayout or script work while it moves).
// `glide` tweens one paint-only property. Durations stretch together with
// `setSlowMotion`, to watch or film a transition.
import { animate, jump } from "@pocketjs/framework/animation";
import type { NodeMirror } from "@pocketjs/framework/components";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A node's transform origin at its top-left corner, so a translate lands the
 *  corner and a scale grows the node from there. */
export const TOP_LEFT = { originX: -0.5, originY: -0.5 } as const;

let slow = 1;
export const setSlowMotion = (factor: number) => (slow = Math.max(1, factor));
export const slowed = (ms: number) => ms * slow;

export function flip(node: NodeMirror, from: Box, to: Box, fromAlpha = 1, toAlpha = 1, ms = 200) {
  jump(node, "translateX", from.x - to.x);
  jump(node, "translateY", from.y - to.y);
  jump(node, "scaleX", to.w > 0 ? from.w / to.w : 1);
  jump(node, "scaleY", to.h > 0 ? from.h / to.h : 1);
  jump(node, "opacity", fromAlpha);
  const opts = { dur: slowed(ms), easing: "out" } as const;
  animate(node, "translateX", 0, opts);
  animate(node, "translateY", 0, opts);
  animate(node, "scaleX", 1, opts);
  animate(node, "scaleY", 1, opts);
  animate(node, "opacity", toAlpha, opts);
}

/** Tweens a paint-only property (translate, scale, opacity) to `to`. */
export function glide(node: NodeMirror | undefined, prop: "translateX" | "translateY" | "opacity" | "scaleX" | "scaleY", to: number, ms = 140) {
  if (node) animate(node, prop, to, { dur: slowed(ms), easing: "out" });
}

/** Sets a paint-only property at once (a finger dragging the node). */
export function place(node: NodeMirror | undefined, prop: "translateX" | "translateY" | "opacity", to: number) {
  if (node) jump(node, prop, to);
}
