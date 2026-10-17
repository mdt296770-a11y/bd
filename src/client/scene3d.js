// SUNPOP 3D layer: floating 3D sunglasses + visiting characters in the background,
// a spinning hero pair, a rotatable viewer on product pages, plus CSS-3D card effects.
// Bundled with three.js by `npm run build:3d` into src/public/js/scene3d.js (served from 'self', CSP-safe).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createGlasses, STYLES, FRAME_COLORS, LENS_COLORS, styleFromText } from './glasses.js';
import { randomPerson } from './people.js';

const STORE_KEY = 'sunpop-3d';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;
const isMobile = () => window.innerWidth < 700 || coarse;
// Debug aid: open any page with ?fx3d=full to keep full quality (disables the automatic downgrade).
const NO_ADAPT = /[?&]fx3d=full/.test(location.search);
const lowEnd = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function stored() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }
const isOff = () => stored() === 'off' || stored() === 'auto-off';
function store(v) { try { localStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } }

function makeRenderer(canvas, alpha = true) {
  try {
    const r = new THREE.WebGLRenderer({ canvas, alpha, antialias: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    return r;
  } catch { return null; }
}
function addLighting(renderer, scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pm.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-300, 500, 700);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.35));
  return envTex;
}

/* ------------------------------------------------------------------ */
/* Background scene                                                    */
/* ------------------------------------------------------------------ */
let bg = null;

