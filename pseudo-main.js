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
// const linkGroup = new THREE.Group();   // edges disabled
scene.add(nodeGroup /*, linkGroup*/);

// --- interaction state ---
const nodeObjects = [];
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
// helper function to return _id of node
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
// fetch api, return lemma as json
async function loadTermById(id) {
  const res = await fetch(`${CONFIG.API_BASE}/api/term/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// --- state helpers ---
const byId = new Map();//explain this; what it is; what its used for;
function nodeById(id) { return byId.get(id); }//this needs a good explanation

// filter loop; return array of like nodes
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

function recenterInstant(targetObj) {
  const delta = targetObj.position.clone().negate();
  nodeGroup.position.add(delta);
  // linkGroup.position.add(delta);
  bakeGroupOffsetToChildren();
}

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

// --- build ---
function buildGraph(termDoc) {
  clearNodeGroup();
  // clearLinkGroup();
  nodeObjects.length = 0;
  byId.clear();

  const centerSprite = createTextSprite(termDoc.term);
  const centerId = getId(termDoc);
  centerSprite.position.set(0, 0, 0);
  centerSprite.userData = { id: centerId, term: termDoc.term, isCenter: true };
  nodeGroup.add(centerSprite);
  nodeGroup.userData.center = centerSprite;
  centeredNode = centerSprite;
  byId.set(centerId, centerSprite);

  const list = Array.isArray(termDoc.linked_synonyms) ? termDoc.linked_synonyms : [];
  list.forEach(syn => {
    const sprite = createTextSprite(syn.term);
    const sid = getId(syn);
    sprite.position.set(syn.x, syn.y, syn.z);
    sprite.userData = { id: sid, term: syn.term, isSynonym: true };
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);
    byId.set(sid, sprite);

    // edges disabled
    // const geom = new THREE.BufferGeometry().setFromPoints([centerSprite.position.clone(), sprite.position.clone()]);
    // const mat = new THREE.LineBasicMaterial({ color: CONFIG.LINE_COLOR });
    // const line = new THREE.Line(geom, mat);
    // linkGroup.add(line);
    // sprite.userData.line = line;
  });
}

function clearNodeGroup() {
  nodeGroup.children.forEach(sprite => {
    sprite.material?.map && sprite.material.map.dispose();
    sprite.material?.dispose?.();
    sprite.geometry?.dispose?.();
  });
  nodeGroup.clear();
}
/* function clearLinkGroup() {
  linkGroup.children.forEach(line => {
    line.material?.dispose?.();
    line.geometry?.dispose?.();
  });
  linkGroup.clear();
} */

// --- animations ---
const easeInOutQuad = (t) => (t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t);

function rafProgress(duration, onUpdate) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      onUpdate(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function tweenPosition(obj, toVec3, { duration, ease = easeInOutQuad, onUpdate, onComplete } = {}) {
  const from = obj.position.clone();
  const to = toVec3.clone();
  return rafProgress(duration, (t) => {
    const e = ease(t);
    obj.position.copy(from).lerp(to, e);
    onUpdate && onUpdate(obj);
    if (t === 1 && onComplete) onComplete();
  });
}

function followMovingAnchor(obj, anchorObj, {
  duration,
  ease = easeInOutQuad,
  fade = true,
  scaleTo = 0.6,
  onUpdate,
  onComplete
} = {}) {
  const from = obj.position.clone();
  const scaleFrom = obj.scale.x;
  const startOpacity = obj.material?.opacity ?? 1;

  return rafProgress(duration, (t) => {
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
  });
}

// --- transition (edges commented out) ---
async function transitionToNode(clicked, mode = 'parallel') {
  const oldCenter = nodeGroup.userData.center;
  const prevCenterId = oldCenter?.userData?.id;
  const newCenterId = clicked.userData?.id;
  if (!newCenterId) return;

  let doc;
  try {
    doc = await loadTermById(newCenterId);
    if (!doc || !doc.term) return;
  } catch (e) {
    console.error('fetch failed:', e);
    return;
  }

  recenterInstant(clicked);
  nodeGroup.userData.center = clicked;
  centeredNode = clicked;

  const A = currentSynIdsFromScene();
  const B = doc.linked_synonyms.map(s => getId(s));
  const shared = intersect(A, B);
  const former = subtract(A, B);
  const fresh  = subtract(B, A);

  const targetPos = buildTargetMapFromDoc(doc);

  const D = CONFIG.ANIM_EXPAND_MS ?? 900;
  const schedule = (mode === 'serial')
    ? { shared: { delay: 0, dur: 0.5*D }, former: { delay: 0.5*D, dur: 0.3*D }, fresh: { delay: 0.8*D, dur: 0.8*D } }
    : { shared: { delay: 0, dur: 1.0*D }, former: { delay: 0, dur: 0.6*D }, fresh: { delay: 0.15*D, dur: 0.85*D } };

  const prevIsInNew = prevCenterId && B.includes(prevCenterId);
  if (oldCenter && oldCenter !== clicked) {
    if (prevIsInNew) {
      await tweenPosition(oldCenter, targetPos[prevCenterId], { duration: schedule.shared.dur });
    } else {
      await followMovingAnchor(oldCenter, clicked, {
        duration: schedule.former.dur,
        fade: true,
        onComplete: () => {
          nodeGroup.remove(oldCenter);
          byId.delete(prevCenterId);
        }
      });
    }
  }

  for (const id of shared) {
    const obj = nodeById(id);
    if (!obj) continue;
    setTimeout(() => {
      tweenPosition(obj, targetPos[id], { duration: schedule.shared.dur });
    }, schedule.shared.delay);
  }

  for (const id of former) {
    const obj = nodeById(id);
    if (!obj || !oldCenter) continue;
    setTimeout(() => {
      followMovingAnchor(obj, oldCenter, {
        duration: schedule.former.dur,
        fade: true,
        onComplete: () => {
          nodeGroup.remove(obj);
          byId.delete(id);
          const idx = nodeObjects.indexOf(obj);
          if (idx !== -1) nodeObjects.splice(idx, 1);
        }
      });
    }, schedule.former.delay);
  }

  const freshSet = new Set(fresh);
  for (const s of (doc.linked_synonyms || [])) {
    const sid = getId(s);
    if (!freshSet.has(sid)) continue;

    const sprite = createTextSprite(s.term);
    sprite.userData = { id: sid, term: s.term, isSynonym: true };
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);
    byId.set(sid, sprite);

    const tgt = targetPos[sid];
    const dir = tgt.clone().sub(clicked.position);
    const spawn = dir.lengthSq() === 0 ? clicked.position.clone() : clicked.position.clone().add(dir.multiplyScalar(0.15));
    sprite.position.copy(spawn);
    if (sprite.material) { sprite.material.transparent = true; sprite.material.opacity = 0; }

    setTimeout(() => {
      const startOpacity = sprite.material?.opacity ?? 0;
      const dur = schedule.fresh.dur;
      tweenPosition(sprite, tgt, {
        duration: dur,
        onUpdate: (o) => {
          const total = spawn.distanceTo(tgt);
          const left = o.position.distanceTo(tgt);
          const pTravel = Math.min(1, (total - left) / (0.5 * total || 1));
          if (o.material) o.material.opacity = Math.min(1, startOpacity + pTravel);
        }
      });
    }, schedule.fresh.delay);
  }

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
  isTransitioning = true;
  try {
    await transitionToNode(clicked, CONFIG.TRANSITION_MODE || 'parallel');
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
    `Mouse:\t${lastClient.x}, ${lastClient.y} Last:\t${lastClicked.x}, ${lastClicked.y}`;
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