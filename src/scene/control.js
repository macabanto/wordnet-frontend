// scene/control.js
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function installControls({ camera, raycaster, mouse, nodeObjects, onClickSprite }) {
  // --- mouse state ---
  let isDragging = false;
  let clickCandidate = false;
  let prev = { x: 0, y: 0 };
  let last = { x: 0, y: 0 };

  // --- yaw/pitch/roll + velocities (quaternion-based control) ---
  let yaw = 0;     // world Y (left/right)
  let pitch = 0;   // local X after yaw (up/down)
  let roll = 0;    // local Z after yaw·pitch (keep 0 for now)
  let yawVelocity = 0;
  let pitchVelocity = 0;

  // --- keyboard state ---
  const heldKeys = new Set();
  const KEY_STEP = CONFIG.KEY_ROT_STEP ?? 0.025;              // rad/frame while held
  const KEY_RELEASE_GLIDE = CONFIG.KEY_RELEASE_GLIDE ?? 0.02; // small inertia impulse
  const DRAG_CANCEL_PX = CONFIG.CLICK_THRESHOLD_PX ?? 5;

  // --- helpers ---
  function rotateCamera(dx, dy) {
    const sx = CONFIG.INVERT_X ? -1 : 1;
    const sy = CONFIG.INVERT_Y ? -1 : 1;
    yaw   += sx * dx * CONFIG.ROT_SPEED;
    pitch += sy * dy * CONFIG.ROT_SPEED;
    yawVelocity   = sx * dx * CONFIG.ROT_SPEED;
    pitchVelocity = sy * dy * CONFIG.ROT_SPEED;
  }

  function wasClick(thresholdPx = CONFIG.CLICK_THRESHOLD_PX) {
    const movedFar =
      Math.abs(prev.x - last.x) > thresholdPx ||
      Math.abs(prev.y - last.y) > thresholdPx;
    return clickCandidate && !movedFar;
  }

  // --- mouse handlers ---
  function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    last = { x: e.clientX, y: e.clientY };

    if (!isDragging) { prev = last; return; }

    const movedFar =
      Math.abs(last.x - prev.x) > DRAG_CANCEL_PX ||
      Math.abs(last.y - prev.y) > DRAG_CANCEL_PX;
    if (movedFar) clickCandidate = false;

    rotateCamera(e.clientX - prev.x, e.clientY - prev.y);
    prev = last;
  }

  function onMouseDown(e) {
    isDragging = true;
    clickCandidate = true;
    prev = last = { x: e.clientX, y: e.clientY };
    yawVelocity = 0;
    pitchVelocity = 0;
  }

  function onMouseUp() {
    isDragging = false;
    const click = wasClick();
    clickCandidate = false;
    if (!click) return;

    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(nodeObjects, false)[0];
    if (hit?.object) onClickSprite?.(hit.object);
  }

  // --- keyboard handlers (yaw/pitch only for now) ---
  function onKeyDown(e) {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    heldKeys.add(e.key);
    yawVelocity = 0;
    pitchVelocity = 0;
  }

  function onKeyUp(e) {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft')  yawVelocity   = -KEY_RELEASE_GLIDE;
    if (e.key === 'ArrowRight') yawVelocity   = +KEY_RELEASE_GLIDE;
    if (e.key === 'ArrowUp')    pitchVelocity = +KEY_RELEASE_GLIDE;
    if (e.key === 'ArrowDown')  pitchVelocity = -KEY_RELEASE_GLIDE;
    heldKeys.delete(e.key);
  }

  // attach listeners
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('keyup', onKeyUp, { passive: false });

  return {
    getAngles() { return { yaw, pitch, roll }; },     // roll now defined ✅
    setRoll(v) { roll = v; },                         // optional future use
    nudgeRoll(dr) { roll += dr; },                    // optional future use

    tickInertia() {
      if (heldKeys.size > 0) {
        if (heldKeys.has('ArrowLeft'))  yaw   -= KEY_STEP;
        if (heldKeys.has('ArrowRight')) yaw   += KEY_STEP;
        if (heldKeys.has('ArrowUp'))    pitch += KEY_STEP;
        if (heldKeys.has('ArrowDown'))  pitch -= KEY_STEP;
      } else if (!isDragging) {
        yaw   += yawVelocity;
        pitch += pitchVelocity;
        yawVelocity   *= CONFIG.INERTIA_DECAY;
        pitchVelocity *= CONFIG.INERTIA_DECAY;
        if (Math.abs(yawVelocity)   < CONFIG.VELOCITY_EPS)  yawVelocity = 0;
        if (Math.abs(pitchVelocity) < CONFIG.VELOCITY_EPS)  pitchVelocity = 0;
      }
    },

    // Compose yaw→pitch→roll; uses provided angles or falls back to internal
    applyQuaternionTo(target3D, angles) {
      const { yaw: Y, pitch: X, roll: Z } = angles ?? { yaw, pitch, roll };

      const qYaw   = new THREE.Quaternion();
      const qPitch = new THREE.Quaternion();
      const qRoll  = new THREE.Quaternion();

      qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Y);

      const xLocal = new THREE.Vector3(1, 0, 0).applyQuaternion(qYaw);
      qPitch.setFromAxisAngle(xLocal, X);

      const qYawPitch = qYaw.clone().multiply(qPitch);
      const zLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(qYawPitch);
      qRoll.setFromAxisAngle(zLocal, Z || 0);

      target3D.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
      target3D.quaternion.normalize();
    },

    dispose() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    }
  };
}