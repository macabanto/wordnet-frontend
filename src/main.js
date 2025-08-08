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
  nodeGroup.clear();
  linkGroup.clear();
  nodeObjects.length = 0;

  const termSprite = createTextSprite(termData.term, '#909090ff');
  termSprite.position.set(0, 0, 0);
  nodeGroup.add(termSprite);

  // We'll store lines in a new structure to keep track of connections
  nodeObjects.term = termSprite; // Save reference to center node
  nodeObjects.edges = [];        // Array of { line, targetNode }

  termData.linked_synonyms.forEach(syn => {
    const sprite = createTextSprite(syn.term);
    sprite.position.set(syn.x, syn.y, syn.z);
    nodeGroup.add(sprite);
    nodeObjects.push(sprite);

    // Draw and store line
    const points = [termSprite.position.clone(), sprite.position.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xaaaaaa });
    const line = new THREE.Line(geometry, material);
    linkGroup.add(line);

    // Track the connection so we can animate it later
    nodeObjects.edges.push({ line, targetNode: sprite });
  });
}

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

document.addEventListener('mouseup', event => {
  if (clickCandidate) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(nodeObjects);

    if (intersects.length > 0) {
      const clickedNode = intersects[0].object;

      // Recenter around the node, then clean up the others
      recenterAroundNode(clickedNode, () => {
        focusOnNode(clickedNode);
      });
    }
  }

  isDragging = false;
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

function focusOnNode(clickedNode) {
  const duration = 1000;
  const start = performance.now();
  const targetPos = new THREE.Vector3(0, 0, 0);

  const movingNodes = nodeObjects.filter(node => node !== clickedNode);
  const startPositions = movingNodes.map(node => node.position.clone());
  const startScales = movingNodes.map(node => node.scale.clone());
  const targetScale = new THREE.Vector3(0, 0, 0); // shrink to nothing

  function animateFocus(time) {
    const t = Math.min((time - start) / duration, 1);
    const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    movingNodes.forEach((node, i) => {
      // Move toward center
      const newPos = startPositions[i].clone().lerp(targetPos, easedT);
      node.position.copy(newPos);

      // Shrink down
      const newScale = startScales[i].clone().lerp(targetScale, easedT);
      node.scale.copy(newScale);
    });

    // Remove all lines except the one connecting termSprite and clickedNode
linkGroup.children.forEach((line) => {
  const positions = line.geometry.attributes.position.array;

  const endPos = new THREE.Vector3(positions[3], positions[4], positions[5]);

  const matchesClickedNode = endPos.distanceTo(clickedNode.position) < 0.001;

  if (!matchesClickedNode) {
    linkGroup.remove(line);
  }
});

    if (t < 1) requestAnimationFrame(animateFocus);
  }

  requestAnimationFrame(animateFocus);
}

function recenterAroundNode(targetNode, onComplete) {
  const duration = 1000;
  const start = performance.now();

  const nodeLocalPos = targetNode.position.clone();  // Use local coords
  const startGroupPos = nodeGroup.position.clone();
  const endGroupPos = startGroupPos.clone().sub(nodeLocalPos);

  function animateRecenter(time) {
    const t = Math.min((time - start) / duration, 1);
    const easedT = t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;

    const newGroupPos = startGroupPos.clone().lerp(endGroupPos, easedT);
    nodeGroup.position.copy(newGroupPos);
    linkGroup.position.copy(newGroupPos);

    if (t < 1) {
      requestAnimationFrame(animateRecenter);
    } else if (onComplete) {
      onComplete();
    }
  }

  requestAnimationFrame(animateRecenter);
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
animate();