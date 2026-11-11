// The machines the landing page tells its story on. The page keeps one
// machine on stage, the one the visitor picks; everything that differs between
// them is here: the model, the hour of the day it owns (the sky at each beat
// and the light its screen throws), its captures, its applets and its links.
//
// A beat row is where the model rests when that [data-beat] sits mid-screen:
// its pose (kit/rgds.js), the scene on its panels (kit/scenes.js), the sky's
// three stops from the top of the room to the floor, and the glow's strength.

export const MACHINES = {
  rgds: {
    id: "rgds",
    name: "RG DS Plus",
    hour: "Dusk",
    model: "rgds",
    // 167 × 96 × 24 mm closed, 181 mm tall open
    width: 167,
    status: "Runs today",
    buy: { label: "Get an RG DS Plus", href: "https://anbernic.com/products/rg-ds-plus?sca_ref=12680456.0FG7ivC2oS", sponsored: true },
    env: { sky: 0x352448, floor: 0x1a0a1c, key: 0x6e6468, fill: 0xb28cff, accent: 0xff6f91, strength: 1.2, front: 1.05 },
    theme: "#180c30",
    shots: (id) => [`/shots/${id}-top.webp`, `/shots/${id}-bottom.webp`],
    video: "/shots/chords.mp4",
    beats: [
      { pose: { pitch: -70, yaw: -14, lid: 27, zoom: .72, ox: 0, oy: .1, cy: 0, cz: 0 }, scene: "home", sky: ["#0b0716", "#1b0d30", "#4a1c48"], glow: 0 },
      { pose: { pitch: -54, yaw: -6, lid: 122, zoom: .98, ox: 0, oy: .05, cy: 0, cz: 0 }, scene: "home", sky: ["#180c30", "#59204f", "#c5546a"], glow: .55 },
      { pose: { pitch: -8, yaw: -13, lid: 174, zoom: 1.0, ox: .21, oy: 0, cy: 0, cz: 0 }, scene: "home", sky: ["#180c30", "#4a1c48", "#8a3360"], glow: .5 },
      { pose: { pitch: -6, yaw: -20, lid: 176, zoom: 1.34, ox: .2, oy: .0, cy: 47, cz: 6 }, scene: "tile4", sky: ["#100a26", "#2a1642", "#47204f"], glow: .5 },
      { pose: { pitch: -34, yaw: -20, lid: 150, zoom: 1.3, ox: .23, oy: 0, cy: -40, cz: -4 }, scene: "split", sky: ["#100a26", "#241444", "#3a2058"], glow: .45 },
      { pose: { pitch: -72, yaw: -156, lid: 72, zoom: 1.06, ox: .2, oy: .06, cy: -4, cz: -2 }, scene: "chords", sky: ["#0e0920", "#1f1140", "#2f1a55"], glow: .3 },
      { pose: { pitch: -16, yaw: -13, lid: 170, zoom: 1.0, ox: .22, oy: 0, cy: 0, cz: 0 }, scene: "chords", video: true, sky: ["#100a26", "#20123e", "#3a1c50"], glow: .35 },
      { pose: { pitch: -56, yaw: 24, lid: 96, zoom: 1.02, ox: -.2, oy: .02, cy: 0, cz: 0 }, scene: "tile3", sky: ["#0a0a1e", "#151633", "#292a58"], glow: .4 },
      { pose: { pitch: -22, yaw: -18, lid: 156, zoom: 1.02, ox: .22, oy: 0, cy: 14, cz: 0 }, scene: "agent", sky: ["#0a0a18", "#16182c", "#1e2140"], glow: .4 },
      { pose: { pitch: -32, yaw: 20, lid: 132, zoom: 1.1, ox: -.2, oy: 0, cy: 12, cz: 0 }, scene: "lupine-tile", sky: ["#1a2a48", "#3a5e88", "#d7a7b3"], glow: .75 },
      { pose: { pitch: -20, yaw: -16, lid: 158, zoom: 1.06, ox: .22, oy: 0, cy: 16, cz: 0 }, scene: "proxy", alternate: ["proxy", "ts"], sky: ["#0a1020", "#142038", "#1f3350"], glow: .45 },
      { pose: { pitch: -50, yaw: 0, lid: 118, zoom: .62, ox: 0, oy: .225, cy: 0, cz: 0 }, scene: "weather", sky: ["#121236", "#2a1c56", "#552a6a"], glow: .5 },
      { pose: { pitch: -60, yaw: -8, lid: 118, zoom: .46, ox: 0, oy: .335, cy: 0, cz: 0 }, scene: "home", sky: ["#1a0c30", "#6d2452", "#ef7a64"], glow: .7 },
    ],
    // the applets around the model in the apps beat: capture, name, place and tilt
    apps: [
      ["weather", "Weather", 14, 62, -5], ["maps", "Maps", 86, 62, 5], ["podcast", "Podcasts", 9, 34, 3],
      ["hnfull", "Hacker News", 91, 34, -3], ["video", "YouTube", 22, 87, 3], ["ts", "Tailscale", 78, 87, -3],
    ],
    appAspect: "4/3",
  },
  thor: {
    id: "thor",
    name: "AYN Thor",
    hour: "Night",
    model: "thor",
    // 150 × 94 × 25.6 mm closed
    width: 150,
    status: "Runs today, as an Android app",
    buy: { label: "Get an AYN Thor", href: "https://www.ayntec.com/products/ayn-thor", sponsored: false },
    env: { sky: 0x1c2a4a, floor: 0x070b18, key: 0x5c6478, fill: 0x7fb4ff, accent: 0x6a8cff, strength: 1.2, front: 1.05 },
    theme: "#08102a",
    shots: (id) => [`/shots/thor/${id}-top.webp`, `/shots/thor/${id}-bottom.webp`],
    video: "/shots/thor/chords.mp4",
    beats: [
      { pose: { pitch: -70, yaw: -14, lid: 27, zoom: .74, ox: 0, oy: .1, cy: 0, cz: 0 }, scene: "home", sky: ["#04060f", "#0b1430", "#1c2f5c"], glow: 0 },
      { pose: { pitch: -54, yaw: -6, lid: 122, zoom: 1.0, ox: 0, oy: .05, cy: 0, cz: 0 }, scene: "home", sky: ["#07102a", "#152a5c", "#3a6aa8"], glow: .5 },
      { pose: { pitch: -8, yaw: -13, lid: 174, zoom: 1.02, ox: .21, oy: 0, cy: 0, cz: 0 }, scene: "home", sky: ["#07102a", "#13264f", "#2c5288"], glow: .45 },
      { pose: { pitch: -6, yaw: -20, lid: 176, zoom: 1.32, ox: .2, oy: .0, cy: 45, cz: 6 }, scene: "tile4", sky: ["#060b20", "#11213f", "#1f3a66"], glow: .45 },
      { pose: { pitch: -34, yaw: -20, lid: 150, zoom: 1.3, ox: .23, oy: 0, cy: -42, cz: -4 }, scene: "split", sky: ["#060b20", "#0f1d3c", "#1c3560"], glow: .4 },
      { pose: { pitch: -72, yaw: -156, lid: 72, zoom: 1.08, ox: .2, oy: .06, cy: -4, cz: -2 }, scene: "chords", sky: ["#050918", "#0c1834", "#162b52"], glow: .3 },
      { pose: { pitch: -16, yaw: -13, lid: 170, zoom: 1.02, ox: .22, oy: 0, cy: 0, cz: 0 }, scene: "chords", video: true, sky: ["#060b20", "#0e1b3a", "#1a3158"], glow: .35 },
      { pose: { pitch: -56, yaw: 24, lid: 96, zoom: 1.04, ox: -.2, oy: .02, cy: 0, cz: 0 }, scene: "tile3", sky: ["#05081a", "#0d1830", "#18305a"], glow: .4 },
      { pose: { pitch: -22, yaw: -18, lid: 156, zoom: 1.04, ox: .22, oy: 0, cy: 14, cz: 0 }, scene: "heart", sky: ["#05081a", "#0c1428", "#142240"], glow: .4 },
      { pose: { pitch: -32, yaw: 20, lid: 132, zoom: 1.12, ox: -.2, oy: 0, cy: 12, cz: 0 }, scene: "theme", sky: ["#0c1430", "#26386a", "#7c86b8"], glow: .4 },
      { pose: { pitch: -20, yaw: -16, lid: 158, zoom: 1.08, ox: .22, oy: 0, cy: 16, cz: 0 }, scene: "network", sky: ["#050c1c", "#0f2038", "#1a3654"], glow: .45 },
      { pose: { pitch: -50, yaw: 0, lid: 118, zoom: .64, ox: 0, oy: .225, cy: 0, cz: 0 }, scene: "tile4", sky: ["#081030", "#16285a", "#2f4f8a"], glow: .5 },
      { pose: { pitch: -60, yaw: -8, lid: 118, zoom: .48, ox: 0, oy: .335, cy: 0, cz: 0 }, scene: "home", sky: ["#07102a", "#1a3466", "#5a86c4"], glow: .65 },
    ],
    // the shell's own applets: the packages (YouTube, Maps, ...) are captured once they draw on the Thor again
    apps: [
      ["tile4", "Notes, Clock, Activity", 14, 62, -5], ["network", "Wi-Fi", 86, 62, 5], ["heart", "Neovim", 9, 34, 3],
      ["theme", "Lupine", 91, 34, -3], ["tile3", "Activity and Clock", 22, 87, 3], ["split", "Terminals", 78, 87, -3],
    ],
    appAspect: "16/9",
  },
};

export const ORDER = ["rgds", "thor"];
export const DEFAULT = "rgds";

/** The machine a URL asks for (?m=thor), or the default. */
export function fromUrl(url = location.href) {
  const m = new URL(url).searchParams.get("m");
  return m && MACHINES[m] ? m : DEFAULT;
}
