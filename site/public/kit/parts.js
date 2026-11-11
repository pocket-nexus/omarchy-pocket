// Geometry helpers the machines' models share (kit/rgds.js, kit/thor.js):
// rounded rectangles, extrusions with a bevel, lathed profiles, and text
// labels rendered to textures. Millimetres throughout.
import * as THREE from "./three.module.min.js";

export function rrect(x0, y0, x1, y1, r) {
  const [rbl, rbr, rtr, rtl] = Array.isArray(r) ? r : [r, r, r, r];
  const s = new THREE.Shape();
  s.moveTo(x0 + rbl, y0);
  s.lineTo(x1 - rbr, y0); s.absarc(x1 - rbr, y0 + rbr, rbr, -Math.PI / 2, 0);
  s.lineTo(x1, y1 - rtr); s.absarc(x1 - rtr, y1 - rtr, rtr, 0, Math.PI / 2);
  s.lineTo(x0 + rtl, y1); s.absarc(x0 + rtl, y1 - rtl, rtl, Math.PI / 2, Math.PI);
  s.lineTo(x0, y0 + rbl); s.absarc(x0 + rbl, y0 + rbl, rbl, Math.PI, Math.PI * 1.5);
  return s;
}
export const holePath = (shape) => new THREE.Path(shape.getPoints(24).reverse());

export function extrude(shape, depth, bevel = 0, segs = 3, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2), curveSegments: curve,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: segs,
  });
  g.translate(0, 0, bevel);
  return g;
}

export function lathe(profile, segments = 48) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2); // lathe axis Y → Z
  return g;
}

export function textTexture(text, { px = 96, color = "#fff", weight = 600, family = "ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif", w, h = px * 1.3, track = 0 } = {}) {
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

export function label(text, heightMm, opts) {
  const { texture, aspect } = textTexture(text, opts);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(heightMm * aspect, heightMm),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: opts?.opacity ?? 1 }),
  );
}
