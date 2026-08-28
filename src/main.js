import { clock, effect, frameLoop, init, surface } from "vgpu";
import skyShader from "./shaders/sky.wgsl";

const canvas = document.querySelector("#sky");
const sceneButtons = [...document.querySelectorAll(".weather [data-scene]")];
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const state = {
  currentScene: 0,
  targetScene: 0,
  pointer: [0.5, 0.5],
  targetPointer: [0.5, 0.5],
  gpu: null,
  loop: null,
};

start();

async function start() {
  setScene(sceneForCurrentTime());
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
}

function setScene(scene) {
  state.targetScene = scene;
  document.body.dataset.scene = String(scene);
  document.querySelector('meta[name="theme-color"]').content = [
    "#76bce8",
    "#5f4b88",
    "#061127",
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

async function startAtmosphere() {
  const gpu = await init();
  const output = surface(gpu, canvas, { dpr: [1, 1.6] });
  const atmosphere = effect(gpu, skyShader, {
    label: "skycope-atmosphere",
    set: { atmosphere: createUniforms(output.size, 0) },
  });
  const gpuClock = clock(gpu);

  state.gpu = gpu;
  state.loop = frameLoop(gpu, (currentFrame) => {
    easeInteraction();
    atmosphere.set({
      atmosphere: createUniforms(
        output.size,
        motionPreference.matches ? 24 : gpuClock.time
      ),
    });
    currentFrame.pass(output, atmosphere);
  }, { fps: motionPreference.matches ? 2 : 30 });
}

function createUniforms(resolution, time) {
  return {
    resolution,
    pointer: state.pointer,
    time,
    scene: state.currentScene,
  };
}

function easeInteraction() {
  const easing = motionPreference.matches ? 1 : 0.055;
  state.currentScene += (state.targetScene - state.currentScene) * easing;
  state.pointer[0] += (state.targetPointer[0] - state.pointer[0]) * easing;
  state.pointer[1] += (state.targetPointer[1] - state.pointer[1]) * easing;
}

function stopAtmosphere() {
  state.loop?.stop();
  state.gpu?.dispose();
  state.loop = null;
  state.gpu = null;
}

if (import.meta.hot) import.meta.hot.dispose(stopAtmosphere);