function initBackground(onGiveUp) {
  if (bg) return bg;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = makeRenderer(canvas);
  if (!renderer) return null;
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  addLighting(renderer, scene);
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 6000);

  const state = {
    W: 0, H: 0, docH: 0, scrollY: 0, quality: lowEnd ? 1 : 0, raf: 0, running: false,
    px: 0, py: 0, tx: 0, ty: 0, last: 0, frames: 0, acc: 0, warm: 0, t0: performance.now(),
  };
  const mobile = isMobile();

  // ----- floating glasses (anchored to page coordinates, with scroll parallax) -----
  const floaters = [];
  const makeFloater = i => {
    const style = STYLES[i % STYLES.length];
    const g = createGlasses({
      style, frameColor: FRAME_COLORS[(i * 3) % FRAME_COLORS.length], lensColor: LENS_COLORS[(i * 5) % LENS_COLORS.length], mirror: i % 4 === 3,
    });
    const holder = new THREE.Group();
    holder.add(g);
    scene.add(holder);
    return {
      holder, glasses: g,
      side: i % 2 ? 1 : -1, rx: Math.random(), ry: Math.random(),
      f: 0.75 + Math.random() * 0.45, size: 0, depth: (Math.random() - 0.5) * 220,
      phase: Math.random() * 6.28, spin: (0.25 + Math.random() * 0.4) * (i % 2 ? 1 : -1),
      docY: 0, x: 0, big: false,
    };
  };
  const maxFloaters = mobile ? 6 : lowEnd ? 7 : 14;
  for (let i = 0; i < maxFloaters; i++) floaters.push(makeFloater(i));

  // hero feature pair: big, anchored over the hero banner
  const hero = makeFloater(1);
  hero.big = true; hero.f = 1; hero.depth = 120; hero.glasses.userData.materials.lensMat.opacity = 0.7;
  hero.holder.visible = false;
  floaters.push(hero);

  // ----- visiting characters -----
  const CYCLE = 20;
  const slots = [];
  if (!reduced) {
    const n = mobile ? 1 : lowEnd ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const people = Array.from({ length: mobile ? 2 : 3 }, () => {
        const p = randomPerson(Math.random);
        p.visible = false;
        scene.add(p);
        return p;
      });
      slots.push({ i, people, person: people[0], k: -1, offset: i * (CYCLE / n) + 2, mode: 'peek', side: -1, tilt: 0 });
    }
  }

  function layout() {
    state.W = window.innerWidth;
    state.H = window.innerHeight;
    state.docH = Math.max(document.documentElement.scrollHeight, state.H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.quality ? 1 : mobile ? 1.5 : 1.75));
    renderer.setSize(state.W, state.H, false);
    camera.aspect = state.W / state.H;
    camera.position.set(0, 0, state.H / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.updateProjectionMatrix();

    const margin = Math.max(36, state.W * (mobile ? 0.1 : 0.115));
    const count = clamp(Math.round(state.docH / (mobile ? 700 : 520)), mobile ? 3 : 5, floaters.length - 1);
    floaters.forEach((f, idx) => {
      if (f.big) return;
      f.holder.visible = idx < count && !(state.quality && idx >= Math.ceil(count / 2));
      f.size = (mobile ? 70 : 100) + f.rx * (mobile ? 40 : 110);
      f.x = f.side < 0 ? margin * (0.1 + f.rx * 0.9) : state.W - margin * (0.1 + f.rx * 0.9);
      f.docY = f.ry * (f.f * (state.docH - state.H) + state.H);
    });
    const heroEl = document.querySelector('.hero-carousel');
    if (heroEl) {
      const r = heroEl.getBoundingClientRect();
      hero.holder.visible = true;
      hero.size = mobile ? Math.min(state.W * 0.4, 160) : Math.min(r.width * 0.2, 280);
      hero.x = mobile ? r.left + r.width * 0.8 : r.left + r.width * 0.9;
      hero.docY = r.top + window.scrollY + r.height * (mobile ? 0.16 : 0.24);
    } else hero.holder.visible = false;
    slots.forEach(s => s.people.forEach(p => { p.userData.sizePx = 0; }));
  }

  function bustPx(slot) {
    return clamp(state.W * (mobile ? 0.36 : 0.15), mobile ? 115 : 140, mobile ? 165 : 240) * (slot.mode === 'cross' ? 0.85 : 1);
  }

  function updateFloaters(t) {
    floaters.forEach(f => {
      if (!f.holder.visible) return;
      const scrollY = state.scrollY;
      const sy = f.docY - scrollY * (f.big ? 1 : f.f);
      const bob = reduced ? 0 : Math.sin(t * 0.9 + f.phase) * 12;
      const s = f.size / 2.3;
      f.holder.scale.setScalar(s);
      f.holder.position.set(f.x - state.W / 2 + state.px * (f.big ? 24 : 14 * f.f), state.H / 2 - sy - bob - state.py * 10, f.depth);
      const spin = reduced ? 0 : t * f.spin;
      f.holder.rotation.set(
        -0.18 + Math.sin(t * 0.6 + f.phase) * 0.12 - state.py * 0.35 + (reduced ? 0 : (state.vel || 0) * 0.002),
        (f.big ? spin * 0.9 : Math.sin(spin) * 0.9) + state.px * 0.5,
        Math.sin(t * 0.5 + f.phase) * 0.12 + (f.side < 0 ? 0.1 : -0.1),
      );
    });
  }

  function updateSlots(t) {
    slots.forEach(s => {
      const c = (t + s.offset) / CYCLE;
      const k = Math.floor(c);
      const p = c - k;
      if (k !== s.k) {
        s.person.visible = false;
        s.k = k;
        s.person = s.people[k % s.people.length];
        s.mode = (k + s.i) % 3 === 2 && !mobile ? 'cross' : 'peek';
        s.side = (k + s.i) % 2 ? 1 : -1;
        s.tilt = (Math.random() - 0.5) * 0.2;
      }
      const person = s.person;
      const px = bustPx(s);
      person.scale.setScalar(px / 3.1);
      const head = person.userData.head;
      let x; let y; let rotY; let rotZ; let shown = true;
      if (s.mode === 'peek') {
        // rise, hold, drop out of sight, then stay hidden for the rest of the cycle (mobile holds shorter)
        const IN = 0.12; const OUT = mobile ? 0.4 : 0.8;
        const e = p < IN ? easeOutBack(p / IN) : p < OUT ? 1 : p < OUT + 0.1 ? 1 - easeIn((p - OUT) / 0.1) : 0;
        shown = e > 0.001;
        const upY = state.H - px * 0.02; // head + shoulders only, keeps CTAs and text clear
        const downY = state.H + px * 0.85;
        y = lerp(downY, upY, clamp(e, 0, 1.08)) + Math.sin(t * 1.3 + s.i) * 5;
        x = s.side < 0 ? px * 0.42 : state.W - px * 0.42;
        rotY = -s.side * 0.5 + Math.sin(t * 0.7 + s.i) * 0.12;
        rotZ = s.tilt + Math.sin(t * 0.9) * 0.03;
      } else {
        const dir = s.side;
        const e = p;
        x = dir > 0 ? lerp(-px, state.W + px, e) : lerp(state.W + px, -px, e);
        y = state.H - px * 0.02 + Math.abs(Math.sin(t * 4.2)) * -8;
        rotY = dir * 0.75;
        rotZ = Math.sin(t * 4.2) * 0.05;
      }
      person.visible = shown;
      person.position.set(x - state.W / 2, state.H / 2 - y, 60 + s.i * 30);
      person.rotation.set(0, rotY, rotZ);
      // head follows the pointer, and glances at the viewer while walking
      const lookY = (s.mode === 'cross' ? -s.side * 0.55 : s.side * 0.35) + state.px * 0.6;
      head.rotation.y = lerp(head.rotation.y, lookY, 0.08);
      head.rotation.x = lerp(head.rotation.x, -state.py * 0.3 + Math.sin(t * 1.1 + s.i) * 0.04, 0.08);
      head.rotation.z = Math.sin(t * 0.8 + s.i) * 0.04;
    });
  }

  function frame(now) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(frame);
    const dt = now - (state.last || now);
    state.last = now;
    // Adaptive quality for weak devices: sample 30-frame windows after warm-up and step down quickly.
    // 1 = fewer objects, 2 = no characters, 3 = give up and switch the 3D layer off (site stays light).
    if (NO_ADAPT) { /* keep full quality */ } else if (state.warm < 20) state.warm++;
    else {
      state.acc += dt; state.frames++;
      if (state.frames === 30) {
        if (state.acc / state.frames > 34) {
          state.quality++;
          if (state.quality >= 3) { stop(); canvas.hidden = true; store('auto-off'); onGiveUp && onGiveUp(); return; }
          if (state.quality === 2) slots.forEach(s => s.people.forEach(p => { p.visible = false; }));
          layout();
        }
        state.frames = 0; state.acc = 0;
      }
    }
    const y = window.scrollY;
    state.vel = lerp(state.vel || 0, y - state.scrollY, 0.2);
    state.scrollY = y;
    state.px = lerp(state.px, state.tx, 0.06);
    state.py = lerp(state.py, state.ty, 0.06);
    const t = (now - state.t0) / 1000;
    updateFloaters(t);
    if (state.quality < 2) updateSlots(t);
    renderer.render(scene, camera);
  }
  function renderOnce() {
    state.scrollY = window.scrollY;
    updateFloaters(0);
    renderer.render(scene, camera);
  }

  const onPointer = e => { state.tx = (e.clientX / state.W) * 2 - 1; state.ty = (e.clientY / state.H) * 2 - 1; };
  const onScrollStatic = () => { if (!state.running) requestAnimationFrame(renderOnce); };
  const onResize = () => { layout(); if (!state.running) renderOnce(); };
  window.addEventListener('resize', onResize);
  if (!coarse) window.addEventListener('pointermove', onPointer, { passive: true });
  if (reduced) window.addEventListener('scroll', onScrollStatic, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!canvas.hidden && !isOff()) start(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (Math.abs(document.documentElement.scrollHeight - state.docH) > 40) layout(); }).observe(document.body);
  window.addEventListener('load', () => setTimeout(() => layout(), 400));

  function start() {
    canvas.hidden = false;
    if (state.quality >= 3) state.quality = 2; // user re-enabled after an automatic switch-off: retry with the light profile
    state.warm = 0; state.frames = 0; state.acc = 0;
    layout();
    if (reduced) { renderOnce(); return; }
    if (state.running) return;
    state.running = true; state.last = 0;
    state.raf = requestAnimationFrame(frame);
  }
  function stop() { state.running = false; cancelAnimationFrame(state.raf); }
  function hide() { stop(); canvas.hidden = true; }

  bg = { start, stop, hide, canvas };
  return bg;
}

