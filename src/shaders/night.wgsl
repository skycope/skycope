// The night sky, shared by the low-resolution sky pass (the Milky Way's
// diffuse glow, which clouds then cover) and the sharp composite pass (point
// stars, faint star dust and the Moon's disc, which must stay pixel-crisp).
// Directions are local east / up / north; celestial.x is local sidereal time
// and celestial.y the observer's latitude, both in radians.

const TAU: f32 = 6.283185;

// Local direction -> J2000 equatorial unit vector (x toward RA 0, z toward
// the north celestial pole). The same rotation as the old atlas lookup.
export fn equatorial_from_local(ray: vec3f, sidereal: f32, latitude: f32) -> vec3f {
  let hz = ray.z * cos(latitude) + ray.y * sin(latitude);
  let hx = ray.y * cos(latitude) - ray.z * sin(latitude);
  let hy = -ray.x;
  let c = cos(sidereal);
  let s = sin(sidereal);
  return vec3f(c * hx + s * hy, s * hx - c * hy, hz);
}

export fn local_from_equatorial(eq: vec3f, sidereal: f32, latitude: f32) -> vec3f {
  let c = cos(sidereal);
  let s = sin(sidereal);
  let hx = c * eq.x + s * eq.y;
  let hy = s * eq.x - c * eq.y;
  let hz = eq.z;
  return vec3f(-hy, hx * cos(latitude) + hz * sin(latitude), hz * cos(latitude) - hx * sin(latitude));
}

// IAU J2000 equatorial -> galactic rotation: x toward the galactic centre in
// Sagittarius, z toward the north galactic pole.
export fn galactic_from_equatorial(eq: vec3f) -> vec3f {
  return vec3f(
    dot(eq, vec3f(-0.0548756, -0.8734371, -0.4838350)),
    dot(eq, vec3f(0.4941094, -0.4448296, 0.7469822)),
    dot(eq, vec3f(-0.8676661, -0.1980764, 0.4559838)),
  );
}

fn eq_from_radec(ra_deg: f32, dec_deg: f32) -> vec3f {
  let ra = radians(ra_deg);
  let dec = radians(dec_deg);
  return vec3f(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec));
}

// Integrated starlight of the Galaxy, before dust: a thin disc brightening
// toward the central bulge. Smooth, so the composite pass can use it to
// place faint stars without sampling noise.
export fn galaxy_density(gal: vec3f) -> f32 {
  let l = atan2(gal.y, gal.x);
  let b = asin(clamp(gal.z, -1.0, 1.0));
  let toward_centre = 0.5 + 0.5 * cos(l);
  let thickness = 0.07 + 0.06 * toward_centre;
  let disc = exp(-(b * b) / (thickness * thickness)) * (0.35 + 0.65 * toward_centre);
  let bulge = exp(-(l * l) / 0.16 - (b * b) / 0.03);
  return disc + bulge * 2.2;
}

// Dust: the Great Rift splitting the band from Cygnus to Sagittarius, the
// Coalsack beside the Southern Cross, and patchy lanes along the plane.
// `clump` and `fine` are noise in [0, 1]: they wander the rift's line,
// vary its width and break it into filaments and knots, as real dark
// nebulae are, rather than one ruled stripe.
fn galaxy_dust(gal: vec3f, eq: vec3f, clump: f32, fine: f32) -> f32 {
  let l = atan2(gal.y, gal.x);
  let b = asin(clamp(gal.z, -1.0, 1.0));
  let rift_line = b - 0.018 - 0.02 * sin(l * 3.0) + (clump - 0.5) * 0.05;
  let width = 0.0006 + 0.0012 * fine;
  let rift = exp(-(rift_line * rift_line) / width) * (1.0 - smoothstep(0.5, 1.5, abs(l - 0.35)));
  let lanes = exp(-(b * b) / (0.0012 + 0.002 * clump)) * 0.6;
  let coalsack = exp(-pow(acos(clamp(dot(eq, eq_from_radec(192.8, -62.9)), -1.0, 1.0)) / 0.045, 2.0));
  let ragged = smoothstep(0.25, 0.7, fine * 0.7 + clump * 0.3);
  return clamp((rift * 0.9 + lanes) * ragged + coalsack * 0.8, 0.0, 0.92);
}

