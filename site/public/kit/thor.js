// The AYN Thor's body for kit/rgds.js's runtime (createDevice(host, { model:
// "thor" })), in millimetres, measured from AYN's to-scale line drawing of the
// open front view and its edges: 150 × 94 × 25.6 mm closed, a 17.7 mm base
// under a 5.1 mm lid, a 6″ 16:9 panel in the lid and a 3.92″ 1240 × 1080 one
// in the base, a three-part hinge barrel ⌀10.2 that stops at 180 degrees.
//
// The origin is the hinge's axis, as on the RG DS Plus: X along the hinge, +Y
// away from the player on the base, +Z out of the base's face. `up(d)` is a
// point `d` mm above the base's front edge, the way the drawing measures.
import { extrude, holePath, label, lathe, rrect } from "./parts.js";

const W = 150, AXIS = 88.7, BASE_T = 17.7, GAP = 2.8, LID_T = 5.1, BARREL_R = 5.1;
const STAGE_W = 132.8, STAGE_H = 74.7, DECK_W = 75.6, DECK_H = 65.9;
const up = (d) => -AXIS + d;
/** the lid's free edge sits over the base's front edge; its panel 4 mm in */
const LID_REACH = AXIS, LID_JOINT = 3.2;

export function buildThor({ THREE, M, glass, add, reg, panel, body, buttons, options, inkColor }) {
  // ---------- base ----------
  const base = new THREE.Group();
  base.position.set(0, 0, -GAP);
  body.add(base);
  const y0 = -AXIS, y1 = -1.2;
  add(base, extrude(rrect(-W / 2, y0, W / 2, y1, [8, 8, 2.4, 2.4]), BASE_T, 1.2, 4), M.shell).position.z = -BASE_T;

  // one glass sheet over the face, with a notch at the front for the chin tab
  const sheet = rrect(-W / 2 + 1.7, up(1.7), W / 2 - 1.7, up(82), 6.4);
  const notch = rrect(-53.5 / 2, up(1.7) - 1, 53.5 / 2, up(9.5), 1.6);
  sheet.holes.push(holePath(notch));
  add(base, extrude(sheet, 0.5, 0.15, 2), M.glassBlack, false).position.z = -0.35;
  // the chin tab and its AYN key
  add(base, extrude(rrect(-46.9 / 2, up(0.6), 46.9 / 2, up(8.4), 2.2), 1.6, 0.4, 3), M.shell).position.z = -0.05;
  const ayn = new THREE.Group();
  add(ayn, extrude(rrect(-5.5, -2.15, 5.5, 2.15, 2.1), 0.9, 0.3, 3), M.cap);
  const aynLabel = label("AYN", 2.2, { px: 96, color: inkColor, weight: 600, opacity: 0.7, track: 6 });
  aynLabel.position.z = 0.92;
  ayn.add(aynLabel);
  ayn.position.set(0, up(4.35), 1.55);
  base.add(reg("AYN", ayn, 0.3));
  for (const side of [-1, 1]) add(base, new THREE.CylinderGeometry(1.85, 1.85, 0.5, 20).rotateX(Math.PI / 2), M.dark, false).position.set(side * 19.8, up(4.35), 1.75);

  const deck = panel(base, up(12.9 + DECK_H / 2), 0.2, DECK_W, DECK_H, false);
  deck.screen.userData.hit = "deck";

  // a round well on the glass, where the sticks, the D-pad and the faces sit:
  // a raised rim and a dark floor
  const GLASS = 0.15;
  const well = (x, y, d) => {
    const r = d / 2;
    add(base, lathe([[r + 0.8, 0.0], [r + 0.4, 0.45], [r, 0.5], [r - 0.6, 0.25], [r - 1.2, -0.02]]), M.rim, false).position.set(x, y, GLASS);
    add(base, new THREE.CircleGeometry(r - 1.1, 48), M.dark, false, false).position.set(x, y, GLASS + 0.01);
  };
  // a stick: a lit ring in its well, a stem and a dished cap
  const ringMats = [];
  const stick = (name, x, y) => {
    well(x, y, 25.4);
    const ring = new THREE.MeshStandardMaterial({ color: 0x0a0a10, emissive: new THREE.Color(options.ringGlow ?? 0x6f8cff), emissiveIntensity: 0.55, roughness: 0.5 });
    ringMats.push(ring);
    add(base, new THREE.TorusGeometry(10.6, 0.45, 10, 64), ring, false, false).position.set(x, y, GLASS + 0.12);
    const g = new THREE.Group();
    add(g, new THREE.CylinderGeometry(3.4, 4.0, 2.6, 24).rotateX(Math.PI / 2), M.dark).position.z = 0.4;
    add(g, lathe([[0, 3.4], [2.6, 3.65], [5.0, 3.8], [7.2, 3.3], [7.7, 2.6], [7.2, 1.8], [3.6, 1.6]]), M.cap);
    g.position.set(x, y, GLASS);
    base.add(reg(name, g, 0.5));
  };
  stick("STICK", -57.0, up(60.0));
  stick("RSTICK", 55.8, up(31.5));

  // the D-pad: one cross, 20 mm tip to tip, in its well
  well(-55.5, up(31.5), 23.4);
  const dpad = new THREE.Group();
  const a = 10, b = 3.6, cross = new THREE.Shape();
  [[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]].forEach(([x, y], i) => (i ? cross.lineTo(x, y) : cross.moveTo(x, y)));
  cross.closePath();
  add(dpad, extrude(cross, 1.6, 0.38, 3, 2), M.keys);
  for (const [x, y, w, h] of [[-6.6, 0, 2.6, 0.45], [6.6, 0, 2.6, 0.45], [0, 6.6, 0.45, 2.6], [0, -6.6, 0.45, 2.6]])
    add(dpad, new THREE.PlaneGeometry(w, h), M.ink, false, false).position.set(x, y, 1.61);
  dpad.position.set(-55.5, up(31.5), GLASS);
  base.add(reg("DPAD", dpad, 0.4));

  // the faces on their round plate, in Nintendo order: X top, Y left, A right, B bottom
  const faceCenter = [57.0, up(60.0)];
  well(...faceCenter, 26.7);
  const round = (r, h) => lathe([[0, h], [r - 0.7, h], [r - 0.25, h - 0.12], [r, h - 0.5], [r, 0]]);
  for (const [name, dx, dy] of [["X", 0, 8.3], ["B", 0, -8.3], ["Y", -8.3, 0], ["A", 8.3, 0]]) {
    const g = new THREE.Group();
    add(g, round(3.45, 1.9), M.keys);
    const l = label(name, 4.4, { px: 110, color: inkColor, weight: 500 });
    l.position.z = 1.92;
    g.add(l);
    g.position.set(faceCenter[0] + dx, faceCenter[1] + dy, GLASS);
    base.add(reg(name, g));
  }

  // four small round keys by the panel's corners: Select and Start above, Home and Back below
  for (const [name, x, y] of [["SELECT", -46.4, up(76.4)], ["START", 46.4, up(76.4)], ["HOME", -46.3, up(10.9)], ["BACK", 46.3, up(10.9)]]) {
    const g = new THREE.Group();
    add(g, lathe([[0, 0.9], [1.2, 0.85], [1.75, 0.45], [1.85, 0]]), M.cap);
    g.position.set(x, y, 0.15);
    base.add(reg(name, g, 0.3));
  }
  // the speakers' slots beside Home and Back, and the microphone
  for (const side of [-1, 1]) add(base, extrude(rrect(-6.1, -1, 6.1, 1, 1), 0.1), M.dark, false).position.set(side * 59.4, up(10.9), 0.16);
  add(base, new THREE.CircleGeometry(0.75, 16), M.dark, false, false).position.set(-46.8, up(46.7), 0.17);

  // the front edge: volume, power, USB-C, the jack, the card's door, the loops
  for (const [x, w, mat] of [[-39.1, 22.8, M.keys], [-18.6, 12.8, M.keys], [7.7, 8.7, M.dark], [39.3, 19, M.rim]]) {
    const pill = add(base, extrude(rrect(-w / 2, -1.3, w / 2, 1.3, 1.25), 0.4), mat, false);
    pill.rotation.x = Math.PI / 2;
    pill.position.set(x, y0 + 0.25, -10);
  }
  add(base, new THREE.CylinderGeometry(2.5, 2.5, 0.4, 24), M.dark, false).position.set(22.9, y0 - 0.02, -10);

  // ---------- hinge: two knuckles on the base, the barrel on the lid ----------
  for (const side of [-1, 1]) {
    // the domed end faces out
    const knuckle = lathe([[0, -10.8], [3.6, -10.8], [4.7, -10.3], [BARREL_R, -9.2], [BARREL_R, 10.8], [0, 10.8]]).rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
    add(body, knuckle, M.shell).position.set(side * (W / 2 - 10.8), 0, 0);
    add(body, new THREE.BoxGeometry(21.6, 4, GAP + 4), M.shell).position.set(side * (W / 2 - 10.8), -2.4, -GAP / 2 - 2);
  }

  // ---------- shoulders: L1/R1 bars on the corners, L2/R2 trigger lobes under them ----------
  const shoulderMats = [];
  for (const [name, side, z, lobe] of [["L1", -1, -3.4, false], ["R1", 1, -3.4, false], ["L2", -1, -BASE_T + 0.2, true], ["R2", 1, -BASE_T + 0.2, true]]) {
    const g = new THREE.Group();
    const lit = M.keys.clone();
    lit.emissive.set(options.shoulderGlow ?? 0x7fa4ff);
    lit.emissiveIntensity = 0;
    shoulderMats.push(lit);
    const m = lobe
      ? add(g, extrude(rrect(-9, -2.4, 9, 2.4, 2.3), 6.2, 1.2, 4, 10), lit)
      : add(g, extrude(rrect(-13.8, -2.75, 13.8, 2.75, 2.6), 3.2, 0.6, 3, 10), lit);
    m.rotation.x = -Math.PI / 2;
    g.position.set(side * (lobe ? 62 : 63.2), y1 - (lobe ? 3.4 : 1.6), z);
    base.add(reg(name, g, 0.7));
    buttons.get(name).glow = lit;
  }

  // ---------- lid ----------
  const lidPivot = new THREE.Group();
  body.add(lidPivot);
  const lid = new THREE.Group();
  lidPivot.add(lid);
  // closed, the lid lies over the base: its inner face on the axis's plane, facing -Z
  const lidShape = () => rrect(-W / 2, -LID_REACH, W / 2, -LID_JOINT, [8, 8, 1.6, 1.6]);
  add(lid, extrude(lidShape(), LID_T, 1.0, 4), M.shell).position.z = 0;
  // the centre barrel and the joints that carry the lid to it
  add(lid, new THREE.CylinderGeometry(BARREL_R - 0.05, BARREL_R - 0.05, W - 2 * 21.6 - 0.4, 40).rotateZ(Math.PI / 2), M.shell);
  for (const side of [-1, 1]) add(lid, new THREE.BoxGeometry(14, LID_JOINT + 1, LID_T - 0.6), M.shell).position.set(side * 44, -LID_JOINT / 2, LID_T / 2);

  const faceGroup = new THREE.Group();
  faceGroup.position.z = -0.001;
  faceGroup.rotation.x = Math.PI; // the panel looks at -Z closed; screen-up runs to the free edge
  lid.add(faceGroup);
  // the black glass, inset 1.5 mm from the shell, and the panel in it
  const lidGlass = rrect(-W / 2 + 1.5, LID_JOINT + 1.5, W / 2 - 1.5, LID_REACH - 1.5, 6.6);
  add(faceGroup, extrude(lidGlass, 0.4, 0.12, 2), M.glassBlack, false).position.z = -0.3;
  const stageY = LID_REACH - 1.5 - 4.0 - STAGE_H / 2;
  const stage = panel(faceGroup, stageY, 0.12, STAGE_W, STAGE_H, false);
  stage.screen.userData.hit = "stage";

  // ---------- anchors ----------
  const anchors = {
    stage: { parent: faceGroup, at: [0, stageY, 0] },
    stageTop: { parent: faceGroup, at: [0, stageY + STAGE_H / 2, 0] },
    stageRight: { parent: faceGroup, at: [STAGE_W / 2, stageY, 0] },
    stageLeft: { parent: faceGroup, at: [-STAGE_W / 2, stageY, 0] },
    deck: { parent: base, at: [0, up(12.9 + DECK_H / 2), 0] },
    deckRight: { parent: base, at: [DECK_W / 2, up(12.9 + DECK_H / 2), 0] },
    deckLeft: { parent: base, at: [-DECK_W / 2, up(12.9 + DECK_H / 2), 0] },
    dpad: { parent: base, at: [-55.5, up(31.5), 1] },
    stick: { parent: base, at: [-57.0, up(60.0), 3] },
    abxy: { parent: base, at: [...faceCenter, 1] },
    select: { parent: base, at: [-46.4, up(76.4), 1] },
    start: { parent: base, at: [46.4, up(76.4), 1] },
    L1: { parent: base, at: [-63.2, y1, -3.4] },
    R1: { parent: base, at: [63.2, y1, -3.4] },
    L2: { parent: base, at: [-62, y1, -BASE_T] },
    R2: { parent: base, at: [62, y1, -BASE_T] },
    hinge: { parent: body, at: [0, 0, BARREL_R] },
  };
  // the same frame as the RG DS Plus's, so the two stand at one scale
  return { base, lidPivot, stage, deck, anchors, shoulderMats, ringMats, fit: { h: 196, w: 184 }, deckSize: { w: DECK_W, h: DECK_H } };
}
