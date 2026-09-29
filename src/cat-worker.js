import { createRig } from "./cat-rig.js";
import { buildCatGeometry } from "./cat-body.js";

// Meshing the cat's body takes a few hundred ms, so it runs off the main
// thread; the typed arrays come back without a copy.
self.onmessage = ({ data }) => {
  const geometry = buildCatGeometry(createRig(), data);
  const attributes = {};
  const transfer = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    attributes[name] = { array: attribute.array, itemSize: attribute.itemSize };
    transfer.push(attribute.array.buffer);
  }
  const index = geometry.index.array;
  transfer.push(index.buffer);
  self.postMessage({ attributes, index }, transfer);
};
