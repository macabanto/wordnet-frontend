import * as THREE from 'three';
import { CONFIG } from './config.js';

// --- constants / env ---
const WIDTH = window.innerWidth;
const HEIGHT = window.innerHeight;

// --- scene setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CONFIG.CAMERA_FOV,
  WIDTH / HEIGHT,
  CONFIG.CAMERA_NEAR,
  CONFIG.CAMERA_FAR
);
camera.position.z = CONFIG.CAMERA_Z;

const debugEl = document.getElementById('debug');
let lastClicked = { x: null, y: null };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(WIDTH, HEIGHT);
document.getElementById('container').appendChild(renderer.domElement);

const raycaster = new THREE.Raycaster();
raycaster.params.Sprite = { threshold: CONFIG.SPRITE_THRESHOLD };
const mouse = new THREE.Vector2();

// --- graph containers ---
const nodeGroup = new THREE.Group();   // all text sprites
// const linkGroup = new THREE.Group(); // edges disabled
scene.add(nodeGroup /*, linkGroup*/);

// --- interaction state ---
const nodeObjects = [];   // current clickable ring
let centeredNode = null;
let isTransitioning = false;
let clickCandidate = false;

// --- orbit/inertia state ---
const ZERO = new THREE.Vector3(0, 0, 0);
let isDragging = false;
let rotation = { x: 0, y: 0 };
let rotationVelocity = { x: 0, y: 0 };
let prevMouse = { x: 0, y: 0 };
let lastClient = { x: 0, y: 0 };

// -------------- utils --------------
const getId = (obj) =>
  obj?._id?.$oid || obj?._id || obj?.id?.$oid || obj?.id || null;

function createTextSprite(text) {
  const color = CONFIG.SPRITE_COLOR;
  const fontSize = CONFIG.SPRITE_FONT_SIZE;
  const padding = CONFIG.SPRITE_PADDING;
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px Arial`;
  const textWidth = ctx.measureText(text).width;
  const textHeight = fontSize;

  canvas.width = (textWidth + padding * 2) * dpr;
  canvas.height = (textHeight + padding * 2) * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.shadowColor = 'black';
  ctx.shadowBlur = CONFIG.SPRITE_SHADOW_BLUR;
  ctx.fillStyle = color;
  ctx.fillText(text, (canvas.width / dpr) / 2, (canvas.height / dpr) / 2);

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);

  const scaleDivisor = CONFIG.SPRITE_SCALE_DIVISOR;
  sprite.scale.set(canvas.width / dpr / scaleDivisor, canvas.height / dpr / scaleDivisor, 1);
  return sprite;
}

// --- API ---
async function loadTermById(id) {
  const res = await fetch(`${CONFIG.API_BASE}/api/term/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// --- state helpers ---
const byId = new Map();
function nodeById(id) { return byId.get(id); }

function currentSynIdsFromScene() {
  return nodeObjects
    .filter(o => o.userData?.isSynonym)
    .map(o => o.userData.id);
}

function buildTargetMapFromDoc(termDoc) {
  const map = {};
  const list = Array.isArray(termDoc.linked_synonyms) ? termDoc.linked_synonyms : [];
  for (const s of list) map[getId(s)] = new THREE.Vector3(s.x, s.y, s.z);
  map[getId(termDoc)] = new THREE.Vector3(0, 0, 0);
  return map;
}

function intersect(arrA, arrB) { const s = new Set(arrB); return arrA.filter(x => s.has(x)); }
function subtract(arrA, arrB) { const s = new Set(arrB); return arrA.filter(x => !s.has(x)); }

// Instant recenter (group shift + bake)
function recenterInstant(targetObj) {
  const delta = targetObj.position.clone().negate();
  nodeGroup.position.add(delta);
  // linkGroup.position.add(delta);
  bakeGroupOffsetToChildren();
}

// Bake offsets to children and zero groups
function bakeGroupOffsetToChildren() {
  if (!nodeGroup.position.equals(ZERO)) {
    const off = nodeGroup.position.clone();
    nodeGroup.children.forEach(obj => obj.position.add(off));
    nodeGroup.position.set(0, 0, 0);
  }
  /* if (!linkGroup.position.equals(ZERO)) {
    const off = linkGroup.position.clone();
    linkGroup.children.forEach(obj => obj.position.add(off));
    linkGroup.position.set(0, 0, 0);
  } */
}

// === Centralized registry for sprites
function registerNode(obj) {
  const id = obj?.userData?.id;
  if (!id) return;
  byId.set(id, obj);
  if (obj.userData?.isSynonym) {
    if (!nodeObjects.includes(obj)) nodeObjects.push(obj);
  }
}
function removeNode(obj) {
  const id = obj?.userData?.id;
  if (obj?.parent === nodeGroup) nodeGroup.remove(obj);
  if (obj?.material?.map) obj.material.map.dispose?.();
  obj?.material?.dispose?.();
  obj?.geometry?.dispose?.();
  if (id) byId.delete(id);
  const idx = nodeObjects.indexOf(obj);
  if (idx !== -1) nodeObjects.splice(idx, 1);
}

// === Cancelable delay + TransitionManager
const PendingTimers = new Set();
function delay(ms, token) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      PendingTimers.delete(t);
      resolve();
    }, ms);
    PendingTimers.add(t);
    if (token) token.cancelCallbacks.push(() => {
      clearTimeout(t);
      PendingTimers.delete(t);
    });
  });
}
function clearAllDelays() {
  for (const t of PendingTimers) clearTimeout(t);
  PendingTimers.clear();
}

