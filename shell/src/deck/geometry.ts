// The deck's bands: the function row along the top and the body under it (the
// layout: keys or pad). Body components draw in their own coordinates,
// DECK_W x BODY_H (512 x 350 on the RG DS Plus, 413 x 326 on the AYN Thor).
//
// The keys layout is a laptop's lower half: four rows of keys and under them
// a trackpad with two round buttons on either side. The pad layout folds the
// keys away: the pins run along the bottom between the lower round buttons,
// and the trackpad takes the room above them. The workspaces, the layout
// badge and the bar's panels sit in the function row (deck/strip.tsx).
import { DECK_H, DECK_W } from "../screen.ts";

export const STRIP_H = 34;
export const BODY_TOP = STRIP_H;
export const BODY_H = DECK_H - STRIP_H;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const KEYS_TOP = 2;
export const KEY_PITCH = 44;
export const KEYS_BOTTOM = KEYS_TOP + 4 * KEY_PITCH;

/** the margin around the body's parts, and between them */
export const EDGE = 6;
const PAD_X = 62;
const PAD_W = DECK_W - 2 * PAD_X;
const PAD_BOTTOM = BODY_H - EDGE;

/** The round buttons: two at the bottom of each margin, level with each
 *  other. They stay put when the trackpad grows. */
export const ROUND = 44;
const ROUND_GAP = 8;
const LEFT_X = (PAD_X - ROUND) / 2;
const RIGHT_X = DECK_W - PAD_X + LEFT_X;
export const ROUNDS = {
  voice: { x: LEFT_X, y: PAD_BOTTOM - 2 * ROUND - ROUND_GAP, w: ROUND, h: ROUND },
  hold: { x: LEFT_X, y: PAD_BOTTOM - ROUND, w: ROUND, h: ROUND },
  toggle: { x: RIGHT_X, y: PAD_BOTTOM - 2 * ROUND - ROUND_GAP, w: ROUND, h: ROUND },
  close: { x: RIGHT_X, y: PAD_BOTTOM - ROUND, w: ROUND, h: ROUND },
} satisfies Record<string, Rect>;

/** The pad layout's pins: the trackpad's width, level with Hold and Close. */
export const PIN_ROW: Rect = { x: PAD_X, y: PAD_BOTTOM - ROUND, w: PAD_W, h: ROUND };

export const PAD_SMALL: Rect = { x: PAD_X, y: KEYS_BOTTOM + EDGE, w: PAD_W, h: PAD_BOTTOM - KEYS_BOTTOM - EDGE };
export const PAD_LARGE: Rect = { x: PAD_X, y: EDGE, w: PAD_W, h: PIN_ROW.y - 2 * EDGE };

export const inRect = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
