// The two surfaces' logical sizes and raster density, as the host program
// publishes them before the package's modules run: `ui.__viewport` (the
// stage), `ui.__auxiliarySurface` (the deck) and `omarchyBridge.density`.
//
//   RG DS Plus   stage 512 x 384, deck 512 x 384, density 2 (two 1024 x 768 panels)
//   AYN Thor     stage 640 x 360, deck 413 x 360, density 3 (1920 x 1080 over 1239 x 1080)
//
// Every layout derives from these; the RG DS Plus's sizes are the fallback
// (unit tests run with no host).
interface Published {
  ui?: { __host?: string; __viewport?: { w: number; h: number }; __auxiliarySurface?: { w: number; h: number } };
  omarchyBridge?: { density?: number };
}
const published = globalThis as Published;

export const STAGE_W = published.ui?.__viewport?.w ?? 512;
export const STAGE_H = published.ui?.__viewport?.h ?? 384;
export const DECK_W = published.ui?.__auxiliarySurface?.w ?? 512;
export const DECK_H = published.ui?.__auxiliarySurface?.h ?? 384;
export const DENSITY = published.omarchyBridge?.density ?? 2;
/** The host profile's id: "rg-ds-plus" or "ayn-thor". */
export const DEVICE = published.ui?.__host ?? "rg-ds-plus";
/** The face buttons by place: the RG DS Plus's are Nintendo's (X top, A
 *  right), the Thor's Xbox's (Y top, X left, B right, A bottom), with the
 *  left stick above the D-pad. A button keeps its meaning by its label. */
export const XBOX_FACES = DEVICE === "ayn-thor";

/** The stage's panel in pixels: the size the daemon cuts backgrounds to. */
export const PANEL: [number, number] = [STAGE_W * DENSITY, STAGE_H * DENSITY];

/** The deck's width against the RG DS Plus's 512 points: the shoulder
 *  legend and the pinyin candidates scale by it. */
export const DECK_SCALE = DECK_W / 512;
