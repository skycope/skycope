import { clock, effect, frameLoop, init, surface } from "vgpu";
import skyShader from "./shaders/sky.wgsl";

const canvas = document.querySelector("#sky");
const sceneButtons = [...document.querySelectorAll(".weather [data-scene]")];
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const state = {
  currentScene: 0,
  targetScene: 0,
  sceneVelocity: 0,
  pointer: [0.5, 0.5],
  targetPointer: [0.5, 0.5],
  gpu: null,
  loop: null,
};

start();

async function start() {
  const initialScene = sceneForCurrentTime();
  state.currentScene = initialScene;
  state.targetScene = initialScene;
  setScene(initialScene);
  connectControls();

  try {
    await startAtmosphere();
    document.body.dataset.renderer = "webgpu";
  } catch (error) {
    document.body.dataset.renderer = "fallback";
    console.warn("WebGPU is unavailable; using the atmospheric fallback.", error);
  }
}

function connectControls() {
  sceneButtons.forEach((button) => {
    button.addEventListener("click", () => setScene(Number(button.dataset.scene)));
  });

  window.addEventListener("pointermove", updatePointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", recenterPointer, { passive: true });
}

function setScene(scene) {
  state.targetScene = scene;
  document.body.dataset.scene = String(scene);
  document.querySelector('meta[name="theme-color"]').content = [
    "#4db8f5",
    "#8a63c7",
    "#17295f",
  ][scene];

  sceneButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.scene) === scene));
  });
}

function sceneForCurrentTime() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 17) return 0;
  if (hour >= 17 && hour < 20) return 1;
  return 2;
}

function updatePointer(event) {
  state.targetPointer[0] = event.clientX / window.innerWidth;
  state.targetPointer[1] = 1 - event.clientY / window.innerHeight;
}

function recenterPointer() {
  state.targetPointer[0] = 0.5;
  state.targetPointer[1] = 0.5;
}

async function startAtmosphere() {
  const gpu = await init();
  const output = surface(gpu, canvas, { dpr: [1, 1] });
  const atmosphere = effect(gpu, skyShader, {
    label: "skycope-atmosphere",
    set: { atmosphere: createUniforms(output.size, 0) },
  });
  const gpuClock = clock(gpu);

  const renderFrame = (currentFrame) => {
    easeInteraction(gpuClock.deltaTime);
    atmosphere.set({
      atmosphere: createUniforms(
        output.size,
        motionPreference.matches ? 24 : gpuClock.time
      ),
    });
    currentFrame.pass(output, atmosphere);
  };

  state.gpu = gpu;
  state.loop = motionPreference.matches
    ? frameLoop(gpu, renderFrame, { fps: 2 })
    : frameLoop(gpu, renderFrame);
}

function createUniforms(resolution, time) {
  return {
    resolution,
    pointer: state.pointer,
    time,
    scene: state.currentScene,
  };
}

function easeInteraction(deltaTime) {
  if (motionPreference.matches) {
    state.currentScene = state.targetScene;
    state.sceneVelocity = 0;
  } else {
    smoothScene(Math.min(deltaTime, 1 / 20));
  }

  const pointerEasing = motionPreference.matches ? 1 : 1 - Math.exp(-deltaTime * 5.5);
  state.pointer[0] += (state.targetPointer[0] - state.pointer[0]) * pointerEasing;
  state.pointer[1] += (state.targetPointer[1] - state.pointer[1]) * pointerEasing;
}

function smoothScene(deltaTime) {
  const smoothTime = 0.64;
  const maxSpeed = 1.05;
  const omega = 2 / smoothTime;
  const decayInput = omega * deltaTime;
  const decay = 1 / (
    1
    + decayInput
    + 0.48 * decayInput * decayInput
    + 0.235 * decayInput * decayInput * decayInput
  );
  const originalTarget = state.targetScene;
  const maxChange = maxSpeed * smoothTime;
  let change = state.currentScene - state.targetScene;
  change = Math.max(-maxChange, Math.min(maxChange, change));

  const adjustedTarget = state.currentScene - change;
  const velocityStep = (state.sceneVelocity + omega * change) * deltaTime;
  state.sceneVelocity = (state.sceneVelocity - omega * velocityStep) * decay;

  const nextScene = adjustedTarget + (change + velocityStep) * decay;
  const crossedTarget = (originalTarget - state.currentScene > 0)
    === (nextScene > originalTarget);

  state.currentScene = crossedTarget ? originalTarget : nextScene;
  if (crossedTarget) state.sceneVelocity = 0;
}

function stopAtmosphere() {
  state.loop?.stop();
  state.gpu?.dispose();
  state.loop = null;
  state.gpu = null;
}

if (import.meta.hot) import.meta.hot.dispose(stopAtmosphere);
