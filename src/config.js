// config.js
export const CONFIG = {
  // API / Data
  API_BASE: import.meta?.env?.VITE_API_BASE ?? '',
  INITIAL_TERM_ID: '6890af9c82f836005c903e18',

  // Camera / Render
  CAMERA_FOV: 75,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 1000,
  CAMERA_Z: 300,

  // Raycaster / Sprite hit-test
  SPRITE_THRESHOLD: 0.8,

  // Orbit / Inertia
  ROT_SPEED: 0.005,
  INERTIA_DECAY: 0.92,
  ROT_LIMIT: Math.PI / 2 - 0.01,
  VELOCITY_EPS: 0.0001,
  INVERT_X: true,
  INVERT_Y: false,

  // Sprite styling
  SPRITE_COLOR: '#bfbfbfff',
  SPRITE_FONT_SIZE: 48,
  SPRITE_PADDING: 6,
  SPRITE_SHADOW_BLUR: 4,
  SPRITE_SCALE_DIVISOR: 4,

  // Lines
  LINE_COLOR: 0xaaaaaa,
  LINE_OPACITY_COLLAPSE_START: 1.0,
  LINE_OPACITY_EXPAND_TARGET: 0.75,

  // Animation timings (ms)
  ANIM_TRANSLATE_MS: 1000,
  ANIM_COLLAPSE_MS: 1000,
  ANIM_EXPAND_MS: 950,
  ANIM_EXPAND_JITTER_MS: 200,

  // Click detection
  CLICK_THRESHOLD_PX: 5,
};

/**
 * Optional: create a runtime-modified config without mutating the base export.
 * Example: const cfg = createConfig({ ROT_SPEED: 0.01, INVERT_X: true })
 */
export function createConfig(overrides = {}) {
  return Object.freeze({ ...CONFIG, ...overrides });
}