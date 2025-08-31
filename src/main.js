import * as THREE from 'three';
import { CONFIG /*, createConfig */ } from './config.js';
// modular config

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
// debug stuff
const debugEl = document.getElementById('debug');
let lastClicked = { x: null, y: null };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(WIDTH, HEIGHT);
document.getElementById('container').appendChild(renderer.domElement);

const raycaster = new THREE.Raycaster();
// Slightly more forgiving sprite hit-test for clicks
raycaster.params.Sprite = { threshold: CONFIG.SPRITE_THRESHOLD };
const mouse = new THREE.Vector2();

// --- graph containers ---
const nodeGroup = new THREE.Group();   // all text sprites
const linkGroup = new THREE.Group();   // all edges
scene.add(nodeGroup, linkGroup);

// --- interaction state ---
const nodeObjects = [];   // clickable sprites (current ring only)
let centeredNode = null;  // sprite currently at "center" (logical root)
let isTransitioning = false;
let clickCandidate = false;

// --- orbit/inertia state ---
const ZERO = new THREE.Vector3(0, 0, 0);
let isDragging = false;
let rotation = { x: 0, y: 0 };
let rotationVelocity = { x: 0, y: 0 };
let prevMouse = { x: 0, y: 0 };
// Raw last client mouse position (CSS pixels), used to distinguish click vs drag
let lastClient = { x: 0, y: 0 };

// -------------- utils --------------
const getId = (obj) => obj?._id?.$oid || obj?._id || obj?.id?.$oid || obj?.id || null; // safest way to get id

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
  ctx.shadowBlur = CONFIG.SPRITE_SHADOW_BLUR; // softer glow; can multiply by dpr for HiDPI sharpness
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

