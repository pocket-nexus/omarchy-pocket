// The deck's two bands: the strip along the top (the menu, what the keys go
// to, the layout tabs) and the body (the layout: keys, pad or home). Body
// components draw in their own coordinates, 512 x BODY_H.
export const STRIP_H = 26;
export const BODY_TOP = STRIP_H;
export const BODY_H = 384 - STRIP_H;