const TransitionManager = (() => {
  const active = new Set();
  let currentToken = null;

  function newToken() { return { cancelled: false, cancelCallbacks: [] }; }

  function cancelAll() {
    clearAllDelays();
    if (currentToken) {
      currentToken.cancelled = true;
      for (const cb of currentToken.cancelCallbacks) cb();
    }
    active.clear();
  }

  function track(p) {
    active.add(p);
    p.finally(() => active.delete(p));
  }

  async function waitAll() { await Promise.all(Array.from(active)); }

  return {
    begin() { cancelAll(); currentToken = newToken(); return currentToken; },
    cancelAll,
    track,
    waitAll,
    get token() { return currentToken; },
  };
})();

// --- new: frozen-anchor helper ---
function makeAnchorAt(obj3d) {
  const anchor = new THREE.Object3D();
  anchor.position.copy(obj3d.position);
  scene.add(anchor);
  return anchor;
}

// --- build ---
function buildGraph(termDoc) {
  clearNodeGroup();
  nodeObjects.length = 0;
  byId.clear();

  const centerSprite = createTextSprite(termDoc.term);
  const centerId = getId(termDoc);
  centerSprite.position.set(0, 0, 0);
  centerSprite.userData = { id: centerId, term: termDoc.term, isCenter: true };
  nodeGroup.add(centerSprite);
  registerNode(centerSprite);
  nodeGroup.userData.center = centerSprite;
  centeredNode = centerSprite;

  const list = Array.isArray(termDoc.linked_synonyms) ? termDoc.linked_synonyms : [];
  list.forEach(syn => {
    const sprite = createTextSprite(syn.term);
    const sid = getId(syn);
    sprite.position.set(syn.x, syn.y, syn.z);
    sprite.userData = { id: sid, term: syn.term, isSynonym: true };
    nodeGroup.add(sprite);
    registerNode(sprite);
  });
}

function clearNodeGroup() {
  const children = [...nodeGroup.children];
  for (const sprite of children) removeNode(sprite);
}

// --- animations ---
const easeInOutQuad = (t) => (t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t);

function rafProgress(duration, onUpdate, token) {
  return new Promise((resolve) => {
    let rafId = null;
    const start = performance.now();

    function cancel() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resolve(); // resolve harmlessly on cancel
    }
    if (token) token.cancelCallbacks.push(cancel);

    function frame(now) {
      if (token?.cancelled) return cancel();
      const t = Math.min((now - start) / duration, 1);
      onUpdate(t);
      if (t < 1) rafId = requestAnimationFrame(frame);
      else resolve();
    }
    rafId = requestAnimationFrame(frame);
  });
}

function tweenPosition(obj, toVec3, { duration, ease = easeInOutQuad, onUpdate, onComplete, token } = {}) {
  const from = obj.position.clone();
  const to = toVec3.clone();
  const p = rafProgress(duration, (t) => {
    if (token?.cancelled) return;
    const e = ease(t);
    obj.position.copy(from).lerp(to, e);
    onUpdate && onUpdate(obj);
    if (t === 1 && onComplete) onComplete();
  }, token);
  TransitionManager.track(p);
  return p;
}