// -------------- API --------------
async function loadTermById(id) {
  const res = await fetch(`${CONFIG.API_BASE}/api/term/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
} // ( _id ) => { return json }

// -------------- layout/build --------------
function buildGraph(termDoc) {
  // dispose old + clear
  clearNodeGroup();
  clearLinkGroup();
  nodeObjects.length = 0;

  // center sprite
  const centerSprite = createTextSprite(termDoc.term);
  centerSprite.position.set(0, 0, 0);
  centerSprite.userData = { id: getId(termDoc), term: termDoc.term, line: null };
  nodeGroup.add(centerSprite);
  nodeGroup.userData.center = centerSprite;
  centeredNode = centerSprite;

  // synonyms (guard empty/missing)
  const list = Array.isArray(termDoc.linked_synonyms) ? termDoc.linked_synonyms : [];
  list.forEach(syn => {
    const sprite = createTextSprite(syn.term);
    sprite.position.set(syn.x, syn.y, syn.z);
    sprite.userData = { id: getId(syn), term: syn.term, line: null };
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);

    const geom = new THREE.BufferGeometry().setFromPoints([
      centerSprite.position.clone(),
      sprite.position.clone()
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: CONFIG.LINE_COLOR,
      transparent: true,
      opacity: CONFIG.LINE_OPACITY_COLLAPSE_START
    });
    const line = new THREE.Line(geom, mat);
    linkGroup.add(line);
    sprite.userData.line = line;
  });
} // at this point, centeredNode should point to the sprite at the scene origin

// Clears out all sprites in nodeGroup
function clearNodeGroup() {
  nodeGroup.children.forEach(sprite => {
    sprite.material?.map && sprite.material.map.dispose();
    sprite.material?.dispose?.();
    sprite.geometry?.dispose?.();
  });
  nodeGroup.clear(); // removes all children from group
}

// Clears out all lines in linkGroup
function clearLinkGroup() {
  linkGroup.children.forEach(line => {
    line.material?.dispose?.();
    line.geometry?.dispose?.();
  });
  linkGroup.clear();
}

// -------------- animations --------------
// Easing helper: accelerates, then decelerates smoothly (C2 continuous at t=0.5)
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

// Clean translateGraph using the helper
async function translateGraph(targetNode, duration = CONFIG.ANIM_TRANSLATE_MS) {
  const from = nodeGroup.position.clone();
  const to = from.clone().sub(targetNode.position); // bring clicked to origin

  await rafProgress(duration, (t) => {
    const e = easeInOutQuad(t);
    nodeGroup.position.copy(from).lerp(to, e);
    linkGroup.position.copy(nodeGroup.position);  // keep edges in lockstep
  });
}

function collapseNodes(centerBeforeClick, keepNode, duration = CONFIG.ANIM_COLLAPSE_MS) {
  return new Promise(resolve => {
    // nodes to collapse = all clickable except the new center
    const collapseList = nodeObjects.filter(n => n !== keepNode);
    const startPos = collapseList.map(n => n.position.clone());
    const startScale = collapseList.map(n => n.scale.clone());
    const target = centerBeforeClick.position.clone();

    const start = performance.now();
    function tick(tNow) {
      const t = Math.min((tNow - start) / duration, 1);
      const ease = easeInOutQuad(t);

      collapseList.forEach((node, i) => {
        // move + shrink
        node.position.copy(startPos[i]).lerp(target, ease);
        node.scale.copy(startScale[i].clone().lerp(ZERO, ease));

        // edge shrink/fade
        const line = node.userData?.line;
        if (line) {
          line.geometry.setFromPoints([centerBeforeClick.position, node.position]);
          line.geometry.attributes.position.needsUpdate = true;
          line.material.transparent = true;
          line.material.opacity = (1 - ease);
        }
      });

      if (t < 1) requestAnimationFrame(tick);
      else {
        // cleanup collapsed nodes & lines
        collapseList.forEach(node => {
          const line = node.userData?.line;
          if (line) {
            linkGroup.remove(line);
            line.geometry?.dispose?.();
            line.material?.dispose?.();
          }
          nodeGroup.remove(node);
          node.material?.map && node.material.map.dispose();
          node.material?.dispose?.();
          node.geometry?.dispose?.();
          const idx = nodeObjects.indexOf(node);
          if (idx !== -1) nodeObjects.splice(idx, 1);
        });
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

// Bakes group offset down to children, then zeroes the groups
function bakeGroupOffsetToChildren() {
  if (!nodeGroup.position.equals(ZERO)) {
    const off = nodeGroup.position.clone();
    nodeGroup.children.forEach(obj => obj.position.add(off));
    nodeGroup.position.set(0, 0, 0);
  }
  if (!linkGroup.position.equals(ZERO)) {
    const off = linkGroup.position.clone();
    linkGroup.children.forEach(obj => obj.position.add(off));
    linkGroup.position.set(0, 0, 0);
  }
}

function expandNodes(centerNode, termDoc, duration = CONFIG.ANIM_EXPAND_MS) {
  nodeObjects.length = 0;

  const list = Array.isArray(termDoc.linked_synonyms) ? termDoc.linked_synonyms : [];
  list.forEach(syn => {
    const sprite = createTextSprite(syn.term);
    sprite.userData = { id: getId(syn), term: syn.term, line: null };

    const finalScale = sprite.scale.clone();
    sprite.scale.set(0, 0, 0);
    sprite.position.copy(centerNode.position);
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      centerNode.position.clone(),
      centerNode.position.clone()
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: CONFIG.LINE_COLOR,
      transparent: true,
      opacity: 0.0
    });
    const line = new THREE.Line(lineGeom, lineMat);
    linkGroup.add(line);
    sprite.userData.line = line;

    const target = new THREE.Vector3(syn.x, syn.y, syn.z);
    const start = performance.now();
    const myDuration = duration + Math.random() * CONFIG.ANIM_EXPAND_JITTER_MS;

    function tick(now) {
      const t = Math.min((now - start) / myDuration, 1);
      const ease = easeInOutQuad(t);

      sprite.position.copy(centerNode.position.clone().lerp(target, ease));
      sprite.scale.copy(finalScale.clone().multiplyScalar(ease));

      line.geometry.setFromPoints([centerNode.position, sprite.position]);
      line.geometry.attributes.position.needsUpdate = true;
      line.material.opacity = CONFIG.LINE_OPACITY_EXPAND_TARGET * ease;

      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function wasClick(thresholdPx = CONFIG.CLICK_THRESHOLD_PX) {
  const movedFar =
    Math.abs(prevMouse.x - lastClient.x) > thresholdPx ||
    Math.abs(prevMouse.y - lastClient.y) > thresholdPx;

  return clickCandidate && !movedFar && !isTransitioning;
}

async function transitionToNode(clicked) {
  const oldCenter = nodeGroup.userData.center;

  await Promise.all([
    translateGraph(clicked, CONFIG.ANIM_TRANSLATE_MS),
    collapseNodes(oldCenter, clicked, CONFIG.ANIM_COLLAPSE_MS),
  ]);

  bakeGroupOffsetToChildren();

  nodeGroup.userData.center = clicked;
  centeredNode = clicked;

  const id = clicked.userData?.id;
  if (!id) return;

  try {
    const doc = await loadTermById(id);
    if (!doc || !doc.term) return; // guard bad payloads
    expandNodes(clicked, doc, CONFIG.ANIM_EXPAND_MS);
  } catch (e) {
    console.error('fetch/expand failed:', e);
  }
}

// -------------- pointer/orbit handlers --------------
function rotateCamera(dx, dy) {
  const sx = CONFIG.INVERT_X ? -1 : 1;
  const sy = CONFIG.INVERT_Y ? -1 : 1;
  const yaw   = sx * dx * CONFIG.ROT_SPEED;  // around Y
  const pitch = sy * dy * CONFIG.ROT_SPEED;  // around X
  rotation.y += yaw;
  rotation.x += pitch;
  rotationVelocity.y = yaw;
  rotationVelocity.x = pitch;
  // redacted
}

document.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  lastClient = { x: e.clientX, y: e.clientY };

  if (!isDragging) {
    prevMouse = { x: e.clientX, y: e.clientY };
    return;
  }

  const dx = e.clientX - prevMouse.x;
  const dy = e.clientY - prevMouse.y;
  rotateCamera(dx, dy);
  prevMouse = { x: e.clientX, y: e.clientY };
});

document.addEventListener('mousedown', (e) => {
  isDragging = true;              // could be a drag ?
  clickCandidate = true;          // could be a click ?
  // debug stuff
  lastClicked = { x: e.clientX, y: e.clientY };
  prevMouse = { x: e.clientX, y: e.clientY }; // retain mouse position at click
  lastClient = { x: e.clientX, y: e.clientY };
  rotationVelocity = { x: 0, y: 0 }; // stops inertia
});

document.addEventListener('mouseup', async () => {
  isDragging = false;

  // compute once, then always reset clickCandidate
  const isClick = wasClick();
  clickCandidate = false;

  if (!isClick) return;

  // raycast
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(nodeObjects, false);
  if (hits.length === 0) return;

  const clicked = hits[0].object;
  if (clicked === centeredNode) return;

  isTransitioning = true;
  try {
    await transitionToNode(clicked);
  } catch (err) {
    console.error('transition error:', err);
  } finally {
    isTransitioning = false;
  }
});

// -------------- window resize --------------
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// -------------- main loop --------------
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
  // debug stuff
  debugEl.textContent = `Mouse:\t\t${lastClient.x}, ${lastClient.y} Last Click:\t${lastClicked.x ?? '-'}, ${lastClicked.y ?? '-'} Rotation:\tX ${rotation.x.toFixed(3)}\tY ${rotation.y.toFixed(3)}Velocity:\tX ${rotationVelocity.x.toFixed(4)}\tY ${rotationVelocity.y.toFixed(4)}`;
  renderer.render(scene, camera);
}

// -------------- entry --------------
async function initialiseScene() {
  try {
    const seed = await loadTermById(CONFIG.INITIAL_TERM_ID);
    buildGraph(seed);
  } catch (e) {
    console.error('initial load failed:', e);
  }
}

initialiseScene();
animate();