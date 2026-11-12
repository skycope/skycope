import catalog from "./data/stars.json";
import { CATALOG_SIZE, starCatalogCells, halfFloats, constellationAtlas } from "./star-catalog.js";

// One static equatorial atlas of the constellation figures, sampled after the
// shader rotates the local sky by Cape Town's latitude and local sidereal
// time. Stars themselves are not painted here: see createStarCatalog. The
// channels (line, drawing order, figure, star nodes) are documented at
// constellationAtlas in star-catalog.js; the stars gift draws from them.
export function createStarAtlas(device) {
  const width = 2048;
  const height = 1024;
  const texture = device.createTexture({
    label: "skycope-constellations",
    size: [width, height],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.writeTexture({ texture }, constellationAtlas(catalog.constellations, width, height), { bytesPerRow: width * 4 }, [width, height]);
  return texture;
}

export function createStarCatalog(device) {
  const [width, height] = CATALOG_SIZE;
  const cells = starCatalogCells(catalog.stars, CATALOG_SIZE);
  const half = halfFloats(cells);
  const texture = device.createTexture({
    label: "skycope-star-catalog",
    size: [width, height],
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture }, half, { bytesPerRow: width * 8 }, [width, height]);
  return texture;
}