// Smoothly translate the whole graph so `targetObj` moves to the origin.
function recenterAnimate(targetObj, duration = CONFIG.ANIM_TRANSLATE_MS || 500, token) {
  const from = nodeGroup.position.clone();
  const to   = from.clone().sub(targetObj.position); // move clicked → origin
  return rafProgress(duration, (t) => {
    if (token?.cancelled) return;
    const e = easeInOutQuad(t);
    nodeGroup.position.copy(from).lerp(to, e);
    // if/when you re-enable edges, also lerp linkGroup.position here
  }, token).then(() => {
    // Commit offsets to children so groups reset to (0,0,0)
    bakeGroupOffsetToChildren();
  });
}

function followMovingAnchor(obj, anchorObj, {
  duration,
  ease = easeInOutQuad,
  fade = true,
  scaleTo = 0.6,
  onUpdate,
  onComplete,
  token
} = {}) {
  const from = obj.position.clone();
  const scaleFrom = obj.scale.x;
  const startOpacity = obj.material?.opacity ?? 1;

  const p = rafProgress(duration, (t) => {
    if (token?.cancelled) return;
    const e = ease(t);
    const anchorPos = anchorObj.position;
    const cur = new THREE.Vector3().lerpVectors(from, anchorPos, e);
    obj.position.copy(cur);

    if (fade && obj.material) {
      obj.material.transparent = true;
      obj.material.opacity = startOpacity * (1 - e);
    }
    const s = THREE.MathUtils.lerp(scaleFrom, scaleTo, e);
    obj.scale.setScalar(s);

    onUpdate && onUpdate(obj);
    if (t === 1 && onComplete) onComplete();
  }, token);
  TransitionManager.track(p);
  return p;
}

