// Original, procedurally built stylised characters (head + shoulders busts) wearing 3D sunglasses.
// They are generic invented figures, not likenesses of real people.
import * as THREE from 'three';
import { createGlasses } from './glasses.js';

const SKIN = [0xf1c9a5, 0xe0a97a, 0xc68642, 0x9a6a43, 0x6f4a2f, 0x4a2f20];
const HAIR = [0x151511, 0x2b1b12, 0x5a3825, 0xb8863b, 0x7a1f1f, 0x3a3a3a, 0xe9e4d6];
const OUTFIT = [0x151511, 0xff633b, 0x2b3a67, 0xd8ff3e, 0xf2efe6, 0x7a2e5a, 0x1f6f5c, 0xc9a24b];

export const HAIR_STYLES = ['short', 'afro', 'long', 'bun', 'beard', 'quiff'];

const std = (color, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function hairCap(mat, radius = 0.56, scaleZ = 1.05) {
  // upper dome covering the crown and back of the head, open at the front/face
  const g = new THREE.SphereGeometry(radius, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const m = new THREE.Mesh(g, mat);
  m.scale.set(0.93, 1.1, scaleZ);
  m.rotation.x = -0.28;
  return m;
}

export function createPerson({
  skin = SKIN[0], hair = HAIR[0], hairStyle = 'short', outfit = OUTFIT[0], accent = OUTFIT[3],
  glassesStyle = 'wayfarer', frameColor = 0x151511, lensColor = 0x1a1a1a, mirror = false,
} = {}) {
  const root = new THREE.Group();
  const skinMat = std(skin, 0.55);
  const hairMat = std(hair, 0.5);
  const outfitMat = std(outfit, 0.65);
  const accentMat = std(accent, 0.35, 0.5);

  // ---- body ----
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.8, 1.6, 32), outfitMat);
  torso.scale.z = 0.6;
  torso.position.y = 0.05;
  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.15, 10, 20), outfitMat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.scale.set(1, 1, 1.5);
  shoulders.position.y = 0.72;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 20), skinMat);
  neck.position.y = 0.98;
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 8, 36), accentMat);
  chain.rotation.x = Math.PI / 2 - 0.35;
  chain.position.set(0, 0.8, 0.14);
  // open collar / jacket lapels
  const lapelMat = std(new THREE.Color(outfit).multiplyScalar(0.62).getHex(), 0.7);
  const lapels = [-1, 1].map(s => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.06), lapelMat);
    l.position.set(s * 0.2, 0.55, 0.43);
    l.rotation.z = s * -0.38;
    return l;
  });
  root.add(torso, shoulders, neck, chain, ...lapels);

  // ---- head (own group so it can look around) ----
  const head = new THREE.Group();
  head.position.set(0, 1.55, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 32), skinMat);
  skull.scale.set(0.9, 1.12, 1);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), skinMat);
  jaw.scale.set(0.95, 0.9, 0.95);
  jaw.position.set(0, -0.28, 0.06);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), skinMat);
  nose.scale.set(0.9, 1.15, 1.1);
  nose.position.set(0, -0.08, 0.5);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 24, Math.PI), std(0x8a3b3b, 0.5));
  lip.rotation.z = Math.PI;
  lip.position.set(0, -0.3, 0.46);
  const ears = [-1, 1].map(s => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 14), skinMat);
    e.scale.set(0.55, 1, 0.8);
    e.position.set(s * 0.45, -0.02, 0.0);
    return e;
  });
  const brows = [-1, 1].map(s => {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.16, 4, 8), hairMat);
    b.rotation.z = Math.PI / 2 + s * 0.08;
    b.position.set(s * 0.17, 0.2, 0.5);
    return b;
  });
  head.add(skull, jaw, nose, lip, ...ears, ...brows);

  // hair
  if (hairStyle === 'afro') {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.66, 32, 24), hairMat);
    a.position.set(0, 0.12, -0.16);
    head.add(a);
  } else {
    const cap = hairCap(hairMat);
    head.add(cap);
    if (hairStyle === 'long') {
      [-1, 1].forEach(s => {
        const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.1, 8, 16), hairMat);
        lock.position.set(s * 0.43, -0.5, -0.08);
        head.add(lock);
      });
      const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 8, 16), hairMat);
      back.position.set(0, -0.5, -0.3);
      head.add(back);
    } else if (hairStyle === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), hairMat);
      bun.position.set(0, 0.62, -0.12);
      head.add(bun);
    } else if (hairStyle === 'beard') {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.5), hairMat);
      beard.scale.set(0.98, 0.92, 1.02);
      beard.position.set(0, -0.28, 0.06);
      head.add(beard);
    } else if (hairStyle === 'quiff') {
      const q = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 8, 16), hairMat);
      q.rotation.x = Math.PI / 2 - 0.5;
      q.position.set(0, 0.6, 0.22);
      head.add(q);
    }
  }

  // sunglasses sit on the nose bridge, sized to the face
  const glasses = createGlasses({ style: glassesStyle, frameColor, lensColor, mirror });
  glasses.scale.setScalar(0.45);
  glasses.position.set(0, 0.04, 0.46);
  head.add(glasses);

  root.add(head);
  root.userData.head = head;
  root.userData.glasses = glasses;
  return root;
}

export function randomPerson(rand) {
  const pick = a => a[Math.floor(rand() * a.length)];
  const styles = ['wayfarer', 'aviator', 'round', 'square', 'cat-eye', 'sports'];
  return createPerson({
    skin: pick(SKIN), hair: pick(HAIR), hairStyle: pick(HAIR_STYLES), outfit: pick(OUTFIT), accent: pick([0xd8ff3e, 0xc9a24b, 0xff633b, 0xf2efe6]),
    glassesStyle: pick(styles), frameColor: pick([0x151511, 0xd8ff3e, 0xff633b, 0xc9a24b, 0xf2efe6]),
    lensColor: pick([0x1a1a1a, 0x2f5d50, 0x37507a, 0x7a3b2e, 0x6a3d7a]), mirror: rand() > 0.7,
  });
}
