/**
 * Naive baseline: shortest paths on the *original* mesh edges with Bellman-Ford
 * (no portal chords, no sampling). Independent implementation from core's
 * Dijkstra, used both as the k=1 baseline and as a distance oracle.
 */
export function naiveDistances(mesh, source) {
  const V = mesh.positions.length / 3;
  const pos = mesh.positions;
  const edges = [];
  const seen = new Set();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const w = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1],
                           pos[3 * a + 2] - pos[3 * b + 2]);
      edges.push([a, b, w]);
    }
  }
  const d = new Float64Array(V).fill(Infinity);
  d[source] = 0;
  for (let iter = 0; iter < V; iter++) {
    let changed = false;
    for (const [a, b, w] of edges) {
      if (d[a] + w < d[b]) { d[b] = d[a] + w; changed = true; }
      if (d[b] + w < d[a]) { d[a] = d[b] + w; changed = true; }
    }
    if (!changed) break;
  }
  return d;
}
