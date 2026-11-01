// The RG DS Plus as a procedural three.js model, in millimetres, measured from
// Anbernic's front and side drawings: 167 × 96 × 24 mm closed, 181 mm tall
// open, two 4.3-inch 4:3 panels, a free-stop hinge from 15 to 180 degrees.
//
//   const device = createDevice(host, { color: "black" });
//   device.show("/shots/home-top.webp", "/shots/home-bottom.webp");
//   device.pose({ yaw: -18, pitch: -48, lid: 118 }, { ms: 900 });
//
// The origin is the hinge's axis, X runs along the hinge, +Y points away from
// the player on the base, +Z leaves the base's face. A lid of 0 is closed, 180
// is flat open.
import * as THREE from "./three.module.min.js";

export const COLORWAYS = {
  black: { body: 0x17181c, rim: 0x2a2c33, frame: 0x24262c, keys: 0x0c0d10, cap: 0x1a1b20, ink: 0xdfe2ea, metal: 0.25, rough: 0.46, coat: 0.25, env: 0.58 },
  blue: { body: 0x2c2f6e, rim: 0x4e52a8, frame: 0x3f4396, keys: 0x24265c, cap: 0x2a2c66, ink: 0xe8eaff, metal: 0.72, rough: 0.34, coat: 0.65 },
  pink: { body: 0xf0bdb8, rim: 0xf7d2cd, frame: 0xf4cac5, keys: 0xeab2ad, cap: 0xf2c3be, ink: 0x8d5a58, metal: 0.05, rough: 0.5, coat: 0.3 },
};

const W = 167, BASE_H = 96, BASE_T = 13, LID_T = 11, HINGE_Y = 90.2, HINGE_R = 5.35, LID_REACH = 90.5;
const SCREEN_W = 87.4, SCREEN_H = 65.5;
const baseY = (fromTop) => BASE_H - fromTop - HINGE_Y; // distance below the base's far edge → model Y
const lidY = (fromFree) => -LID_REACH + fromFree;     // distance from the lid's free edge → lid-local Y

const DEFAULT_POSE = { yaw: 0, pitch: 0, spin: 0, lid: 180, zoom: 1, cx: 0, cy: 0, cz: 0, ox: 0, oy: 0, gap: 0 };

function rrect(x0, y0, x1, y1, r) {
  const [rbl, rbr, rtr, rtl] = Array.isArray(r) ? r : [r, r, r, r];
  const s = new THREE.Shape();
  s.moveTo(x0 + rbl, y0);
  s.lineTo(x1 - rbr, y0); s.absarc(x1 - rbr, y0 + rbr, rbr, -Math.PI / 2, 0);
  s.lineTo(x1, y1 - rtr); s.absarc(x1 - rtr, y1 - rtr, rtr, 0, Math.PI / 2);
  s.lineTo(x0 + rtl, y1); s.absarc(x0 + rtl, y1 - rtl, rtl, Math.PI / 2, Math.PI);
  s.lineTo(x0, y0 + rbl); s.absarc(x0 + rbl, y0 + rbl, rbl, Math.PI, Math.PI * 1.5);
  return s;
}
const holePath = (shape) => new THREE.Path(shape.getPoints(24).reverse());

function extrude(shape, depth, bevel = 0, segs = 3, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2), curveSegments: curve,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: segs,
  });
  g.translate(0, 0, bevel);
  return g;
}

function lathe(profile, segments = 48) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2); // lathe axis Y → Z
  return g;
}

function textTexture(text, { px = 96, color = "#fff", weight = 600, family = "ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif", w, h = px * 1.3, track = 0 } = {}) {
  const c = document.createElement("canvas");
  const measure = c.getContext("2d");
  measure.font = `${weight} ${px}px ${family}`;
  c.width = w ?? Math.ceil(measure.measureText(text).width + track * text.length + px * 0.4);
  c.height = Math.ceil(h);
  const x = c.getContext("2d");
  x.font = `${weight} ${px}px ${family}`;
  x.fillStyle = color; x.textAlign = "center"; x.textBaseline = "middle";
  if (track && "letterSpacing" in x) x.letterSpacing = `${track}px`;
  x.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, aspect: c.width / c.height };
}

function label(text, heightMm, opts) {
  const { texture, aspect } = textTexture(text, opts);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(heightMm * aspect, heightMm),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: opts?.opacity ?? 1 }),
  );
}