// The diffuse Milky Way and the Magellanic Clouds in exposed linear units,
// scaled for a dark-adapted eye. `clump` is multi-octave noise in [0, 1] at
// this direction (the caller owns the noise texture): it breaks the band
// into star clouds and ragged dust.
export fn milky_way(eq: vec3f, clump: f32, fine: f32) -> vec3f {
  let gal = galactic_from_equatorial(eq);
  let l = atan2(gal.y, gal.x);
  let density = galaxy_density(gal);
  let clouds = 0.3 + 1.2 * smoothstep(0.3, 0.8, clump) * (0.6 + 0.8 * fine);
  let dust = galaxy_dust(gal, eq, clump, fine);
  // Old bulge stars are warm; the young disc toward the anticentre is bluer.
  let warmth = exp(-(l * l) / 0.5);
  let colour = mix(vec3f(0.78, 0.86, 1.0), vec3f(1.0, 0.86, 0.66), warmth);
  var light = colour * density * clouds * (1.0 - dust);
  // LMC and SMC: detached, grainy patches of the southern sky.
  let lmc = exp(-pow(acos(clamp(dot(eq, eq_from_radec(80.9, -69.8)), -1.0, 1.0)) / 0.06, 2.0));
  let smc = exp(-pow(acos(clamp(dot(eq, eq_from_radec(13.2, -72.8)), -1.0, 1.0)) / 0.035, 2.0));
  light += vec3f(0.85, 0.88, 1.0) * (lmc * 0.9 + smc * 0.55) * (0.7 + fine * 0.6);
  return light * 0.045;
}

// Approximate stellar colour from the B-V index (blue-white O/B stars to
// orange-red K/M giants), normalised to unit luminance.
export fn star_colour(bv: f32) -> vec3f {
  let t = clamp((bv + 0.3) / 2.1, 0.0, 1.0);
  let c = mix(vec3f(0.72, 0.82, 1.25), vec3f(1.0, 0.97, 0.92), smoothstep(0.0, 0.33, t));
  let warm = mix(c, vec3f(1.3, 0.86, 0.52), smoothstep(0.33, 1.0, t));
  return warm / dot(warm, vec3f(0.2126, 0.7152, 0.0722));
}

fn night_hash(p: vec2f) -> vec2f {
  var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Catalog stars as point sources. `catalog` is an equirectangular grid of
// cells, each holding one star's offset within the cell (rg), flux relative
// to magnitude 0 (b) and B-V (a); empty cells have zero flux. `pixel` is the
// angle one pixel subtends. Each star is a Gaussian spot about a pixel wide
// carrying its full flux, so brightness follows magnitude and a star never
// smears across the sky; bright stars add a faint scattered halo.
//
// `background` is the sky luminance behind the star: a star is only seen
// against it by contrast, so a bright moonlit or twilight sky hides the
// faint ones first, as it does to the eye.
export fn catalog_stars(eq: vec3f, catalog: texture_2d<f32>, pixel: f32, time: f32, airmass: f32, background: f32) -> vec3f {
  let size = vec2i(textureDimensions(catalog));
  let dims = vec2f(size);
  let ra = atan2(eq.y, eq.x);
  let dec = asin(clamp(eq.z, -1.0, 1.0));
  let coord = vec2f(fract(ra / TAU), 0.5 - dec / 3.141593) * dims;
  let base = vec2i(floor(coord));
  // Exactly zero: no star within the search window (see star-catalog.js).
  if (textureLoad(catalog, vec2i((base.x + size.x) % size.x, clamp(base.y, 0, size.y - 1)), 0).b == 0.0) {
    return vec3f(0.0);
  }
  let sigma = pixel * 0.72;
  // Cells narrow toward the poles; search wider in right ascension there.
  let reach = i32(clamp(ceil(1.2 / max(cos(dec), 0.2)), 1.0, 5.0));
  var total = vec3f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    let y = base.y + dy;
    if (y < 0 || y >= size.y) { continue; }
    for (var dx = -reach; dx <= reach; dx++) {
      let x = (base.x + dx + size.x) % size.x;
      let star = textureLoad(catalog, vec2i(x, y), 0);
      if (star.b <= 0.0) { continue; }
      let at = (vec2f(f32(x), f32(y)) + star.rg) / dims;
      let star_ra = at.x * TAU;
      let star_dec = (0.5 - at.y) * 3.141593;
      let direction = vec3f(cos(star_dec) * cos(star_ra), cos(star_dec) * sin(star_ra), sin(star_dec));
      let offset = length(eq - direction);
      // Scintillation: turbulence makes stars twinkle, far more near the horizon.
      let seed = night_hash(vec2f(f32(x), f32(y)));
      let twinkle = 1.0 + (0.08 + 0.4 * smoothstep(1.5, 6.0, airmass))
        * sin(time * (9.0 + seed.x * 11.0) + seed.y * TAU) * sin(time * (5.3 + seed.y * 7.0));
      let core = exp(-(offset * offset) / (2.0 * sigma * sigma)) / (TAU * 0.72 * 0.72);
      let halo = exp(-offset / (pixel * 3.5)) * 0.012 * smoothstep(0.4, 4.0, star.b);
      let seen = smoothstep(0.3, 1.5, star.b * 6.8 / (background * 3.0 + 0.002));
      total += star_colour(star.a) * star.b * twinkle * seen * (core + halo);
    }
  }
  return total * 22.0;
}

