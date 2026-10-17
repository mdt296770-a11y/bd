// Procedural 3D sunglasses. The glasses face +z, temples run back along -z.
// Total width is about 2.3 units, so callers just scale the returned group.
import * as THREE from 'three';

// Lens outlines as closed control polygons (x right, y up). A closed Catmull-Rom
// spline through them gives smooth, believable lens shapes without any assets.
const OUTLINES = {
  round: () => circle(0.4, 0.4),
  square: () => roundedRect(0.78, 0.6, 0.12),
  sports: () => [[-0.46, 0.2], [-0.2, 0.3], [0.2, 0.3], [0.46, 0.2], [0.44, -0.12], [0.2, -0.26], [-0.2, -0.26], [-0.44, -0.12]],
  wayfarer: () => [[-0.42, 0.3], [0, 0.34], [0.42, 0.3], [0.44, 0.1], [0.36, -0.2], [0.12, -0.3], [-0.14, -0.3], [-0.38, -0.2], [-0.44, 0.1]],
  aviator: () => [[-0.4, 0.28], [-0.1, 0.36], [0.22, 0.34], [0.44, 0.22], [0.42, -0.04], [0.28, -0.3], [0.02, -0.42], [-0.22, -0.36], [-0.4, -0.14], [-0.46, 0.08]],
  'cat-eye': () => [[-0.46, 0.34], [-0.1, 0.26], [0.28, 0.22], [0.5, 0.4], [0.5, 0.1], [0.34, -0.18], [0.04, -0.3], [-0.26, -0.28], [-0.46, -0.1], [-0.5, 0.12]],
};
function circle(rx, ry, n = 14) {
  return Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * rx, Math.sin((i / n) * Math.PI * 2) * ry]);
}
function roundedRect(w, h, r) {
  const x = w / 2, y = h / 2, k = r;
  return [[-x + k, y], [x - k, y], [x, y - k], [x, -y + k], [x - k, -y], [-x + k, -y], [-x, -y + k], [-x, y - k]];
}

export const STYLES = Object.keys(OUTLINES);

export function styleFromText(text, seed = 0) {
  const t = String(text || '').toLowerCase();
  if (t.includes('cat')) return 'cat-eye';
  const hit = STYLES.find(s => t.includes(s));
  return hit || STYLES[Math.abs(seed) % STYLES.length];
}

function toShape(points, scale = 1, flipX = false) {
  const pts = points.map(([x, y]) => new THREE.Vector3((flipX ? -x : x) * scale, y * scale, 0));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return new THREE.Shape(curve.getPoints(72).map(p => new THREE.Vector2(p.x, p.y)));
}

export const FRAME_COLORS = [0x151511, 0xd8ff3e, 0xff633b, 0x2b3a67, 0x8a5a3c, 0xf2efe6, 0xc9a24b, 0xb04a7a];
export const LENS_COLORS = [0x1a1a1a, 0x2f5d50, 0x37507a, 0x7a3b2e, 0xd49a2a, 0x6a3d7a, 0x0f6f7a];

const geoCache = new Map();
function lensGeos(style) {
  if (geoCache.has(style)) return geoCache.get(style);
  const outline = OUTLINES[style]();
  const make = flip => {
    const inner = toShape(outline, 1, flip);
    const outer = toShape(outline, 1.13, flip);
    outer.holes.push(new THREE.Path(inner.getPoints(72).reverse()));
    const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 48 });
    const lens = new THREE.ExtrudeGeometry(inner, { depth: 0.035, bevelEnabled: false, curveSegments: 48 });
    return { frame, lens };
  };
  const g = { left: make(false), right: make(true) };
  geoCache.set(style, g);
  return g;
}

/**
 * @param {object} o
 * @param {string} o.style one of STYLES
 * @param {number} o.frameColor
 * @param {number} o.lensColor
 * @param {boolean} o.mirror mirrored (metallic) lenses
 */
export function createGlasses({ style = 'wayfarer', frameColor = 0x151511, lensColor = 0x1a1a1a, mirror = false } = {}) {
  const group = new THREE.Group();
  const metal = style === 'aviator' || style === 'round';
  const frameMat = new THREE.MeshStandardMaterial({
    color: frameColor, roughness: metal ? 0.22 : 0.38, metalness: metal ? 0.85 : 0.08,
  });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: lensColor, roughness: mirror ? 0.08 : 0.06, metalness: mirror ? 0.9 : 0.15,
    transparent: !mirror, opacity: mirror ? 1 : 0.78, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: mirror ? 1.6 : 1.1,
  });
  const g = lensGeos(style);
  const cx = style === 'cat-eye' ? 0.52 : 0.5;
  [[-cx, g.left], [cx, g.right]].forEach(([x, geo]) => {
    const frame = new THREE.Mesh(geo.frame, frameMat);
    frame.position.set(x, 0, -0.05);
    const lens = new THREE.Mesh(geo.lens, lensMat);
    lens.position.set(x, 0, -0.03);
    group.add(frame, lens);
  });

  // bridge
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 10, 24, Math.PI), frameMat);
  bridge.position.set(0, 0.1, 0.0);
  group.add(bridge);

  // temples: straight arm + ear hook
  const armGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.15, 10);
  const hookGeo = new THREE.CylinderGeometry(0.028, 0.022, 0.32, 10);
  [-1, 1].forEach(side => {
    const x = side * (cx + 0.5);
    const arm = new THREE.Mesh(armGeo, frameMat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(x, 0.12, -0.65);
    const hook = new THREE.Mesh(hookGeo, frameMat);
    hook.rotation.x = Math.PI / 2 - 0.9;
    hook.position.set(x, 0.0, -1.35);
    group.add(arm, hook);
    const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), frameMat);
    hinge.position.set(x, 0.12, -0.06);
    group.add(hinge);
  });

  // nose pads
  [-1, 1].forEach(side => {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), new THREE.MeshStandardMaterial({ color: 0xf0e6dc, roughness: 0.6 }));
    pad.position.set(side * 0.2, -0.12, -0.05);
    group.add(pad);
  });

  group.userData.materials = { frameMat, lensMat };
  return group;
}