/** An environment of soft boxes on a dark room: the shell's reflections, tintable per page. */
function buildEnvironment(renderer, env = {}) {
  const { sky = 0x2c2e3a, floor = 0x08080c, key = 0xffffff, fill = 0x8fa4ff, accent = 0xff6aa0, strength = 1, front = 1 } = env;
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { a: { value: new THREE.Color(sky) }, b: { value: new THREE.Color(floor) } },
      vertexShader: "varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
      fragmentShader: "varying vec3 p; uniform vec3 a,b; void main(){ gl_FragColor = vec4(mix(b,a,smoothstep(-.6,.8,p.y)),1.); }",
    }),
  );
  scene.add(room);
  const box = (color, power, w, h, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power * strength), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); scene.add(m);
  };
  box(0xffffff, 0.5 * front, 90, 70, [0, 6, 46]);
  box(key, 3.4, 30, 14, [-14, 34, 18]);
  box(key, 4, 8, 40, [34, 8, 12]);
  box(fill, 2.6, 18, 30, [-36, -2, 8]);
  box(accent, 0.8, 30, 8, [10, -26, 30]);
  box(key, 3, 40, 6, [0, 10, -38]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  return rt.texture;
}

const screenVert = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }";
const screenFrag = `
  varying vec2 vUv; uniform sampler2D a, b; uniform float t, power; uniform vec4 uvA;
  void main(){
    vec3 c = mix(texture2D(a, vUv * uvA.xy + uvA.zw).rgb, texture2D(b, vUv).rgb, t);
    gl_FragColor = vec4(c * power, 1.);
    #include <colorspace_fragment>
  }`;

