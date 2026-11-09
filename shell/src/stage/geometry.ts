// The stage's card: Omarchy's menu, the bar's panels and the theme picker
// open in one card over the windows, as Omarchy's launcher does on a
// desktop: centred under the bar, the windows and the wallpaper around it.
// Card components draw in their own coordinates, CARD_W x CARD_H.
import { STAGE_H, STAGE_W } from "../screen.ts";

export const CARD_W = 360;
export const CARD_H = 296;
export const CARD_X = Math.round((STAGE_W - CARD_W) / 2);
/** The key sheet and the QR code's sheet: 12 points from the sides and
 *  the bottom, 24 from the top (488 x 348 on the RG DS Plus). */
export const SHEET_W = STAGE_W - 24;
export const SHEET_H = STAGE_H - 36;
/** centred in the points under the bar (366 on the RG DS Plus) */
export const CARD_Y = 18 + Math.round((STAGE_H - 18 - CARD_H) / 2);
