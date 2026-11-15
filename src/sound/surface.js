// What a paw is on, from what is really under it (owner, 15 Nov: the
// footsteps were "off"; the old rule called any raised surface rock and
// used fixed distances from the shore for sand, scrub and forest).
//
//   walker.surfaceAt(x, z) says which surface won: the boat's deck, a
//   place's made tile, a boulder (or crevice bridge), the seabed, or the
//   ground.
//   - deck                     → the deck
//   - a place's tile           → its material, by place (place-kit's five:
//                                limewash and rubble are stone, timber,
//                                iron/rust): the lighthouse, stoep, steps,
//                                walls and the cairn are stone (rock); the
//                                wreck's keelson and frames, the boat ashore
//                                and the milkwood's roots and limb are
//                                timber; the boiler (its top, and inside it,
//                                under its cover) is metal
//   - a boulder                → rock
//   - the ground               → mirrors the ground shader (forest.js):
//                                wet sand below the wet band's midpoint
//                                (0.85 m inland), litter under a crown,
//                                exposed granite where the rocky mask is,
//                                painted strandveld scrub (ground-detail.js
//                                groundCover), sour-fig mats as soft grass,
//                                dry sand to the sand's edge (~7 m), grass
//                                beyond.
import { SURFACE } from "./patches.js";
import { groundCover } from "../ground-detail.js";
import { noise2, terrainHeight, shoreDistance, smoothstep } from "../terrain.js";

const PLACE_MATERIAL = { lighthouse: "stone", beacon: "stone", pool: "stone", milkwood: "timber", wreck: "timber", boat: "timber" };

// Whether (x, z) is inside a cover (a yawed box or a circle).
export function inCover(c, x, z, pad = 0) {
  const dx = x - c.x, dz = z - c.z;
  if (Number.isFinite(c.r)) return Math.hypot(dx, dz) <= c.r + pad;
  const s = Math.sin(c.yaw ?? 0), k = Math.cos(c.yaw ?? 0);
  const along = dx * s + dz * k;
  const across = dx * k - dz * s;
  return Math.abs(along) <= (c.hu ?? 0) + pad && Math.abs(across) <= (c.hv ?? 0) + pad;
}

// The ground shader's rocky mask (forest.js addGround), for granite
// outcrops that are ground, not boulders.
function rockyGround(x, z, inland) {
  const fbm = (u, v) => noise2(u, v) * 0.5 + noise2(u * 2.1 + 5, v * 2.1) * 0.27 + noise2(u * 4.3, v * 4.3 + 3) * 0.15 + noise2(u * 8.7 + 1, v * 8.7) * 0.08;
  const gx = (terrainHeight(x + 0.75, z) - terrainHeight(x - 0.75, z)) / 1.5;
  const gz = (terrainHeight(x, z + 0.75) - terrainHeight(x, z - 0.75)) / 1.5;
  const upness = 1 / Math.sqrt(1 + gx * gx + gz * gz);
  const steep = smoothstep(0.8, 0.55, upness + (noise2(x * 0.4, z * 0.4) - 0.5) * 0.12);
  return Math.max(steep, smoothstep(0.62, 0.76, fbm(x * 0.13 + 4, z * 0.13)) * smoothstep(14, 24, inland));
}

export function createSurfaceResolver() {
  const world = { pois: [], covers: [], habitat: null };

  function placeOfTile(tile) {
    let best = null, bestD = Infinity;
    for (const p of world.pois) {
      const d = Math.hypot(tile.x - p.x, tile.z - p.z) - (p.r ?? 6) - (tile.r ?? 0);
      if (d < 2 && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  // The canopy over (x, z), 0…1 (habitat crowns, as precipitation.js).
  function canopy(x, z) {
    const h = world.habitat;
    if (!h) return 0;
    let c = 0;
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const k of h.crowns.get(`${cx + dx},${cz + dz}`) ?? []) {
          const radial = ((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r);
          if (radial < 1) c = Math.max(c, 1 - radial * 0.6);
        }
    return c;
  }

  const boiler = () => world.covers.find((c) => c.place === "wreck" && c.kind === "roof") ?? null;

  // walker kind (0 rock/raised, 1 wet sand, 2 dry sand, 3 scrub, 4 forest,
  // 5 water) + what is under the paw → { surface, why }.
  function resolve(kind, { x, z, under = null, depth = 0 } = {}) {
    if (kind === 5 || under?.on === "seabed") return { surface: SURFACE.shallows, why: `water ${depth.toFixed?.(2) ?? depth} m` };
    if (!Number.isFinite(x)) return { surface: kind, why: "no position" };
    const b = boiler();
    if (b && inCover(b, x, z)) return { surface: SURFACE.metal, why: "inside the boiler" };
    if (under?.on === "deck") return { surface: SURFACE.deck, why: "deck" };
    if (under?.on === "tile" && under.tile) {
      const place = placeOfTile(under.tile);
      const material = PLACE_MATERIAL[place?.id] ?? "stone";
      if (place?.id === "wreck" && b && inCover(b, under.tile.x, under.tile.z, 1.2)) return { surface: SURFACE.metal, why: "the boiler's top" };
      return { surface: material === "timber" ? SURFACE.timber : SURFACE.rock, why: `${place?.id ?? "a place"}: ${material}` };
    }
    if (under?.on === "rock" || (kind === 0 && !under)) return { surface: SURFACE.rock, why: under?.tile?.bridge ? "crevice" : "boulder" };
    // The ground, as the ground shader paints it.
    const inland = shoreDistance(x, z);
    if (inland < 0.85) return { surface: SURFACE.wetSand, why: `wet band (${inland.toFixed(1)} m)` };
    const shade = canopy(x, z);
    if (shade > 0.45) return { surface: SURFACE.forest, why: `under a crown (${shade.toFixed(2)})` };
    if (inland > 6 && rockyGround(x, z, inland) > 0.6) return { surface: SURFACE.rock, why: "granite ground" };
    const cover = groundCover(x, z, inland, shade);
    if (cover.scrub > 0.45) return { surface: SURFACE.scrub, why: `strandveld (${cover.scrub.toFixed(2)})` };
    if (cover.sourfig > 0.5) return { surface: SURFACE.grass, why: `sour-fig mat (${cover.sourfig.toFixed(2)})` };
    if (inland < 7) return { surface: SURFACE.drySand, why: `dry sand (${inland.toFixed(1)} m)` };
    return { surface: SURFACE.grass, why: `turf (${inland.toFixed(1)} m)` };
  }

  return {
    world,
    resolve,
    canopy,
    inCover,
    // Which cover the cat stands under: "eave", "boiler", "tree", or null.
    shelter(x, z, y = -Infinity) {
      for (const c of world.covers) {
        if (!inCover(c, x, z)) continue;
        // Inside the boiler, not on top of it.
        if (c.place === "wreck" && c.kind === "roof") {
          if (y < c.y - 0.3) return "boiler";
          continue;
        }
        if (c.kind === "eave") return "eave";
        if (c.kind === "crown") return "tree";
      }
      return canopy(x, z) > 0.55 ? "tree" : null;
    },
    // The roofs rain drums on (not the boiler's), as sound sources.
    roofs() {
      return world.covers.filter((c) => c.kind === "roof" && c.place !== "wreck").map((c) => ({ x: c.x, z: c.z, y: c.y, r: Math.max(c.hu ?? 2, c.hv ?? 2) }));
    },
  };
}