export function createDevice(host, options = {}) {
  const { color = "black", env = {}, fov = 24, exposure = 1.05, margin = 1.1, shadows = true, drag = true, tilt = 0, press = true, transparent = true, deckTouch = false, glassLevel = 0.16 } = options;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display:block;width:100%;height:100%;touch-action:${deckTouch ? "none" : "pan-y"};outline:none`;
  host.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, powerPreference: "high-performance" });
  } catch (err) {
    canvas.remove();
    host.classList.add("no-webgl");
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer, env);
  const camera = new THREE.PerspectiveCamera(fov, 1, 20, 4000);

  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-120, 260, 300);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.25; sun.shadow.radius = 5;
  Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 20, far: 900 });
  scene.add(sun, sun.target);

  const rig = new THREE.Group();   // pointer tilt and pose rotation
  const body = new THREE.Group();  // recentres on the pose's focus
  rig.add(body); scene.add(rig);

  // ---------- materials ----------
  const cw = COLORWAYS[color] ?? COLORWAYS.black;
  const shellProps = { metalness: cw.metal, roughness: cw.rough, clearcoat: cw.coat, clearcoatRoughness: 0.32 };
  const M = {
    shell: new THREE.MeshPhysicalMaterial({ color: cw.body, ...shellProps, envMapIntensity: cw.env ?? 1 }),
    rim: new THREE.MeshPhysicalMaterial({ color: cw.rim, ...shellProps, roughness: Math.max(0.18, cw.rough - 0.12) }),
    frame: new THREE.MeshPhysicalMaterial({ color: cw.frame, ...shellProps, envMapIntensity: cw.env ?? 1 }),
    keys: new THREE.MeshPhysicalMaterial({ color: cw.keys, metalness: 0.15, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.28 }),
    cap: new THREE.MeshPhysicalMaterial({ color: cw.cap, ...shellProps, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.75, metalness: 0 }),
    glassBlack: new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.16, metalness: 0.4 }),
    ink: new THREE.MeshBasicMaterial({ color: cw.ink }),
  };
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.09, metalness: 0, reflectivity: 0.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: glassLevel });
  const add = (parent, geo, mat, cast = true, receive = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m);
    return m;
  };
  const inkColor = `#${new THREE.Color(cw.ink).getHexString()}`;

  // ---------- base ----------
  const base = new THREE.Group();
  base.position.set(0, 0, -HINGE_R);
  body.add(base);
  const y0 = -HINGE_Y, y1 = BASE_H - HINGE_Y;
  add(base, extrude(rrect(-W / 2, y0, W / 2, y1, [8, 8, 2.6, 2.6]), BASE_T, 1.1, 4), M.shell).position.z = -BASE_T;

  // the channel the panel's frame sits in, and its two grooves
  const channelX = W / 2 - 32;
  add(base, extrude(rrect(-channelX, y0 + 1.2, channelX, baseY(10.8), 1.4), 0.12), M.frame, false).position.z = -0.02;
  for (const side of [-1, 1]) {
    add(base, new THREE.PlaneGeometry(0.9, baseY(10.8) - y0 - 2), M.dark, false).position.set(side * (channelX + 0.5), (baseY(10.8) + y0 + 1.2) / 2, 0.015);
    add(base, new THREE.PlaneGeometry(0.5, baseY(10.8) - y0 - 2), M.rim, false).position.set(side * (channelX + 1.2), (baseY(10.8) + y0 + 1.2) / 2, 0.015);
  }

  const panel = (parent, cy, zFace, flip) => {
    const frameW = SCREEN_W + 8.2, frameH = SCREEN_H + 8.2;
    const fr = rrect(-frameW / 2, cy - frameH / 2, frameW / 2, cy + frameH / 2, 1.3);
    fr.holes.push(holePath(rrect(-SCREEN_W / 2 - 0.8, cy - SCREEN_H / 2 - 0.8, SCREEN_W / 2 + 0.8, cy + SCREEN_H / 2 + 0.8, 0.5)));
    const frame = add(parent, extrude(fr, 0.32, 0.1, 2), M.rim, false);
    frame.position.z = zFace;
    const black = add(parent, new THREE.PlaneGeometry(SCREEN_W + 1.8, SCREEN_H + 1.8), M.glassBlack, false);
    black.position.set(0, cy, zFace + 0.03);
    const uniforms = { a: { value: null }, b: { value: null }, t: { value: 0 }, power: { value: 1 }, uvA: { value: new THREE.Vector4(1, 1, 0, 0) } };
    const screen = add(parent, new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.ShaderMaterial({ uniforms, vertexShader: screenVert, fragmentShader: screenFrag, toneMapped: false }), false, false);
    screen.position.set(0, cy, zFace + 0.05);
    const cover = add(parent, new THREE.PlaneGeometry(SCREEN_W + 1.8, SCREEN_H + 1.8), glass, false, false);
    cover.position.set(0, cy, zFace + 0.07);
    cover.renderOrder = 2;
    return { uniforms, screen };
  };
  const deck = panel(base, baseY(18) - SCREEN_H / 2, 0.1);
  deck.screen.userData.hit = "deck";

  // ---------- controls ----------
  const buttons = new Map();
  const reg = (name, group, travel = 0.5) => { group.userData.btn = name; group.traverse((o) => (o.userData.btn = name)); buttons.set(name, { group, rest: group.position.clone(), travel, t: 0, goal: 0 }); return group; };

  // D-pad, one cross, four named zones
  const dpad = new THREE.Group();
  const a = 11.2, b = 3.75, cross = new THREE.Shape();
  [[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]].forEach(([x, y], i) => (i ? cross.lineTo(x, y) : cross.moveTo(x, y)));
  cross.closePath();
  add(dpad, extrude(cross, 1.5, 0.38, 3, 2), M.keys);
  for (const [x, y, w, h] of [[-7.4, 0, 3, 0.45], [7.4, 0, 3, 0.45], [0, 7.4, 0.45, 3], [0, -7.4, 0.45, 3]])
    add(dpad, new THREE.PlaneGeometry(w, h), M.ink, false, false).position.set(x, y, 1.51);
  dpad.position.set(-W / 2 + 17, baseY(31), 0);
  base.add(reg("DPAD", dpad, 0.4));

  // the stick: a dished well, a stem, a cap
  const stickPos = [-W / 2 + 17, baseY(58.9)];
  add(base, lathe([[12.4, 0.0], [12.0, 0.42], [11.2, 0.52], [10.2, 0.28], [9.0, -0.02]]), M.rim, false).position.set(...stickPos, 0);
  add(base, new THREE.CircleGeometry(9.1, 48), M.dark, false, false).position.set(...stickPos, 0.01);
  const stick = new THREE.Group();
  add(stick, new THREE.CylinderGeometry(3.6, 4.2, 2.4, 24).rotateX(Math.PI / 2), M.dark).position.z = 1.2;
  add(stick, lathe([[0, 3.3], [2.8, 3.55], [5.0, 3.7], [6.4, 3.25], [6.75, 2.6], [6.3, 1.9], [3.5, 1.7]]), M.cap);
  stick.position.set(...stickPos, 0);
  base.add(reg("STICK", stick, 0.5));

  // ABXY
  const round = (r, h) => lathe([[0, h], [r - 0.7, h], [r - 0.25, h - 0.12], [r, h - 0.5], [r, 0]]);
  const abxyCenter = [W / 2 - 16.3, baseY(39)];
  for (const [name, dx, dy] of [["X", 0, 8.2], ["B", 0, -8.2], ["Y", -8.2, 0], ["A", 8.2, 0]]) {
    const g = new THREE.Group();
    add(g, round(4, 1.6), M.keys);
    const l = label(name, 5.2, { px: 110, color: inkColor, weight: 500 });
    l.position.z = 1.62;
    g.add(l);
    g.position.set(abxyCenter[0] + dx, abxyCenter[1] + dy, 0);
    base.add(reg(name, g));
    add(base, lathe([[4.7, 0.0], [4.3, 0.1], [4.05, 0.02]]), M.rim, false).position.set(g.position.x, g.position.y, 0);
  }

  // START and SELECT, on the right; HOME and MENU, under the stick
  for (const [name, x, y] of [["START", W / 2 - 24.6, baseY(71.9)], ["SELECT", W / 2 - 24.6, baseY(81.8)]]) {
    const g = new THREE.Group();
    add(g, lathe([[0, 1.1], [1.6, 1.0], [2.5, 0.55], [2.6, 0]]), M.cap);
    g.position.set(x, y, 0);
    base.add(reg(name, g, 0.35));
    const l = label(name, 1.7, { px: 72, color: inkColor, weight: 500, opacity: 0.55, track: 4 });
    l.geometry.translate(l.geometry.parameters.width / 2, 0, 0);
    l.position.set(x + 3.6, y, 0.02);
    base.add(l);
  }
  for (const [name, x] of [["FN1", -W / 2 + 10.8], ["FN2", -W / 2 + 23]]) {
    const g = new THREE.Group();
    add(g, round(4, 0.9), M.cap);
    g.position.set(x, baseY(81.8), 0);
    base.add(reg(name, g, 0.3));
  }

  // the hinge's two knuckles on the base
  for (const side of [-1, 1]) {
    const cyl = lathe([[0, -8.7], [3.9, -8.7], [4.9, -8.3], [5.3, -7.4], [HINGE_R, -6.6], [HINGE_R, 6.6], [5.3, 7.4], [4.9, 8.3], [3.9, 8.7], [0, 8.7]]).rotateY(Math.PI / 2);
    add(body, cyl, M.shell).position.set(side * (W / 2 - 9.9), 0, 0);
    // the block that carries it
    const block = new THREE.BoxGeometry(17.6, y1 + 0.2, HINGE_R);
    add(body, block, M.shell).position.set(side * (W / 2 - 9.9), (y1 + 0.2) / 2 - 0.1, -HINGE_R / 2);
  }
  // shoulders on the far edge: L1/R1 over L2/R2; a held one lights
  const shoulderMats = [];
  for (const [name, side, z] of [["L1", -1, -3.9], ["R1", 1, -3.9], ["L2", -1, -8.7], ["R2", 1, -8.7]]) {
    const g = new THREE.Group();
    const s = rrect(-14, -2.1, 14, 2.1, 1.6);
    const lit = M.keys.clone();
    lit.emissive.set(options.shoulderGlow ?? 0xff5f9e);
    lit.emissiveIntensity = 0;
    shoulderMats.push(lit);
    const m = add(g, extrude(s, 2.3, 0.45, 3, 8), lit);
    m.rotation.x = -Math.PI / 2;
    m.userData.glow = lit;
    g.position.set(side * (W / 2 - 22), y1 - 0.4, z);
    base.add(reg(name, g, 0.7));
    buttons.get(name).glow = lit;
  }
  // ports and small parts on the edges
  add(base, new THREE.CylinderGeometry(1.8, 1.8, 0.3, 24), M.dark, false).position.set(W / 2 - 20, y0 - 0.02, -6.5);
  for (const [x, w] of [[-W / 2 + 20, 16], [W / 2 - 42, 8]]) {
    const pill = add(base, extrude(rrect(-w / 2, -1.2, w / 2, 1.2, 1.1), 0.3), x < 0 ? M.keys : M.dark, false);
    pill.rotation.x = Math.PI / 2;
    pill.position.set(x, y0 + 0.2, -6.5);
  }
  for (const [x, w] of [[-14, 9], [14, 4], [0, 11]]) {
    const port = add(base, extrude(rrect(-w / 2, -1.1, w / 2, 1.1, 1), 0.3), M.dark, false);
    port.rotation.x = -Math.PI / 2;
    port.position.set(x, y1 - 0.15, -6.5);
  }
  for (const side of [-1, 1]) {
    for (const off of [0, 5.2]) {
      const tick = add(base, new THREE.BoxGeometry(0.3, 2.2, 3), M.dark, false);
      tick.position.set(side * (W / 2 + 0.03), baseY(23.7 + off), -6);
    }
  }
  const mic = add(body, new THREE.PlaneGeometry(0.75, 3.1), M.dark, false, false);
  mic.position.set(0, -HINGE_R + 0.15, HINGE_R * 0.25);

  // ---------- lid ----------
  const lidPivot = new THREE.Group();
  body.add(lidPivot);
  const lid = new THREE.Group();
  lid.position.z = 0;
  lidPivot.add(lid);
  const fz = -HINGE_R + 0.05; // the lid's inner face, in closed coordinates
  const lidShape = () => rrect(-W / 2, -LID_REACH, W / 2, -HINGE_R + 0.2, [8.4, 8.4, 1.2, 1.2]);
  const lidBody = add(lid, extrude(lidShape(), LID_T, 1.1, 4), M.shell);
  lidBody.position.z = fz;
  // the raised rim around the inner face
  const rimShape = lidShape();
  rimShape.holes.push(holePath(rrect(-W / 2 + 2.7, -LID_REACH + 2.7, W / 2 - 2.7, -HINGE_R - 0.8, [5.8, 5.8, 0.8, 0.8])));
  const rim = add(lid, extrude(rimShape, 0.75, 0.25, 3), M.rim);
  rim.position.z = fz - 0.55;
  // the centre knuckle
  const lidBarrel = add(lid, new THREE.CylinderGeometry(HINGE_R - 0.1, HINGE_R - 0.1, W - 2 * 18.2, 40).rotateZ(Math.PI / 2), M.shell);
  lidBarrel.position.set(0, 0, 0);
  add(lid, new THREE.BoxGeometry(W - 2 * 18.2, HINGE_R + 0.5, LID_T - 0.4), M.shell).position.set(0, -HINGE_R / 2 - 0.1, LID_T / 2 - HINGE_R + 0.2);

  const faceGroup = new THREE.Group();
  faceGroup.position.z = fz - 0.001;
  faceGroup.rotation.x = Math.PI; // the panel looks at -Z in closed coordinates; screen-up → free edge
  lid.add(faceGroup);
  const stage = panel(faceGroup, -lidY(11.1 + SCREEN_H / 2), 0.02);
  stage.screen.userData.hit = "stage";
  // speakers: seven holes round one
  const hole = new THREE.CircleGeometry(0.46, 12);
  for (const side of [-1, 1]) {
    const cx = side * (W / 2 - 18.9), cy = -lidY(42.4);
    const pts = [[0, 0]];
    for (let i = 0; i < 7; i++) pts.push([Math.cos((i / 7) * Math.PI * 2 + 0.45) * 4.3, Math.sin((i / 7) * Math.PI * 2 + 0.45) * 4.3]);
    for (const [x, y] of pts) add(faceGroup, hole, M.dark, false, false).position.set(cx + x, cy + y, 0.02);
    for (const fromFree of [15, 76])
      add(faceGroup, extrude(rrect(-1.8, -1.8, 1.8, 1.8, 0.6), 0.12), M.rim, false).position.set(side * (W / 2 - 16.6), -lidY(fromFree), 0.005);
  }

  // ---------- pose and framing ----------
  const state = { ...DEFAULT_POSE };
  const from = { ...state }, to = { ...state };
  let tween = null, dragYaw = 0, dragPitch = 0, tiltX = 0, tiltY = 0, tiltGoalX = 0, tiltGoalY = 0, dragGoalYaw = 0, dragGoalPitch = 0, dirty = true;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rad = THREE.MathUtils.degToRad;
  let width = 1, height = 1;

  const applyPose = () => {
    rig.rotation.set(rad(state.pitch + dragPitch + tiltY), rad(state.yaw + dragYaw + tiltX), rad(state.spin), "YXZ");
    body.position.set(-state.cx, -state.cy, -state.cz);
    lidPivot.rotation.x = -rad(state.lid);
    lidPivot.position.y = state.gap;
    const power = THREE.MathUtils.smoothstep(state.lid, 10, 24) * awake;
    deck.uniforms.power.value = stage.uniforms.power.value = power;
    // fit a 181 mm tall, 167 mm wide object; narrow views fit its width
    const halfV = Math.tan(rad(fov / 2));
    const aspect = width / height;
    const h = 196 * margin, w = 184 * margin;
    const dist = Math.max(h / 2 / halfV, w / 2 / halfV / aspect) / Math.max(0.05, state.zoom);
    camera.position.set(0, 0, dist);
    camera.near = Math.max(1, dist - 420); camera.far = dist + 520;
    camera.aspect = aspect;
    camera.setViewOffset(width, height, -state.ox * width, -state.oy * height, width, height);
    camera.updateProjectionMatrix();
    dirty = true;
  };

  let awake = 1;

  const resize = () => {
    const r = host.getBoundingClientRect();
    width = Math.max(1, r.width); height = Math.max(1, r.height);
    renderer.setSize(width, height, false);
    applyPose();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // ---------- textures ----------
  const loader = new THREE.TextureLoader();
  const cache = new Map();
  const load = (url) => {
    if (!cache.has(url)) {
      cache.set(url, new Promise((res, rej) => loader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        renderer.initTexture(t);
        res(t);
      }, undefined, rej)));
    }
    return cache.get(url);
  };
  const fades = [];
  let videoTexture = null;
  const setPanel = async (p, url, ms) => {
    const t = await load(url);
    if (videoTexture) return;
    p.token = (p.token || 0) + 1;
    const mine = p.token;
    if (!p.uniforms.a.value || ms <= 0 || reduce) {
      p.uniforms.a.value = t; p.uniforms.b.value = t; p.uniforms.t.value = 0; dirty = true;
      return;
    }
    p.uniforms.b.value = t; p.uniforms.t.value = 0;
    fades.push({ p, t, mine, start: performance.now(), ms });
    dirty = true;
  };

  // ---------- input ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const listeners = { press: [], release: [], panel: [], hover: [], touch: [] };
  const pick = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(rig, true);
    for (const h of hits) {
      if (h.object.userData.btn) {
        const name = h.object.userData.btn;
        const local = buttons.get(name).group.worldToLocal(h.point.clone());
        return { btn: name, point: h.point, local };
      }
      if (h.object.userData.hit) return { panel: h.object.userData.hit, uv: h.uv, point: h.point };
      if (h.object.material !== glass) return null;
    }
    return null;
  };
  // where a pointer meets the deck's plane, clamped to the panel: a finger that
  // slides off the glass stays a contact at the edge
  const deckPlane = new THREE.Plane(), planePoint = new THREE.Vector3(), planeNormal = new THREE.Vector3();
  const deckUv = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    deck.screen.getWorldPosition(planePoint);
    planeNormal.set(0, 0, 1).transformDirection(deck.screen.matrixWorld);
    deckPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
    const at = raycaster.ray.intersectPlane(deckPlane, new THREE.Vector3());
    if (!at) return null;
    deck.screen.worldToLocal(at);
    return { x: Math.min(1, Math.max(0, at.x / SCREEN_W + 0.5)), y: Math.min(1, Math.max(0, at.y / SCREEN_H + 0.5)) };
  };
  const heldButtons = new Map(), touching = new Set();
  let downAt = null;
  const pressBtn = (name, down = true) => { const b = buttons.get(name); if (b) { b.goal = down ? 1 : 0; dirty = true; } };

  canvas.addEventListener("pointerdown", (ev) => {
    const hit = press ? pick(ev) : null;
    if (hit?.btn) {
      heldButtons.set(ev.pointerId, hit.btn);
      pressBtn(hit.btn, true);
      canvas.setPointerCapture(ev.pointerId);
      listeners.press.forEach((f) => f(hit.btn, hit.local));
      ev.preventDefault();
      return;
    }
    if (hit?.panel) listeners.panel.forEach((f) => f(hit.panel, hit.uv));
    if (deckTouch && hit?.panel === "deck") {
      touching.add(ev.pointerId);
      canvas.setPointerCapture(ev.pointerId);
      const uv = deckUv(ev);
      if (uv) listeners.touch.forEach((f) => f("down", ev.pointerId, uv));
      ev.preventDefault();
      return;
    }
    if (drag) { downAt = { x: ev.clientX, y: ev.clientY, yaw: dragGoalYaw, pitch: dragGoalPitch }; canvas.setPointerCapture(ev.pointerId); canvas.style.cursor = "grabbing"; }
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (touching.has(ev.pointerId)) {
      const uv = deckUv(ev);
      if (uv) listeners.touch.forEach((f) => f("move", ev.pointerId, uv));
      return;
    }
    if (downAt) {
      dragGoalYaw = THREE.MathUtils.clamp(downAt.yaw + (ev.clientX - downAt.x) * 0.35, -70, 70);
      dragGoalPitch = THREE.MathUtils.clamp(downAt.pitch + (ev.clientY - downAt.y) * 0.25, -40, 40);
      dirty = true;
      return;
    }
    if (press && ev.pointerType === "mouse" && !heldButtons.size) {
      const hit = pick(ev);
      canvas.style.cursor = hit?.btn || (deckTouch && hit?.panel === "deck") ? "pointer" : drag ? "grab" : "default";
      listeners.hover.forEach((f) => f(hit?.btn ?? null));
    }
  });
  const up = (ev) => {
    const name = heldButtons.get(ev.pointerId);
    if (name) { heldButtons.delete(ev.pointerId); pressBtn(name, false); listeners.release.forEach((f) => f(name)); }
    if (touching.delete(ev.pointerId)) listeners.touch.forEach((f) => f("up", ev.pointerId));
    if (downAt) { downAt = null; canvas.style.cursor = drag ? "grab" : "default"; if (options.springBack) { dragGoalYaw = 0; dragGoalPitch = 0; dirty = true; } }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.style.cursor = drag ? "grab" : "default";

  const onWinMove = tilt ? (ev) => {
    tiltGoalX = ((ev.clientX / innerWidth) * 2 - 1) * tilt;
    tiltGoalY = ((ev.clientY / innerHeight) * 2 - 1) * tilt * 0.6;
  } : null;
  if (onWinMove && !reduce) addEventListener("pointermove", onWinMove, { passive: true });

  // ---------- loop ----------
  let visible = true, running = false, raf = 0;
  const follow = (cur, goal, k) => { const d = goal - cur; return Math.abs(d) < 0.002 ? goal : cur + d * k; };
  const frame = (now) => {
    raf = 0;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.ms);
      const e = tween.ease(t);
      for (const k in to) state[k] = from[k] + (to[k] - from[k]) * e;
      if (t >= 1) { const done = tween.done; tween = null; done?.(); }
      applyPose();
    }
    const nx = follow(tiltX, tiltGoalX, 0.08), ny = follow(tiltY, tiltGoalY, 0.08);
    const dy = follow(dragYaw, dragGoalYaw, 0.2), dp = follow(dragPitch, dragGoalPitch, 0.2);
    if (nx !== tiltX || ny !== tiltY || dy !== dragYaw || dp !== dragPitch) { tiltX = nx; tiltY = ny; dragYaw = dy; dragPitch = dp; applyPose(); }
    for (const b of buttons.values()) {
      if (b.t !== b.goal) {
        b.t = follow(b.t, b.goal, 0.45);
        b.group.position.copy(b.rest);
        if (b.group.userData.btn?.[0] === "L" || b.group.userData.btn?.[0] === "R") b.group.position.y -= b.t * b.travel;
        else b.group.position.z -= b.t * b.travel;
        if (b.glow) b.glow.emissiveIntensity = b.t * 1.5;
        dirty = true;
      }
    }
    for (let i = fades.length - 1; i >= 0; i--) {
      const f = fades[i];
      if (f.p.token !== f.mine) { fades.splice(i, 1); continue; }
      const t = Math.min(1, (now - f.start) / f.ms);
      f.p.uniforms.t.value = t;
      if (t >= 1) { f.p.uniforms.a.value = f.t; f.p.uniforms.t.value = 0; fades.splice(i, 1); }
      dirty = true;
    }
    if (videoTexture) dirty = true;
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
      listeners.frame?.forEach((f) => f());
    }
    if (running) raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
  const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }, { rootMargin: "120px" });
  io.observe(host);
  resize();
  start();

  // ---------- anchors: model points projected to the host's pixels ----------
  const ANCHORS = {
    stage: { parent: faceGroup, at: [0, -lidY(11.1 + SCREEN_H / 2), 0] },
    stageTop: { parent: faceGroup, at: [0, -lidY(11.1), 0] },
    stageRight: { parent: faceGroup, at: [SCREEN_W / 2, -lidY(11.1 + SCREEN_H / 2), 0] },
    stageLeft: { parent: faceGroup, at: [-SCREEN_W / 2, -lidY(11.1 + SCREEN_H / 2), 0] },
    deck: { parent: base, at: [0, baseY(18 + SCREEN_H / 2), 0] },
    deckRight: { parent: base, at: [SCREEN_W / 2, baseY(18 + SCREEN_H / 2), 0] },
    deckLeft: { parent: base, at: [-SCREEN_W / 2, baseY(18 + SCREEN_H / 2), 0] },
    dpad: { parent: base, at: [-W / 2 + 17, baseY(31), 1] },
    stick: { parent: base, at: [-W / 2 + 17, baseY(58.9), 3] },
    abxy: { parent: base, at: [W / 2 - 16.3, baseY(39), 1] },
    select: { parent: base, at: [W / 2 - 24.6, baseY(81.8), 1] },
    start: { parent: base, at: [W / 2 - 24.6, baseY(71.9), 1] },
    L1: { parent: base, at: [-W / 2 + 22, y1, -3.9] },
    R1: { parent: base, at: [W / 2 - 22, y1, -3.9] },
    L2: { parent: base, at: [-W / 2 + 22, y1, -8.7] },
    R2: { parent: base, at: [W / 2 - 22, y1, -8.7] },
    hinge: { parent: body, at: [0, 0, HINGE_R] },
  };
  const v = new THREE.Vector3();
  const anchor = (name) => {
    const a = ANCHORS[name];
    if (!a) return null;
    rig.updateWorldMatrix(true, true);
    camera.updateMatrixWorld();
    v.set(...a.at);
    a.parent.localToWorld(v);
    v.project(camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  };

  return {
    canvas, buttons: [...buttons.keys()],
    /** Move to a pose; numbers left out keep their value. */
    pose(next, { ms = 900, easing = ease, done } = {}) {
      Object.assign(from, state);
      Object.assign(to, state, next);
      if (ms <= 0 || reduce) { Object.assign(state, to); tween = null; applyPose(); done?.(); return; }
      tween = { start: performance.now(), ms, ease: easing, done };
      dirty = true;
    },
    /** Set a pose this frame; for scroll-driven pages. */
    set(next) { tween = null; Object.assign(state, next); applyPose(); },
    get state() { return { ...state }; },
    /** Put a capture on both panels. */
    show(top, bottom, { ms = 420 } = {}) { if (top) setPanel(stage, top, ms); if (bottom) setPanel(deck, bottom, ms); },
    preload(urls) { return Promise.all(urls.map(load)); },
    /** Live 2D canvases on the panels; refresh() uploads what changed. */
    useCanvases(top, bottom) {
      const bind = (p, source) => {
        const t = new THREE.CanvasTexture(source);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        p.token = (p.token || 0) + 1;
        p.uniforms.a.value = t; p.uniforms.b.value = t; p.uniforms.t.value = 0;
        return t;
      };
      const textures = [bind(stage, top), bind(deck, bottom)];
      dirty = true;
      return (changedTop, changedBottom) => {
        if (changedTop) textures[0].needsUpdate = true;
        if (changedBottom) textures[1].needsUpdate = true;
        if (changedTop || changedBottom) dirty = true;
      };
    },
    /** One video of both panels, top over bottom, in place of the captures. */
    playVideo(video) {
      if (videoTexture) return;
      videoTexture = new THREE.VideoTexture(video);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      videoTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      for (const [p, y] of [[stage, 0.5], [deck, 0]]) {
        p.keep = p.uniforms.a.value;
        p.token = (p.token || 0) + 1;
        p.uniforms.a.value = videoTexture; p.uniforms.t.value = 0;
        p.uniforms.uvA.value.set(1, 0.5, 0, y);
      }
    },
    stopVideo() {
      if (!videoTexture) return;
      for (const p of [stage, deck]) { p.uniforms.a.value = p.keep; p.uniforms.uvA.value.set(1, 1, 0, 0); }
      videoTexture.dispose(); videoTexture = null; dirty = true;
    },
    /** Rocks the D-pad toward a direction ("LEFT", "RIGHT", "UP", "DOWN"), or back. */
    dpad(direction) {
      const g = buttons.get("DPAD").group;
      const tilt = 0.14;
      g.rotation.set(direction === "UP" ? -tilt : direction === "DOWN" ? tilt : 0, direction === "LEFT" ? -tilt : direction === "RIGHT" ? tilt : 0, 0);
      dirty = true;
    },
    press: pressBtn,
    /** A button pressed or released from outside the canvas, as a finger on the model would. */
    hold(name, down) { pressBtn(name, down); (down ? listeners.press : listeners.release).forEach((f) => f(name)); },
    tap(name, ms = 160) { pressBtn(name, true); setTimeout(() => pressBtn(name, false), ms); },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    anchor,
    /** A point in the model's coordinates, projected to the host's pixels. */
    project(x, y, z) {
      rig.updateWorldMatrix(true, true);
      camera.updateMatrixWorld();
      v.set(x, y, z);
      body.localToWorld(v);
      v.project(camera);
      return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
    },
    /** Change the colourway in place. */
    setColor(name) {
      const c = COLORWAYS[name];
      if (!c) return;
      const shell = { metalness: c.metal, roughness: c.rough, clearcoat: c.coat };
      Object.assign(M.shell, shell); M.shell.color.set(c.body);
      Object.assign(M.rim, shell, { roughness: Math.max(0.18, c.rough - 0.12) }); M.rim.color.set(c.rim);
      Object.assign(M.frame, shell); M.frame.color.set(c.frame);
      Object.assign(M.cap, shell, { roughness: 0.3 }); M.cap.color.set(c.cap);
      M.keys.color.set(c.keys); M.ink.color.set(c.ink);
      for (const m of shoulderMats) m.color.set(c.keys);
      M.shell.envMapIntensity = M.frame.envMapIntensity = c.env ?? 1;
      dirty = true;
    },
    setAwake(v) { awake = v; applyPose(); },
    resetDrag() { dragGoalYaw = 0; dragGoalPitch = 0; dirty = true; },
    dispose() { stop(); io.disconnect(); ro.disconnect(); renderer.dispose(); canvas.remove(); if (onWinMove) removeEventListener("pointermove", onWinMove); },
  };
}

export function lerpPose(a, b, t) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = (a[k] ?? b[k]) + ((b[k] ?? a[k]) - (a[k] ?? b[k])) * t;
  return out;
}
