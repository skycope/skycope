// A log-frequency spectrogram PNG with an envelope strip (pngjs).
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import * as A from "../tests/audio/analysis.js";
import { SR } from "../tests/audio/render.js";

// Colour ramp (dark blue → teal → yellow), dB −110…−20 dBFS.
const STOPS = [[8, 10, 30], [30, 40, 110], [20, 120, 140], [90, 190, 110], [240, 230, 90], [255, 255, 230]];
function colour(v) {
  const x = Math.max(0, Math.min(0.9999, v)) * (STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
}

// Log-frequency spectrogram (40 Hz–20 kHz, 160 rows) over `width` columns,
// with a 48 px strip under it: the 10 ms envelope in dBFS (−90…0).
export function spectrogram(signal, path, { width = 640, rows = 160, lo = 40, hi = 20000 } = {}) {
  const size = 2048;
  const hop = Math.max(64, Math.floor((signal.length - size) / width));
  const cols = Math.max(1, Math.min(width, Math.floor((signal.length - size) / hop)));
  const strip = 48;
  const png = new PNG({ width: cols, height: rows + strip + 2 });
  const win = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  for (let x = 0; x < cols; x++) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (signal[x * hop + i] ?? 0) * win[i];
    A.fft(re, im);
    for (let y = 0; y < rows; y++) {
      const f0 = lo * (hi / lo) ** ((rows - 1 - y) / rows);
      const f1 = lo * (hi / lo) ** ((rows - y) / rows);
      let p = 0, n = 0;
      for (let k = Math.floor((f0 * size) / SR); k <= Math.ceil((f1 * size) / SR); k++) {
        p += re[k] * re[k] + im[k] * im[k];
        n++;
      }
      const dbv = 10 * Math.log10(p / Math.max(1, n) / (size / 4) ** 2 + 1e-20);
      const [r, g, b] = colour((dbv + 110) / 90);
      const at = (y * cols + x) * 4;
      png.data[at] = r; png.data[at + 1] = g; png.data[at + 2] = b; png.data[at + 3] = 255;
    }
  }
  // The envelope strip.
  for (let y = rows; y < rows + strip + 2; y++)
    for (let x = 0; x < cols; x++) {
      const at = (y * cols + x) * 4;
      png.data[at] = png.data[at + 1] = png.data[at + 2] = y < rows + 2 ? 0 : 245;
      png.data[at + 3] = 255;
    }
  for (let x = 0; x < cols; x++) {
    let s = 0;
    for (let i = x * hop; i < Math.min(signal.length, x * hop + Math.max(hop, 480)); i++) s += signal[i] * signal[i];
    const dbv = 10 * Math.log10(s / Math.max(hop, 480) + 1e-20);
    const h = Math.round(Math.max(0, Math.min(1, (dbv + 90) / 90)) * strip);
    for (let y = rows + 2 + strip - h; y < rows + 2 + strip; y++) {
      const at = (y * cols + x) * 4;
      png.data[at] = 40; png.data[at + 1] = 60; png.data[at + 2] = 70;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

