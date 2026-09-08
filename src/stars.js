import catalog from "./data/stars.json";

// One static equatorial atlas, sampled after the shader rotates the local sky
// by Cape Town's latitude and local sidereal time. No per-frame star draw calls.
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
  for (const [ra, dec, magnitude, colorIndex] of catalog.stars) {
    const [x, y] = atlasPoint(ra, dec, width, height);
    const brightness = Math.min(1, 0.24 + Math.pow(10, -0.25 * magnitude));
    const warm = Math.max(0, Math.min(1, Number(colorIndex) / 1.7));
    context.fillStyle = `rgba(${Math.round(190 + 65 * warm)}, ${Math.round(214 + 10 * warm)}, ${Math.round(255 - 74 * warm)}, ${brightness})`;
    const radius = magnitude < 1 ? 1.65 : magnitude < 3 ? 1.0 : 0.65;
    for (const wrap of [-width, 0, width]) {
      context.beginPath();
      context.ellipse(
        x + wrap,
        y,
        radius / Math.max(0.22, Math.cos((dec * Math.PI) / 180)),
        radius,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  const texture = device.createTexture({
    label: "skycope-real-stars",
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