// --- transition (no edges) ---
// Former synonyms collapse into a *frozen anchor* so the scene doesn't feel like it slides.
async function transitionToNode(clicked, mode = 'serial') {
  const newCenterId = clicked.userData?.id;
  if (!newCenterId) return;

  // Start new transition & cancel previous
  const token = TransitionManager.begin();

  // Fetch new doc
  let doc;
  try {
    doc = await loadTermById(newCenterId);
    if (token.cancelled) return;
    if (!doc || !doc.term) return;
  } catch (e) {
    if (!token.cancelled) console.error('fetch failed:', e);
    return;
  }

  const oldCenter = nodeGroup.userData.center;
  const prevCenterId = oldCenter?.userData?.id;

  // Build sets BEFORE recenter
  const A0 = currentSynIdsFromScene();                                // current ring (synonyms)
  const A  = A0.filter(id => id !== newCenterId);                     // exclude the clicked (now center)
  const B  = (doc.linked_synonyms || []).map(s => getId(s)).filter(Boolean); // new ring
  const Aplus = prevCenterId ? [...new Set([...A, prevCenterId])] : A;

  const shared  = intersect(Aplus, B);
  const former  = subtract(A, B);
  const current = subtract(B, Aplus);

  // Targets (relative to new center-at-origin layout)
  const targetPos = buildTargetMapFromDoc(doc);

  // Smooth recenter so the clicked sprite *animates* to the center
  await recenterAnimate(clicked, CONFIG.ANIM_TRANSLATE_MS || 500, token);
  if (token.cancelled) return;

  // Now the clicked is visually at the origin — tag it as the true center
  nodeGroup.userData.center = clicked;
  centeredNode = clicked;
  clicked.userData.isCenter = true;
  clicked.userData.isSynonym = false;
  {
    const idx = nodeObjects.indexOf(clicked);
    if (idx !== -1) nodeObjects.splice(idx, 1);
  }

  // Create a frozen anchor at the old center's *post-recenter* position
  let formerAnchor = null;
  if (oldCenter && oldCenter !== clicked) {
    formerAnchor = makeAnchorAt(oldCenter);
  }

  // Timing
  const D = CONFIG.ANIM_EXPAND_MS ?? 900;
  const schedule = (mode === 'serial')
    ? { shared: { delay: 0,       dur: 0.5*D },
        former: { delay: 0.5*D,   dur: 0.3*D },
        fresh:  { delay: 0.8*D,   dur: 0.8*D },
        gate: true }
    : { shared: { delay: 0,       dur: 1.0*D },
        former: { delay: 0,       dur: 0.6*D },
        fresh:  { delay: 0.15*D,  dur: 0.85*D },
        gate: false };

  const guard = (p) => { TransitionManager.track(p); return p; };

  // Prev center handling (don't move it yet if it won't be in the new ring)
  const prevIsInNew = prevCenterId && B.includes(prevCenterId);
  let prevTask = Promise.resolve();
  if (oldCenter && oldCenter !== clicked) {
    if (prevIsInNew) {
      // becomes a synonym in the new ring
      oldCenter.userData.isCenter = false;
      oldCenter.userData.isSynonym = true;
      if (!nodeObjects.includes(oldCenter)) nodeObjects.push(oldCenter);

      prevTask = guard(
        tweenPosition(oldCenter, targetPos[prevCenterId], {
          duration: schedule.shared.dur,
          token
        })
      );
    } else {
      // Defer moving/removing the old center until after formers collapse
      prevTask = Promise.resolve();
    }
  }

  // SHARED glides
  const sharedTasks = shared.map((id) => {
    const obj = nodeById(id); if (!obj) return Promise.resolve();
    return delay(schedule.shared.delay, token).then(() =>
      guard(tweenPosition(obj, targetPos[id], { duration: schedule.shared.dur, token }))
    );
  });

  // FORMER collapses → collapse to the frozen anchor (fixed point)
  const formerTasks = former.map((id) => {
    const obj = nodeById(id); if (!obj || !formerAnchor) return Promise.resolve();
    return delay(schedule.former.delay, token).then(() =>
      guard(followMovingAnchor(obj, formerAnchor, {
        duration: schedule.former.dur,
        fade: true,
        token,
        onComplete: () => { if (!token.cancelled) removeNode(obj); }
      }))
    );
  });

  // FRESH spawns
  const freshSet = new Set(current);
  const freshTasks = (doc.linked_synonyms || []).map((s) => {
    const sid = getId(s);
    if (!sid || !freshSet.has(sid)) return Promise.resolve();

    const sprite = createTextSprite(s.term);
    sprite.userData = { id: sid, term: s.term, isSynonym: true };
    nodeGroup.add(sprite);
    registerNode(sprite);

    const tgt = targetPos[sid];
    const dir = tgt.clone().sub(clicked.position);
    const spawn = dir.lengthSq() === 0
      ? clicked.position.clone()
      : clicked.position.clone().add(dir.multiplyScalar(0.15));
    sprite.position.copy(spawn);
    if (sprite.material) { sprite.material.transparent = true; sprite.material.opacity = 0; }

    return delay(schedule.fresh.delay, token).then(() =>
      guard(tweenPosition(sprite, tgt, {
        duration: schedule.fresh.dur,
        token,
        onUpdate: (o) => {
          const total = spawn.distanceTo(tgt);
          if (total === 0) { if (o.material) o.material.opacity = 1; return; }
          const left = o.position.distanceTo(tgt);
          const pTravel = Math.min(1, (total - left) / (0.5 * total));
          if (o.material) o.material.opacity = Math.min(1, pTravel);
        }
      }))
    );
  });

  // Execute phases
  if (schedule.gate) {
    // serial: shared → former → (old center cleanup if needed) → fresh
    await Promise.all([prevTask, ...sharedTasks]);
    if (token.cancelled) return;

    await Promise.all(formerTasks);
    if (token.cancelled) return;

    // After formers are gone, if old center is not in B, remove it gracefully
    if (oldCenter && oldCenter !== clicked && !prevIsInNew) {
      await guard(followMovingAnchor(oldCenter, clicked, {
        duration: 0.5 * D,
        fade: true,
        token,
        onComplete: () => { if (!token.cancelled) removeNode(oldCenter); }
      }));
    }

    await Promise.all(freshTasks);
    if (token.cancelled) return;
  } else {
    // parallel/staggered
    await Promise.all([prevTask, ...sharedTasks, ...formerTasks, ...freshTasks]);
    if (token.cancelled) return;

    // Optional cleanup for old center if it's not in the new ring
    if (oldCenter && oldCenter !== clicked && !prevIsInNew) {
      await guard(followMovingAnchor(oldCenter, clicked, {
        duration: 0.5 * D,
        fade: true,
        token,
        onComplete: () => { if (!token.cancelled) removeNode(oldCenter); }
      }));
    }
  }

  // Clean up the temporary anchor
  if (formerAnchor) {
    scene.remove(formerAnchor);
    formerAnchor = null;
  }

  // Finalize clickable ring to exactly B
  for (let i = nodeObjects.length - 1; i >= 0; i--) {
    const id = nodeObjects[i].userData?.id;
    if (!id) continue;
    if (!B.includes(id)) nodeObjects.splice(i, 1);
  }
}
// --- pointer/orbit handlers ---
function rotateCamera(dx, dy) {
  const sx = CONFIG.INVERT_X ? -1 : 1;
  const sy = CONFIG.INVERT_Y ? -1 : 1;
  rotation.y += sx * dx * CONFIG.ROT_SPEED;
  rotation.x += sy * dy * CONFIG.ROT_SPEED;
  rotationVelocity.y = sx * dx * CONFIG.ROT_SPEED;
  rotationVelocity.x = sy * dy * CONFIG.ROT_SPEED;
}

