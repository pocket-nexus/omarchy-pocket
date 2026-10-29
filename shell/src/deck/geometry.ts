// The deck's three bands: the strip along the top (workspaces, the focused
// window's title, the L1/R1 pills, Go), the body (the focused window's touch
// controls, the Omarchy menu, or the chord map), and the dock along the
// bottom. Body components draw in their own coordinates, 512 x BODY_H.
export const STRIP_H = 26;
export const DOCK_H = 40;
export const BODY_TOP = STRIP_H;
export const BODY_H = 384 - STRIP_H - DOCK_H;
export const DOCK_TOP = 384 - DOCK_H;
