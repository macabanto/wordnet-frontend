import * as THREE from 'three';
//console.log('✅ main.js loaded');
const width = window.innerWidth; // browser provided; determines scene dimensions
const height = window.innerHeight; // browser provided; determines scene dimensions
const API_BASE = import.meta.env.VITE_API_BASE;

// === Setup scene ===
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
camera.position.z = 300;

const raycaster = new THREE.Raycaster();// determines object placement between camera and scene
const mouse = new THREE.Vector2();// three.mouse

const renderer = new THREE.WebGLRenderer({ antialias: true });// anti-aliasing
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(width, height);
document.getElementById('container').appendChild(renderer.domElement);

const nodeObjects = [];// ? ? ?, this can probably be something else
const nodeGroup = new THREE.Group();// holds all node sprites 
const linkGroup = new THREE.Group();// holds all edge sprites
let centeredNode = null;// pointer to user-selected lemma
let isTransitioning = false;// is the scene in between showing words ?

scene.add(nodeGroup);
scene.add(linkGroup);

let rotation = { x: 0, y: 0 }; // orientation of camera facing the scene
let rotationVelocity = { x: 0, y: 0 }; // determines rotational inertia
let isDragging = false; // tracks whether the pointer is currently dragging to orbit
let previousMousePosition = { x: 0, y: 0 }; // anytime the user puts the mouse down, save that point
const INERTIA_DECAY = 0.92; // slows rotation down
let clickCandidate = false; // mouse boolean - disambiguates user click; did they click or drag

function createTextSprite(text) {
  const color = '#bfbfbfff'// color
  const fontSize = 52;// text font-size
  const padding = 5;// area around text
  const dpr = window.devicePixelRatio || 1;// 

  const canvas = document.createElement('canvas'); // plane for text sprite
  const context = canvas.getContext('2d'); // not too sure
  context.font = `bold ${fontSize}px Arial`; // text sprite font
  const textWidth = context.measureText(text).width; // 
  const textHeight = fontSize;

  canvas.width = (textWidth + padding * 2) * dpr; //
  canvas.height = (textHeight + padding * 2) * dpr;// 
  context.scale(dpr, dpr); // 
  context.font = `bold ${fontSize}px Arial`; // 
  context.textAlign = 'center'; // 
  context.textBaseline = 'middle'; //
  context.clearRect(0, 0, canvas.width, canvas.height); //
  context.shadowColor = 'black'; // is this necessary ? could this value be left blank ?
  context.shadowBlur = 4; // is this necessary ? could this be left blank ?
  context.fillStyle = color; // 
  context.fillText(text, (canvas.width / dpr) / 2, (canvas.height / dpr) / 2); // 

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true; // not sure what this does in this context
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  const scaleFactor = 5; 
  sprite.scale.set(canvas.width / dpr / scaleFactor, canvas.height / dpr / scaleFactor, 1);
  return sprite;
}

document.addEventListener('mousedown', event => {
  // js event listener
  // user presses mouse down
  // retain mouse location
  // 
});

document.addEventListener('mouseup', event => {
  // js event listenenr
  // user releases mouse
  // determines whether this was a click, or drag
  // - a click if the mouseup event occurs at the same ( x,y ) coordinate as the mousedown event
  // - a drag if the mouseup event occurs at a different ( x,y ) coordiante than the mousedown event
  
})