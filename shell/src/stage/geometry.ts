// The stage's card: Omarchy's menu, the bar's panels and the theme picker
// open in one card over the windows, as Omarchy's launcher does on a
// desktop: centred under the bar, the windows and the wallpaper around it.
// Card components draw in their own coordinates, CARD_W x CARD_H.
export const CARD_W = 360;
export const CARD_H = 296;
export const CARD_X = (512 - CARD_W) / 2;
/** centred in the 366 points under the bar */
export const CARD_Y = 18 + (366 - CARD_H) / 2;