document.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  lastClient = { x: e.clientX, y: e.clientY };
  if (!isDragging) { prevMouse = { x: e.clientX, y: e.clientY }; return; }
  const dx = e.clientX - prevMouse.x;
  const dy = e.clientY - prevMouse.y;
  rotateCamera(dx, dy);
  prevMouse = { x: e.clientX, y: e.clientY };
});

document.addEventListener('mousedown', (e) => {
  isDragging = true;
  clickCandidate = true;
  lastClicked = { x: e.clientX, y: e.clientY };
  prevMouse = { x: e.clientX, y: e.clientY };
  lastClient = { x: e.clientX, y: e.clientY };
  rotationVelocity = { x: 0, y: 0 };
});

function wasClick(thresholdPx = CONFIG.CLICK_THRESHOLD_PX) {
  const movedFar =
    Math.abs(prevMouse.x - lastClient.x) > thresholdPx ||
    Math.abs(prevMouse.y - lastClient.y) > thresholdPx;
  return clickCandidate && !movedFar && !isTransitioning;
}

document.addEventListener('mouseup', async () => {
  isDragging = false;
  const isClick = wasClick();
  clickCandidate = false;
  if (!isClick) return;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(nodeObjects, false);
  if (hits.length === 0) return;

  const clicked = hits[0].object;
  if (clicked === centeredNode) return;
  if (!clicked.userData?.id) return; // safety

  TransitionManager.cancelAll();

  isTransitioning = true;
  try {
    await transitionToNode(clicked, CONFIG.TRANSITION_MODE || 'serial'); // tip: 'serial' reads cleanest while tuning
  } catch (err) {
    console.error('transition error:', err);
  } finally {
    isTransitioning = false;
  }
});

// --- resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// --- main loop ---
function animate() {
  requestAnimationFrame(animate);
  if (!isDragging) {
    rotation.x += rotationVelocity.x;
    rotation.y += rotationVelocity.y;
    rotationVelocity.x *= CONFIG.INERTIA_DECAY;
    rotationVelocity.y *= CONFIG.INERTIA_DECAY;
    if (Math.abs(rotationVelocity.x) < CONFIG.VELOCITY_EPS) rotationVelocity.x = 0;
    if (Math.abs(rotationVelocity.y) < CONFIG.VELOCITY_EPS) rotationVelocity.y = 0;
  }
  scene.rotation.x = rotation.x;
  scene.rotation.y = rotation.y;
  debugEl.textContent =
    `Mouse:\t${lastClient.x}, ${lastClient.y}  Last:\t${lastClicked.x}, ${lastClicked.y}`;
  renderer.render(scene, camera);
}

// --- entry ---
async function initialiseScene() {
  try {
    const seed = await loadTermById(CONFIG.INITIAL_TERM_ID);
    buildGraph(seed);
  } catch (e) { console.error('initial load failed:', e); }
}
initialiseScene();
animate();