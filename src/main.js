import * as THREE from 'three';
console.log('✅ main.js loaded');
const width = window.innerWidth;
const height = window.innerHeight;

// === Setup scene ===
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
camera.position.z = 300;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(width, height);
document.getElementById('container').appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

const nodeObjects = []; 
const nodeGroup = new THREE.Group();
const linkGroup = new THREE.Group();
let centeredNode = null;
let isTransitioning = false;
const visited = new Set(); // optional: avoid refetching same term

scene.add(nodeGroup);
scene.add(linkGroup);

function createTextSprite(text, color = '#bfbfbfff') {
  const isCenter = text === "term";
  const fontSize = isCenter ? 52 : 36;
  const padding = 20;
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `bold ${fontSize}px Arial`;
  const textWidth = context.measureText(text).width;
  const textHeight = fontSize;

  canvas.width = (textWidth + padding * 2) * dpr;
  canvas.height = (textHeight + padding * 2) * dpr;
  context.scale(dpr, dpr);
  context.font = `bold ${fontSize}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.shadowColor = 'black';
  context.shadowBlur = 4;
  context.fillStyle = color;
  context.fillText(text, (canvas.width / dpr) / 2, (canvas.height / dpr) / 2);

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  const scaleFactor = isCenter ? 5 : 4;
  sprite.scale.set(canvas.width / dpr / scaleFactor, canvas.height / dpr / scaleFactor, 1);
  return sprite;
}

function initializeGraph(termData) {
  // optional: dispose old stuff to avoid leaks
  nodeGroup.children.forEach(o => { o.material?.map?.dispose?.(); o.material?.dispose?.(); o.geometry?.dispose?.(); });
  linkGroup.children.forEach(o => { o.material?.dispose?.(); o.geometry?.dispose?.(); });

  nodeGroup.clear();
  linkGroup.clear();
  nodeObjects.length = 0;

  // 🔍 Debug the initial term data
  console.log('🔍 Initial termData:', termData);

  // center term
  const termSprite = createTextSprite(termData.term, '#909090ff');
  termSprite.position.set(0, 0, 0);

  // ✅ Use the same ID extraction helper
  const getId = (obj) => obj._id?.$oid || obj._id || obj.id?.$oid || obj.id || null;
  const centerTermId = getId(termData);
  
  console.log('🔍 Center term ID:', centerTermId);

  termSprite.userData = {
    id: centerTermId,
    term: termData.term,
    line: null
  };

  nodeGroup.add(termSprite);
  nodeGroup.userData.center = termSprite;

  // synonyms
  termData.linked_synonyms.forEach((syn, index) => {
    console.log(`🔍 Initial synonym ${index}:`, syn);
    
    const sprite = createTextSprite(syn.term);
    sprite.position.set(syn.x, syn.y, syn.z);
    
    const synonymId = getId(syn);
    console.log(`🔍 Initial synonym ${syn.term} ID:`, synonymId);
    
    sprite.userData = {
      id: synonymId,
      term: syn.term,
      line: null
    };
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);

    // line to center
    const points = [termSprite.position.clone(), sprite.position.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 1 });
    const line = new THREE.Line(geometry, material);
    linkGroup.add(line);

    sprite.userData.line = line; // 🔗 link sprite ⇄ line
  });
}

let rotation = { x: 0, y: 0 };
let rotationVelocity = { x: 0, y: 0 };
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
const INERTIA_DECAY = 0.92;
let clickCandidate = false;

document.addEventListener('mousedown', event => {
  isDragging = true;
  clickCandidate = true;
  previousMousePosition = { x: event.clientX, y: event.clientY };
  rotationVelocity = { x: 0, y: 0 };
});

document.addEventListener('mouseup', async () => {
  // stop drag state first
  const wasDragging = isDragging;
  isDragging = false;

  if (!clickCandidate) return;           // mouse moved too much -> not a click
  clickCandidate = false;                // reset for next interaction

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(nodeObjects);
  if (intersects.length === 0) return;

  const clickedNode = intersects[0].object;
  if (clickedNode === centeredNode) return;  // don't recenter on the already-centered node
  if (isTransitioning) return;               // ignore while an animation is running

  isTransitioning = true;
  centeredNode = clickedNode;

  try {
    // 1) pan & collapse others (wait for it to finish)
    await refocusToNode(clickedNode);

    // 2) fetch by _id
    const id = clickedNode.userData?.id;
    console.log('👉 fetch id:', clickedNode.userData?.id, 'term:', clickedNode.userData?.term);
    if (!id) return;
    if (!visited.has(id)) visited.add(id);
    const data = await loadTermById(clickedNode.userData.id);
    // 3) expand outward
    expandFromNode(clickedNode, data);
  } catch (err) {
    console.error('refocus/fetch error:', err);
  } finally {
    isTransitioning = false;
  }
});

document.addEventListener('mousemove', event => {
  const dx = Math.abs(event.clientX - previousMousePosition.x);
  const dy = Math.abs(event.clientY - previousMousePosition.y);
  if (dx > 5 || dy > 5) clickCandidate = false;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  if (isDragging) {
    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;
    rotation.y += deltaX * 0.005;
    rotation.x += deltaY * 0.005;
    rotationVelocity.y = deltaX * 0.005;
    rotationVelocity.x = deltaY * 0.005;
    previousMousePosition = { x: event.clientX, y: event.clientY };
  }
});

// 
function expandFromNode(centerNode, termDoc) {
  nodeGroup.userData.center = centerNode;
  nodeObjects.length = 0; // now these are the only clickable nodes

  // 🔍 First, let's see what the entire termDoc looks like
  console.log('🔍 Full termDoc:', termDoc);
  console.log('🔍 linked_synonyms array:', termDoc.linked_synonyms);

  termDoc.linked_synonyms.forEach((syn, index) => {
    // 🔍 Debug each synonym object FIRST
    console.log(`🔍 Synonym ${index}:`, syn);
    console.log(`🔍 syn.id:`, syn.id);
    console.log(`🔍 syn._id:`, syn._id);
    console.log(`🔍 syn.id?.$oid:`, syn.id?.$oid);

    const sprite = createTextSprite(syn.term);
    const getId = (obj) => obj.id?.$oid || obj.id || obj._id || null;
    const extractedId = getId(syn);
    
    console.log(`🔍 Extracted ID for ${syn.term}:`, extractedId);
    
    sprite.userData = { id: extractedId, term: syn.term, line: null };

    const finalScale = sprite.scale.clone();
    sprite.scale.set(0, 0, 0);
    sprite.position.copy(centerNode.position);
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);

    const geometry = new THREE.BufferGeometry().setFromPoints([
      centerNode.position.clone(), centerNode.position.clone()
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.0 });
    const line = new THREE.Line(geometry, material);
    linkGroup.add(line);
    sprite.userData.line = line;

    const targetPos = new THREE.Vector3(syn.x, syn.y, syn.z);
    const duration = 900 + Math.random() * 200;
    const start = performance.now();

    function animateOut(time) {
      const t = Math.min((time - start) / duration, 1);
      const ease = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;

      sprite.position.copy(centerNode.position.clone().lerp(targetPos, ease));
      sprite.scale.copy(finalScale.clone().multiplyScalar(ease));

      line.geometry.setFromPoints([centerNode.position, sprite.position]);
      line.geometry.attributes.position.needsUpdate = true;
      line.material.opacity = ease;

      if (t < 1) requestAnimationFrame(animateOut);
    }
    
    requestAnimationFrame(animateOut);
  });
}

function refocusToNode(clickedNode) {
  return new Promise(resolve => {
    const center = nodeGroup.userData.center; // original term
    if (!center) { resolve(); return; }

    const duration = 1000;
    const start = performance.now();

    // move whole group so clicked ends up at origin
    const startGroupPos = nodeGroup.position.clone();
    const endGroupPos = startGroupPos.clone().sub(clickedNode.position.clone());

    // collapse others into original center
    const targetLocal = center.position.clone();
    const collapseList = nodeObjects.filter(n => n !== clickedNode);
    const startPos = collapseList.map(n => n.position.clone());
    const startScale = collapseList.map(n => n.scale.clone());

    function tick(time) {
      const t = Math.min((time - start) / duration, 1);
      const ease = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;

      // recenter/pan
      const newGroupPos = startGroupPos.clone().lerp(endGroupPos, ease);
      nodeGroup.position.copy(newGroupPos);
      linkGroup.position.copy(newGroupPos);

      // collapse others
      collapseList.forEach((node, i) => {
        node.position.copy(startPos[i]).lerp(targetLocal, ease);
        node.scale.copy(startScale[i].clone().lerp(new THREE.Vector3(0,0,0), ease));

        const line = node.userData?.line;
        if (line) {
          line.geometry.setFromPoints([center.position, node.position]);
          line.geometry.attributes.position.needsUpdate = true;
          line.material.transparent = true;
          line.material.opacity = 1 - ease;
        }
      });

      // keep clicked edge updated if it exists (optional)
      const clickedLine = clickedNode.userData?.line;
      if (clickedLine) {
        clickedLine.geometry.setFromPoints([center.position, clickedNode.position]);
        clickedLine.geometry.attributes.position.needsUpdate = true;
      }

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        // cleanup collapsed nodes & lines
        collapseList.forEach(node => {
          const line = node.userData?.line;
          if (line) {
            linkGroup.remove(line);
            line.geometry.dispose();
            line.material.dispose();
          }
          nodeGroup.remove(node);
          node.material?.map?.dispose?.();
          node.material?.dispose?.();
          node.geometry?.dispose?.();

          const idx = nodeObjects.indexOf(node);
          if (idx !== -1) nodeObjects.splice(idx, 1);
        });

        nodeGroup.userData.center = clickedNode; // clicked becomes new root
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}

function animate() {
  requestAnimationFrame(animate);
  if (!isDragging) {
    rotation.x += rotationVelocity.x;
    rotation.y += rotationVelocity.y;
    rotationVelocity.x *= INERTIA_DECAY;
    rotationVelocity.y *= INERTIA_DECAY;
    if (Math.abs(rotationVelocity.x) < 0.0001) rotationVelocity.x = 0;
    if (Math.abs(rotationVelocity.y) < 0.0001) rotationVelocity.y = 0;
  }
  scene.rotation.x = rotation.x;
  scene.rotation.y = rotation.y;
  renderer.render(scene, camera);
}

async function loadTermById(id) {
  console.log('🚀 Fetching term with ID:', id);
  const res = await fetch('/api/term/' + id);
  console.log('📡 Response status:', res.status);
  if (!res.ok) {
    console.error('❌ API Error:', res.status, res.statusText);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  console.log('✅ Received data:', data);
  return data;
}

// === entry point/initial call to db 
// ultimately replace with findOne( random _id )
fetch('/api/term/6890af9c82f836005c903e18')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(data => {
    console.log('✅ Fetched term:', data);
    initializeGraph(data);
  })
  .catch(err => console.error("❌ Failed to load term:", err));
animate();