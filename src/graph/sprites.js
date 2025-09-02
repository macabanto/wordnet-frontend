import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createTextSprite(text) {
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