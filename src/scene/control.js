import { CONFIG } from '../config.js';

export function installControls({ camera, renderer, raycaster, mouse, nodeObjects, onClickSprite }) {
  let isDragging = false;
  let clickCandidate = false;
  let prev = { x: 0, y: 0 };
  let last = { x: 0, y: 0 };

  const rotation = { x: 0, y: 0 };
  const rotationVelocity = { x: 0, y: 0 };

  function rotateCamera(dx, dy) {
    const sx = CONFIG.INVERT_X ? -1 : 1;
    const sy = CONFIG.INVERT_Y ? -1 : 1;
    rotation.y += sx * dx * CONFIG.ROT_SPEED;
    rotation.x += sy * dy * CONFIG.ROT_SPEED;
    rotationVelocity.y = sx * dx * CONFIG.ROT_SPEED;
    rotationVelocity.x = sy * dy * CONFIG.ROT_SPEED;
  }

  function wasClick(thresholdPx = CONFIG.CLICK_THRESHOLD_PX) {
    const movedFar =
      Math.abs(prev.x - last.x) > thresholdPx ||
      Math.abs(prev.y - last.y) > thresholdPx;
    return clickCandidate && !movedFar;
  }

  function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    last = { x: e.clientX, y: e.clientY };
    if (!isDragging) { prev = last; return; }
    rotateCamera(e.clientX - prev.x, e.clientY - prev.y);
    prev = last;
  }

  function onMouseDown(e) {
    isDragging = true;
    clickCandidate = true;
    prev = last = { x: e.clientX, y: e.clientY };
    rotationVelocity.x = 0; rotationVelocity.y = 0;
  }

  function onMouseUp() {
    isDragging = false;
    const click = wasClick();
    clickCandidate = false;
    if (!click) return;

    // Inline pick (Option A)
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(nodeObjects, false)[0];
    const clicked = hit ? hit.object : null;
    if (clicked) onClickSprite?.(clicked);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);

  return {
    rotation,
    rotationVelocity,
    tickInertia() {
      if (isDragging) return;
      rotation.x += rotationVelocity.x;
      rotation.y += rotationVelocity.y;
      rotationVelocity.x *= CONFIG.INERTIA_DECAY;
      rotationVelocity.y *= CONFIG.INERTIA_DECAY;
      if (Math.abs(rotationVelocity.x) < CONFIG.VELOCITY_EPS) rotationVelocity.x = 0;
      if (Math.abs(rotationVelocity.y) < CONFIG.VELOCITY_EPS) rotationVelocity.y = 0;
    },
    dispose() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    }
  };
}