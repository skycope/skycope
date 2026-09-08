// A reload gets a fresh world. A URL seed makes visual bugs reproducible.
export function sceneSeed(search) {
  const value = new URLSearchParams(search).get("seed");
  const parsed = Number(value);
  if (/^\d+$/.test(value ?? "") && parsed > 0 && parsed <= 0xffffffff) {
    return parsed;
  }
  return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
}

export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