/* ------------------------------------------------------------------ */
/* Product page viewer                                                 */
/* ------------------------------------------------------------------ */
function openViewer(btn) {
  const host = btn.closest('.detail-image');
  if (!host || host.querySelector('.viewer3d')) return;
  const style = styleFromText(btn.dataset.style, Number(btn.dataset.seed) || 0);
  const seed = Number(btn.dataset.seed) || 0;
  const wrap = document.createElement('div');
  wrap.className = 'viewer3d';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', '3D সানগ্লাস ভিউয়ার');
  const stage = document.createElement('div');
  stage.className = 'viewer3d-stage';
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', '3D মডেল — ঘোরাতে টেনে ধরুন বা তীর চিহ্নের কী চাপুন');
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'viewer3d-close'; closeBtn.textContent = '✕'; closeBtn.setAttribute('aria-label', '3D ভিউ বন্ধ করুন');
  const hint = document.createElement('p');
  hint.className = 'viewer3d-hint'; hint.textContent = 'টেনে ঘোরান · রং বদলে দেখুন (শুধু প্রিভিউ)';
  const sw = document.createElement('div');
  sw.className = 'viewer3d-swatches';
  wrap.append(stage, closeBtn, hint, sw);
  host.appendChild(wrap);

  const renderer = makeRenderer(canvas);
  if (!renderer) { wrap.remove(); btn.hidden = true; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  addLighting(renderer, scene);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.1, 6.2);
  const g = createGlasses({ style, frameColor: FRAME_COLORS[seed % FRAME_COLORS.length], lensColor: LENS_COLORS[seed % LENS_COLORS.length], mirror: seed % 4 === 3 });
  const pivot = new THREE.Group();
  g.position.z = 0.6;
  pivot.add(g);
  scene.add(pivot);
  const key = scene.children.find(c => c.isDirectionalLight);
  if (key) key.position.set(-3, 4, 6), key.intensity = 2.2;

  let yaw = -0.5, pitch = -0.12, vyaw = 0, dragging = false, lx = 0, ly = 0, auto = !reduced, raf = 0, alive = true;
  FRAME_COLORS.slice(0, 6).forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.setAttribute('aria-label', 'ফ্রেমের রং ' + (i + 1));
    b.addEventListener('click', () => { g.userData.materials.frameMat.color.setHex(c); sw.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); });
    if (c === FRAME_COLORS[seed % FRAME_COLORS.length]) b.classList.add('on');
    sw.appendChild(b);
  });

  const size = () => {
    const w = stage.clientWidth || 400; const h = stage.clientHeight || 400;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  size();
  const ro = 'ResizeObserver' in window ? new ResizeObserver(size) : null;
  ro?.observe(stage);
  stage.addEventListener('pointerdown', e => { dragging = true; auto = false; lx = e.clientX; ly = e.clientY; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!dragging) return; vyaw = (e.clientX - lx) * 0.012; yaw += vyaw; pitch = clamp(pitch + (e.clientY - ly) * 0.008, -0.8, 0.8); lx = e.clientX; ly = e.clientY; });
  const up = () => { dragging = false; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('keydown', e => {
    const k = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
    if (k) { e.preventDefault(); auto = false; yaw += k[0]; pitch = clamp(pitch + k[1], -0.8, 0.8); }
    if (e.key === 'Escape') close();
  });

  function tick() {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    if (auto) yaw += 0.008; else if (!dragging) { yaw += vyaw; vyaw *= 0.95; }
    pivot.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
  }
  function close() {
    alive = false; cancelAnimationFrame(raf); ro?.disconnect();
    g.traverse(o => { if (o.material) o.material.dispose(); });
    renderer.dispose();
    wrap.remove(); btn.focus();
  }
  closeBtn.addEventListener('click', close);
  tick();
  stage.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* DOM-level 3D: tilt cards, scroll reveal                             */
/* ------------------------------------------------------------------ */
function initDomFx() {
  if (!coarse && !reduced) {
    document.querySelectorAll('.product-card .product-image, .benefit-row > div').forEach(el => {
      el.classList.add('tilt3d');
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((x - 0.5) * 14).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - y) * 14).toFixed(2) + 'deg');
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
      el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });
  }
  if (!reduced && 'IntersectionObserver' in window) {
    const targets = document.querySelectorAll('.product-card, .section-heading, .manifesto > *, .detail-copy, .cart-line, .status-grid');
    const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in3d'); io.unobserve(en.target); } }), { threshold: 0.12 });
    targets.forEach((el, i) => { el.classList.add('reveal3d'); el.style.setProperty('--d', ((i % 4) * 70) + 'ms'); io.observe(el); });
    setTimeout(() => targets.forEach(el => el.classList.add('in3d')), 4000); // safety net
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
function boot() {
  document.documentElement.classList.add('has-3d');
  initDomFx();
  document.querySelectorAll('[data-viewer3d]').forEach(b => b.addEventListener('click', () => openViewer(b)));

  const toggles = [...document.querySelectorAll('[data-fx-toggle]')];
  const skipScene = location.pathname.startsWith('/checkout') || location.pathname.startsWith('/admin');
  const probe = document.createElement('canvas');
  const webgl = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  const setToggle = on => toggles.forEach(t => { t.setAttribute('aria-pressed', String(on)); t.classList.toggle('off', !on); });
  if (!webgl || skipScene) { toggles.forEach(t => { t.hidden = true; }); return; }
  toggles.forEach(t => { t.hidden = false; });

  const enable = () => { const b = initBackground(() => setToggle(false)); if (b) { b.start(); setToggle(true); } else toggles.forEach(t => { t.hidden = true; }); };
  const disable = () => { bg?.hide(); setToggle(false); };
  toggles.forEach(t => t.addEventListener('click', () => { if (t.getAttribute('aria-pressed') === 'true') { store('off'); disable(); } else { store('on'); enable(); } }));
  if (isOff()) setToggle(false); else enable();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
