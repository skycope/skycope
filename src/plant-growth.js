// Support is terminal foliage demand, never graph node count. Inserting a
// zero-demand segmentation node cannot alter a branch's pipe-model radius.
export function foliageDemand(parent, terminalDemand) {
  if (parent.length !== terminalDemand.length || terminalDemand.some(value => !Number.isFinite(value) || value < 0))
    throw new RangeError('Foliage demand must be finite, nonnegative and match the growth graph');
  const demand = Float64Array.from(terminalDemand);
  for (let n = parent.length - 1; n >= 0; n--) {
    if (parent[n] >= n || parent[n] < -1) throw new RangeError('Growth parents must precede their children');
    if (parent[n] >= 0) demand[parent[n]] += demand[n];
  }
  return demand;
}

export function demandRadius(demand, baseRadius, referenceDemand = 25) {
  return Math.max(baseRadius * .035, baseRadius * Math.sqrt(Math.max(0, demand) / Math.max(1, referenceDemand)));
}