// Stars too faint for the catalog, scattered in proportion to the Galaxy's
// light: they resolve the Milky Way into grain instead of a smooth glow.
export fn faint_stars(eq: vec3f, pixel: f32, background: f32) -> vec3f {
  let ra = atan2(eq.y, eq.x);
  let dec = asin(clamp(eq.z, -1.0, 1.0));
  let cells = vec2f(4096.0, 2048.0);
  let coord = vec2f(fract(ra / TAU), 0.5 - dec / 3.141593) * cells;
  let base = floor(coord);
  let density = galaxy_density(galactic_from_equatorial(eq));
  // Equal-area correction: equirectangular cells shrink toward the poles.
  let chance = (0.008 + 0.3 * min(density, 1.5)) * cos(dec);
  let seen = 1.0 - smoothstep(0.012, 0.05, background);
  if (seen <= 0.0) { return vec3f(0.0); }
  let sigma = pixel * 0.7;
  var total = vec3f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let cell = base + vec2f(f32(dx), f32(dy));
      let h = night_hash(cell + vec2f(17.0, 3.0));
      if (h.x > chance) { continue; }
      let jitter = night_hash(cell * 1.37 + 5.0);
      let at = (vec2f(fract(cell.x / cells.x), cell.y / cells.y) * cells + jitter) / cells;
      let star_ra = at.x * TAU;
      let star_dec = (0.5 - at.y) * 3.141593;
      let direction = vec3f(cos(star_dec) * cos(star_ra), cos(star_dec) * sin(star_ra), sin(star_dec));
      let offset = length(eq - direction);
      // Magnitudes 5.5-8: a steep luminosity function, mostly very faint.
      let flux = pow(10.0, -0.4 * (5.6 + 2.4 * pow(h.y, 0.6)));
      let colour = star_colour(mix(-0.1, 1.4, jitter.x));
      total += colour * flux * exp(-(offset * offset) / (2.0 * sigma * sigma)) / (TAU * 0.7 * 0.7);
    }
  }
  return total * 22.0 * seen;
}

