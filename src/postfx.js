import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, VignetteEffect, NoiseEffect, ChromaticAberrationEffect, SMAAEffect,
} from 'postprocessing';

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.28, luminanceSmoothing: 0.3, mipmapBlur: true });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.85 });
  const noise = new NoiseEffect({ premultiply: true });
  noise.blendMode.opacity.value = 0.055;
  const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0) });
  const smaa = new SMAAEffect();

  // ChromaticAberrationEffect and SMAAEffect both carry the CONVOLUTION
  // attribute, so they can't share an EffectPass with each other (or with
  // anything else that samples neighboring texels) — each gets its own pass.
  composer.addPass(new EffectPass(camera, bloom, vignette, noise));
  composer.addPass(new EffectPass(camera, chroma));
  composer.addPass(new EffectPass(camera, smaa));

  function setChromaAberration(amount) {
    chroma.offset.set(amount * 0.0028, amount * 0.0018);
  }

  function setSize(w, h) {
    composer.setSize(w, h);
  }

  function render(dt) {
    composer.render(dt);
  }

  return { composer, setChromaAberration, setSize, render };
}
