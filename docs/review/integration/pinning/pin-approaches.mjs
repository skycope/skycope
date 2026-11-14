// Approaches to every new landmark solid and trunk: the longest stand-still
// with W held (moved < 5 cm per 0.25 s window).
const root = process.argv[2];
const seed = +(process.argv[3] ?? 1847);
const { island, walkerFor } = await import(root + "/tests/interaction-harness.js");
const { places, obstacles } = island(seed);
const walker = walkerFor(seed);
const { cat, camera } = walker;
const targets = [];
for (const p of places.layout) {
  const R = p.id === "lighthouse" ? 14 : p.id === "milkwood" ? 12 : 8;
  // Solid bodies near the place.
  for (const q of walker.solids.list) {
    if (q.body === false) continue;
    if (Math.hypot(q.x - p.x, q.z - p.z) > R) continue;
    targets.push({ place: p.id, kind: `k${q.k}`, x: q.x, z: q.z, r: Math.min(q.r, 4) });
  }
  for (const t of obstacles.trunks) if (Math.hypot(t.x - p.x, t.z - p.z) < R && t.r > 0.05) targets.push({ place: p.id, kind: "trunk", x: t.x, z: t.z, r: t.r });
  // Tiles (walls as raised tiles, steps): the place's tiles' centres.
  for (const d of obstacles.domes) if (Math.hypot(d.x - p.x, d.z - p.z) < R && d.r < 6) targets.push({ place: p.id, kind: "tile", x: d.x, z: d.z, r: d.r });
}
const fails = [];
let runs = 0;
const worstBy = {};
for (const t of targets) {
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    for (const off of [0, 0.35, -0.35]) {
      const d = t.r + 1.3;
      const x = t.x + Math.sin(ang) * d, z = t.z + Math.cos(ang) * d;
      const s = walker.surface(x, z);
      if (walker.water(x, z).level > s + 0.1) continue;
      if (walker.solids.distance(x, s + 0.17, z, 1) < 0.2) continue;
      if (obstacles.trunks.some((tr) => Math.hypot(tr.x - x, tr.z - z) < tr.r + 0.2)) continue;
      const heading = ang + Math.PI + off;
      cat.x = x; cat.z = z; cat.y = s; cat.heading = heading;
      cat.speed = cat.vy = cat.air = cat.turn = 0; cat.sit = cat.idle = 0; cat.swim = cat.wade = cat.water = 0;
      camera.yaw = heading; camera.elevation = 0.38; camera.distance = 3.4; camera.targetY = cat.y;
      const input = { move: [0, 1], run: false, jump: false };
      let still = 0, worst = 0, px = cat.x, pz = cat.z, wx = 0, wz = 0;
      for (let f = 0; f < 6 * 60; f++) {
        walker.update(1 / 60, input, null);
        if (f % 15 === 14) {
          still = Math.hypot(cat.x - px, cat.z - pz) < 0.05 ? still + 0.25 : 0;
          if (still > worst) { worst = still; wx = cat.x; wz = cat.z; }
          px = cat.x; pz = cat.z;
        }
      }
      runs++;
      const key = `${t.place}`;
      worstBy[key] = Math.max(worstBy[key] ?? 0, worst);
      if (worst > 1) fails.push(`${t.place} ${t.kind} (${t.x.toFixed(1)},${t.z.toFixed(1)}) from (${x.toFixed(1)},${z.toFixed(1)}) h ${heading.toFixed(2)}: still ${worst} s at (${wx.toFixed(2)},${wz.toFixed(2)})`);
    }
  }
}
console.log(`seed ${seed}: ${targets.length} targets, ${runs} approaches, ${fails.length} pinned > 1 s`);
console.log("worst by place", JSON.stringify(worstBy));
for (const f of fails.slice(0, 60)) console.log(f);