// Named near-side features in selenographic latitude / longitude (degrees,
// east positive toward Mare Crisium) with an angular radius.
fn moon_feature(p: vec3f, lat: f32, lon: f32, radius: f32, soft: f32) -> f32 {
  let la = radians(lat);
  let lo = radians(lon);
  let centre = vec3f(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
  let angle = acos(clamp(dot(p, centre), -1.0, 1.0));
  return 1.0 - smoothstep(radians(radius - soft), radians(radius + soft), angle);
}

fn moon_hash3(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn moon_noise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(moon_hash3(i), moon_hash3(i + vec3f(1.0, 0.0, 0.0)), u.x),
      mix(moon_hash3(i + vec3f(0.0, 1.0, 0.0)), moon_hash3(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(moon_hash3(i + vec3f(0.0, 0.0, 1.0)), moon_hash3(i + vec3f(1.0, 0.0, 1.0)), u.x),
      mix(moon_hash3(i + vec3f(0.0, 1.0, 1.0)), moon_hash3(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}

// Normal albedo of the near side at selenographic point p (unit vector, z
// toward Earth, y lunar north, x lunar east): dark basaltic maria in their
// real places (the familiar face), bright highlands, and young rayed craters.
fn moon_albedo(p: vec3f) -> f32 {
  let edge = (moon_noise(p * 9.0) - 0.5) * 3.0 + (moon_noise(p * 23.0) - 0.5) * 1.5;
  var mare = 0.0;
  mare = max(mare, moon_feature(p, 33.0, -16.0, 17.0 + edge, 2.5));   // Imbrium
  mare = max(mare, moon_feature(p, 20.0, -55.0, 17.0 + edge, 4.0));   // Procellarum, north
  mare = max(mare, moon_feature(p, 2.0, -48.0, 15.0 + edge, 4.0));    // Procellarum, south
  mare = max(mare, moon_feature(p, 7.0, -30.0, 9.0 + edge, 3.0));     // Insularum
  mare = max(mare, moon_feature(p, 28.0, 17.5, 10.5 + edge, 2.0));    // Serenitatis
  mare = max(mare, moon_feature(p, 8.5, 31.0, 12.5 + edge, 2.5));     // Tranquillitatis
  mare = max(mare, moon_feature(p, 17.0, 59.0, 7.5 + edge * 0.5, 1.5)); // Crisium
  mare = max(mare, moon_feature(p, -7.5, 52.0, 10.0 + edge, 2.5));    // Fecunditatis
  mare = max(mare, moon_feature(p, -15.0, 35.0, 6.0 + edge * 0.5, 1.5)); // Nectaris
  mare = max(mare, moon_feature(p, -21.0, -17.0, 10.0 + edge, 3.0));  // Nubium
  mare = max(mare, moon_feature(p, -10.0, -23.0, 6.0 + edge, 2.5));   // Cognitum
  mare = max(mare, moon_feature(p, -24.0, -39.0, 5.5 + edge * 0.5, 1.5)); // Humorum
  mare = max(mare, moon_feature(p, 13.0, 4.0, 4.5 + edge * 0.5, 1.5)); // Vaporum
  mare = max(mare, moon_feature(p, 56.0, -15.0, 7.0 + edge * 0.5, 2.5)); // Frigoris
  mare = max(mare, moon_feature(p, 57.0, 12.0, 6.5 + edge * 0.5, 2.5));
  mare = max(mare, moon_feature(p, 52.0, -9.5, 1.6, 0.4));            // Plato's dark floor
  // Highlands: bright, rough, mottled by overlapping impact basins.
  let mottle = moon_noise(p * 14.0) * 0.6 + moon_noise(p * 40.0) * 0.4;
  var albedo = mix(0.14 + mottle * 0.05, 0.068 + mottle * 0.02, mare);
  // Young craters and their ray systems, brightest at full moon.
  let tycho_la = radians(-43.3);
  let tycho_lo = radians(-11.2);
  let tycho = vec3f(cos(tycho_la) * sin(tycho_lo), sin(tycho_la), cos(tycho_la) * cos(tycho_lo));
  let from_tycho = acos(clamp(dot(p, tycho), -1.0, 1.0));
  let across = normalize(cross(tycho, p) + vec3f(1e-5));
  let spoke = moon_noise(across * 38.0) * moon_noise(across * 91.0);
  albedo += smoothstep(0.35, 0.55, spoke) * exp(-from_tycho / 0.45) * 0.06;
  albedo += moon_feature(p, -43.3, -11.2, 1.3, 0.5) * 0.1;            // Tycho
  albedo += moon_feature(p, 9.6, -20.1, 1.4, 0.6) * 0.07;             // Copernicus
  albedo += moon_feature(p, 8.1, -38.0, 0.9, 0.5) * 0.06;             // Kepler
  albedo += moon_feature(p, 23.7, -47.4, 0.7, 0.4) * 0.12;            // Aristarchus
  albedo += smoothstep(0.62, 0.8, moon_noise(p * 60.0)) * 0.03;       // small fresh craters
  return albedo;
}

// The Moon's disc in exposed linear radiance (rgb) and coverage (a). Lit by
// the true sun direction, so phase and the lit limb are exact; oriented with
// lunar north toward the ecliptic pole (within 1.5° of the Moon's axis), so
// from Cape Town it hangs "upside down" relative to a northern view.
// Lommel-Seeliger reflection keeps the full moon flat-bright to the limb.
export fn moon_disc(ray: vec3f, moon: vec3f, sun: vec3f, sidereal: f32, latitude: f32,
  pixel: f32, radius: f32, sunlight_at_moon: vec3f) -> vec4f {
  let offset = ray - moon;
  let distance = length(offset);
  if (distance > radius + pixel * 2.0) { return vec4f(0.0); }
  let pole = local_from_equatorial(vec3f(0.0, -0.3978, 0.9175), sidereal, latitude);
  let north = normalize(pole - moon * dot(pole, moon));
  let west = cross(north, moon);
  let uv = vec2f(dot(offset, west), dot(offset, north)) / radius;
  let r2 = dot(uv, uv);
  let coverage = 1.0 - smoothstep(radius - pixel * 0.5, radius + pixel * 0.5, distance);
  let facing = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  // The lunar surface point, in sky space and in selenographic space.
  let normal = normalize(west * uv.x + north * uv.y - moon * facing);
  let selenographic = normalize(vec3f(uv.x, uv.y, facing));
  let albedo = moon_albedo(selenographic);
  // Relief near the terminator: crater rims catch light, floors fall dark.
  let bump = (moon_noise(selenographic * 55.0) - 0.5) * 0.35 + (moon_noise(selenographic * 130.0) - 0.5) * 0.2;
  let incidence = dot(normal, sun) + bump * 0.18;
  let mu0 = max(incidence, 0.0);
  let lit = 2.0 * mu0 / (mu0 + facing + 1e-4);
  // Earthshine: the dark side lit by a nearly full Earth when the Moon is a crescent.
  let earth_phase = 0.5 + 0.5 * dot(sun, moon);
  let earthshine = 0.012 * earth_phase * earth_phase;
  let radiance = sunlight_at_moon * albedo * (lit + earthshine) / 3.141593;
  return vec4f(radiance * vec3f(1.0, 0.985, 0.96), coverage);
}
