import catalog from "./data/stars.json";
import { CATALOG_SIZE, starCatalogCells, halfFloats } from "./star-catalog.js";

// One static equatorial atlas, sampled after the shader rotates the local sky
// by Cape Town's latitude and local sidereal time. No per-frame star draw calls.
// One static equatorial atlas of the constellation figures, sampled after the
// shader rotates the local sky by Cape Town's latitude and local sidereal
// time. Stars themselves are not painted here: see createStarCatalog.
export function createStarAtlas(device) {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "black";
  context.fillRect(0, 0, width, height);
  drawConstellations(context, width, height);
  const texture = device.createTexture({
    label: "skycope-constellations",
    size: [width, height],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [
    width,
    height,
  ]);
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

function drawConstellations(context, width, height) {
  context.strokeStyle = "rgba(110, 160, 190, 0.15)";
  context.lineWidth = 0.7;
  for (const constellation of catalog.constellations) {
    for (const line of constellation) {
      for (let i = 1; i < line.length; i++) {
        const a = atlasPoint(...line[i - 1], width, height);
        const b = atlasPoint(...line[i], width, height);
        if (b[0] - a[0] > width / 2) b[0] -= width;
        if (a[0] - b[0] > width / 2) b[0] += width;
        for (const wrap of [-width, 0, width]) {
          context.beginPath();
          context.moveTo(a[0] + wrap, a[1]);
          context.lineTo(b[0] + wrap, b[1]);
          context.stroke();
        }
      }
    }
  }
}

function atlasPoint(ra, dec, width, height) {
  return [
    ((((ra % 360) + 360) % 360) / 360) * width,
    (0.5 - dec / 180) * height,
  ];
}
