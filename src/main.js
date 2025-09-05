import { CONFIG } from './config.js';
import { scene, camera, renderer, raycaster, mouse, attachResize } from './scene/scene.js';
import { installControls } from './scene/control.js';
import { nodeObjects } from './graph/state.js';
import { initialiseScene } from './setup.js';
import { transitionToNode, TransitionManager } from './flow/transition.js';

attachResize();

const controls = installControls({
  camera,
  raycaster,
  mouse,
  nodeObjects,
  onClickSprite: async (clicked) => {
    if (!clicked?.userData?.id) return; // safety
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
  controls.applyQuaternionTo(scene, controls.getAngles());

  // Debug example:
  // const { yaw, pitch } = controls.getAngles();
  // document.getElementById('debug').textContent = `yaw=${yaw.toFixed(2)}  pitch=${pitch.toFixed(2)}`;

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