// The deck's bands: the function row along the top and the body under it (the
// layout: keys, pad or home). Body components draw in their own coordinates,
// 512 x BODY_H. The keys layout is a laptop's lower half: four rows of keys
// and under them a trackpad with two round buttons on either side. The pad
// layout folds the keys away and the same trackpad takes their room.
export const STRIP_H = 34;
export const BODY_TOP = STRIP_H;
export const BODY_H = 384 - STRIP_H;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const KEYS_TOP = 2;
export const KEY_PITCH = 44;
export const KEYS_BOTTOM = KEYS_TOP + 4 * KEY_PITCH;
const PAD_X = 62;
const PAD_W = 512 - 2 * PAD_X;
const PAD_BOTTOM = BODY_H - 6;
export const PAD_SMALL: Rect = { x: PAD_X, y: KEYS_BOTTOM + 6, w: PAD_W, h: PAD_BOTTOM - KEYS_BOTTOM - 6 };
export const PAD_LARGE: Rect = { x: PAD_X, y: 6, w: PAD_W, h: PAD_BOTTOM - 6 };

/** The round buttons: two at the bottom of the left margin, two at the top
 *  of the right margin beside the small trackpad. They stay put when the
 *  trackpad grows. */
export const ROUND = 44;
const ROUND_GAP = 8;
const LEFT_X = (PAD_X - ROUND) / 2;
const RIGHT_X = 512 - PAD_X + LEFT_X;
export const ROUNDS = {
  voice: { x: LEFT_X, y: PAD_BOTTOM - 2 * ROUND - ROUND_GAP, w: ROUND, h: ROUND },
  hold: { x: LEFT_X, y: PAD_BOTTOM - ROUND, w: ROUND, h: ROUND },
  toggle: { x: RIGHT_X, y: PAD_SMALL.y, w: ROUND, h: ROUND },
  more: { x: RIGHT_X, y: PAD_SMALL.y + ROUND + ROUND_GAP, w: ROUND, h: ROUND },
} satisfies Record<string, Rect>;

export const inRect = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
