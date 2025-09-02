import { CONFIG } from './config.js';
import { scene, camera, renderer, raycaster, mouse, debugEl, attachResize } from './scene/scene.js';
import { installControls } from './scene/control.js';
import { nodeObjects } from './graph/state.js';
import { initialiseScene } from './setup.js';
import { transitionToNode, TransitionManager } from './flow/transition.js';

attachResize();

const controls = installControls({
  camera, renderer, raycaster, mouse, nodeObjects,
  onClickSprite: async (clicked) => {
    // same guards you had before
    const centeredNode = scene?.children?.find?.(() => false) || null; // center is tracked on nodeGroup.userData.center; we guard below
    if (!clicked?.userData?.id) return;
    // Don’t compare to centered here; transition function already handles it gracefully.

    TransitionManager.cancelAll();
    try {
      await transitionToNode(clicked, CONFIG.TRANSITION_MODE || 'serial');
    } catch (e) {
      console.error('transition error:', e);
    }
  }
});

function animate() {
  requestAnimationFrame(animate);

  controls.tickInertia();
  scene.rotation.x = controls.rotation.x;
  scene.rotation.y = controls.rotation.y;

  // simple debug
  // (optional) update debugEl with whatever you like
  renderer.render(scene, camera);
}

(async function start() {
  try {
    await initialiseScene();
  } catch (e) {
    console.error('initial load failed:', e);
  }
  animate();
})();