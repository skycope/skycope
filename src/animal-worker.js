import { packGeometry } from "./animal-forms.js";
import { penguinGeometry } from "./penguins.js";
import { sealGeometry } from "./seals.js";
import { whaleGeometry } from "./whale.js";
import { tortoiseGeometry, oystercatcherGeometry } from "./shore-life.js";

// Meshes the animals' bodies off the main thread (see formGeometry in
// animal-forms.js); the typed arrays come back without a copy.
const BUILDERS = {
  penguin: penguinGeometry,
  seal: sealGeometry,
  whale: whaleGeometry,
  tortoise: tortoiseGeometry,
  oystercatcher: oystercatcherGeometry,
};

self.onmessage = ({ data }) => {
  const { message, transfer } = packGeometry(BUILDERS[data.kind](data.options));
  self.postMessage({ key: data.key, ...message }, transfer);
};
