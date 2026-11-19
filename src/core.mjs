/**
 * geodesic-cert-lab core — pure ES module, no three.js, no DOM, no I/O.
 *
 * Surface geodesic distances are approximated by shortest paths on a graph
 * whose edges are the mesh edges refined with `segments - 1` Steiner points.
 * Accuracy is scored against closed-form geodesics on sphere / cylinder / plane.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

/* ------------------------------- mesh builders ------------------------------ */

function icosahedron() {
  const t = PHI;
  const positions = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const indices = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  return { positions, indices };
}

/** Geodesic sphere with 20 * 4^subdiv triangles and radius `radius`. */
export function icosphere(subdiv = 3, radius = 1) {
  const base = icosahedron();
  let verts = base.positions.map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l * radius, p[1] / l * radius, p[2] / l * radius];
  });
  let faces = base.indices.slice();

  for (let level = 0; level < subdiv; level++) {
    const cache = new Map();
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (cache.has(key)) return cache.get(key);
      const pa = verts[a], pb = verts[b];
      const m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      const l = Math.hypot(m[0], m[1], m[2]) || 1;
      const idx = verts.length;
      verts.push([m[0] / l * radius, m[1] / l * radius, m[2] / l * radius]);
      cache.set(key, idx);
      return idx;
    };
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f], b = faces[f + 1], c = faces[f + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    faces = next;
  }
  return { positions: verts.flat(), indices: faces };
}

/** Open lateral cylinder (no caps), ringed so triangles stay near-isotropic. */
export function cylinder(segments = 48, radius = 1, height = 2, rows = null) {
  const edge = (2 * Math.PI * radius) / segments;
  const R = rows ?? Math.max(1, Math.round(height / edge));
  const positions = [];
  for (let r = 0; r <= R; r++) {
    const z = -height / 2 + (height * r) / R;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push([Math.cos(a) * radius, Math.sin(a) * radius, z]);
    }
  }
  const indices = [];
  const at = (r, i) => r * segments + (i % segments);
  for (let r = 0; r < R; r++) {
    for (let i = 0; i < segments; i++) {
      const a = at(r, i), b = at(r, i + 1), c = at(r + 1, i), d = at(r + 1, i + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions: positions.flat(), indices, rows: R };
}

/** Flat n x n grid in the z=0 plane spanning [-size, size]^2. */
export function plane(n = 24, size = 1.5) {
  const positions = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions.push([-size + (2 * size * i) / n, -size + (2 * size * j) / n, 0]);
    }
  }
  const indices = [];
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      indices.push(at(i, j), at(i + 1, j), at(i, j + 1));
      indices.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return { positions: positions.flat(), indices };
}

export function makeMesh(kind, opts = {}) {
  if (kind === 'sphere') {
    const m = icosphere(opts.subdiv ?? 3, opts.radius ?? 1);
    return { kind, params: { radius: opts.radius ?? 1 }, ...m };
  }
  if (kind === 'cylinder') {
    const radius = opts.radius ?? 1, height = opts.height ?? 2;
    const m = cylinder(opts.segments ?? 48, radius, height, opts.rows ?? null);
    return { kind, params: { radius, height, rows: m.rows }, ...m };
  }
  if (kind === 'plane') {
    const size = opts.size ?? 1.5;
    const m = plane(opts.n ?? 24, size);
    return { kind, params: { size }, ...m };
  }
  throw new Error('unknown mesh kind: ' + kind);
}

/* --------------------------------- geometry -------------------------------- */

export function pointAt(positions, i) {
  return [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
}

export function scaleMesh(mesh, k) {
  const p = new Float64Array(mesh.positions.length);
  for (let i = 0; i < p.length; i++) p[i] = mesh.positions[i] * k;
  return {
    ...mesh,
    params: { ...mesh.params, radius: mesh.params.radius ? mesh.params.radius * k : undefined,
              height: mesh.params.height ? mesh.params.height * k : undefined,
              size: mesh.params.size ? mesh.params.size * k : undefined },
    positions: p,
  };
}

/* ------------------------------- portal graph ------------------------------ */

/**
 * Build the sampled portal graph. Every mesh edge is split into `k` equal
 * pieces; inside each triangle every pair of boundary samples is connected by
 * a straight chord (the triangle is planar, so the chord lies on the surface).
 * A shortest path may therefore cross a face in any sampled direction, which
 * a plain edge graph cannot do. k=1 is exactly the plain edge graph.
 */
export function buildGraph(mesh, k = 4) {
  if (!Number.isInteger(k) || k < 1) throw new Error('k must be an integer >= 1');
  const pos = mesh.positions;
  const idx = mesh.indices;
  const V = pos.length / 3;

  const edgeMap = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (!edgeMap.has(key)) edgeMap.set(key, [Math.min(a, b), Math.max(a, b)]);
    }
  }
  const edges = [...edgeMap.values()];
  const E = edges.length;
  const N = V + E * (k - 1);
  const xyz = new Float64Array(N * 3);
  for (let i = 0; i < V * 3; i++) xyz[i] = pos[i];

  const edgeIndex = new Map();
  for (let e = 0; e < E; e++) {
    const [a, b] = edges[e];
    edgeIndex.set(a + ':' + b, e);
    for (let m = 1; m < k; m++) {
      const t = m / k;
      const node = V + e * (k - 1) + (m - 1);
      xyz[3 * node] = pos[3 * a] + (pos[3 * b] - pos[3 * a]) * t;
      xyz[3 * node + 1] = pos[3 * a + 1] + (pos[3 * b + 1] - pos[3 * a + 1]) * t;
      xyz[3 * node + 2] = pos[3 * a + 2] + (pos[3 * b + 2] - pos[3 * a + 2]) * t;
    }
  }

  const adj = new Array(N);
  for (let i = 0; i < N; i++) adj[i] = [];
  const link = (u, v) => {
    const w = Math.hypot(xyz[3 * u] - xyz[3 * v], xyz[3 * u + 1] - xyz[3 * v + 1],
                         xyz[3 * u + 2] - xyz[3 * v + 2]);
    adj[u].push([v, w]);
    adj[v].push([u, w]);
  };

  // Edge samples belong to both adjacent faces; connect along the edge once.
  for (let e = 0; e < E; e++) {
    const [a, b] = edges[e];
    let prev = a;
    for (let m = 1; m < k; m++) {
      const node = V + e * (k - 1) + (m - 1);
      link(prev, node);
      prev = node;
    }
    link(prev, b);
  }

  // Ring of boundary samples around each triangle, then the intra-face clique.
  const ring = [];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    ring.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const edge = edgeIndex.get(lo + ':' + hi);
      ring.push(a);
      for (let m = 1; m < k; m++) {
        // sample m/k measured from `lo`; flip when the ring runs hi -> lo
        const fromLo = a === lo ? m : k - m;
        if (fromLo > 0 && fromLo < k) ring.push(V + edge * (k - 1) + (fromLo - 1));
      }
    }
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 1; j < ring.length; j++) link(ring[i], ring[j]);
    }
  }
  return { N, V, E, k, positions: xyz, edges, adj, baseV: V };
}

/* --------------------------------- dijkstra -------------------------------- */

class MinHeap {
  constructor(cap) {
    this.dist = new Float64Array(cap);
    this.node = new Int32Array(cap);
    this.size = 0;
  }
  push(d, n) {
    if (this.size === this.dist.length) throw new Error('heap overflow');
    let i = this.size++;
    this.dist[i] = d; this.node[i] = n;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.dist[p] <= this.dist[i]) break;
      this.swap(p, i); i = p;
    }
  }
  pop() {
    const topD = this.dist[0], topN = this.node[0];
    const last = --this.size;
    if (last > 0) {
      this.dist[0] = this.dist[last]; this.node[0] = this.node[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.dist[l] < this.dist[m]) m = l;
        if (r < this.size && this.dist[r] < this.dist[m]) m = r;
        if (m === i) break;
        this.swap(m, i); i = m;
      }
    }
    return [topD, topN];
  }
  swap(a, b) {
    const d = this.dist[a]; this.dist[a] = this.dist[b]; this.dist[b] = d;
    const n = this.node[a]; this.node[a] = this.node[b]; this.node[b] = n;
  }
}

/** Single-source shortest paths on a weighted undirected graph. */
export function dijkstra(graph, source) {
  const { N, adj } = graph;
  const dist = new Float64Array(N).fill(Infinity);
  const done = new Uint8Array(N);
  const heap = new MinHeap(N * 4 + 16);
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    const nbrs = adj[u];
    for (let i = 0; i < nbrs.length; i++) {
      const v = nbrs[i][0], w = nbrs[i][1];
      if (d + w < dist[v]) {
        dist[v] = d + w;
        heap.push(dist[v], v);
      }
    }
  }
  return dist;
}

/** Distances restricted to the original mesh vertices. */
export function vertexDistances(graph, source) {
  const all = dijkstra(graph, source);
  return all.subarray(0, graph.V);
}

/* ----------------------------- analytic oracle ----------------------------- */

export function wrapAngle(a) {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * Closed-form geodesic distance. This is the independent oracle: sphere uses
 * the great-circle formula, the open cylinder unwraps to a plane, and the
 * plane is Euclidean. No epsilon is shared with the graph implementation.
 */
export function analyticDistance(mesh, i, j) {
  const p = pointAt(mesh.positions, i);
  const q = pointAt(mesh.positions, j);
  if (p[0] === q[0] && p[1] === q[1] && p[2] === q[2]) return 0;
  if (mesh.kind === 'sphere') {
    const R = mesh.params.radius;
    const c = (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (R * R);
    return R * Math.acos(Math.max(-1, Math.min(1, c)));
  }
  if (mesh.kind === 'cylinder') {
    const R = mesh.params.radius;
    const dth = wrapAngle(Math.atan2(q[1], q[0]) - Math.atan2(p[1], p[0]));
    return Math.hypot(q[2] - p[2], R * dth);
  }
  if (mesh.kind === 'plane') {
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  }
  throw new Error('no analytic oracle for ' + mesh.kind);
}

/* -------------------------------- evaluation ------------------------------- */

export function pickSources(mesh, count = 3) {
  const V = mesh.positions.length / 3;
  const out = [];
  for (let k = 0; k < count; k++) out.push(Math.floor((V * (k + 1)) / (count + 1)) % V);
  return [...new Set(out)];
}

/**
 * Score graph distances against the analytic oracle. Pairs closer than
 * `minFrac * meshDiagonal` are skipped because relative error is meaningless
 * at zero distance (this is a relative-error floor, not a geometry epsilon).
 */
export function evaluate(mesh, opts = {}) {
  const k = opts.k ?? 4;
  const sources = opts.sources ?? pickSources(mesh);
  const minFrac = opts.minFrac ?? 0.02;
  const graph = buildGraph(mesh, k);

  const V = graph.baseV;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < V; i++) {
    const x = mesh.positions[3 * i], y = mesh.positions[3 * i + 1], z = mesh.positions[3 * i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const minDist = diag * minFrac;

  const errors = [];
  let pairs = 0;
  let over = 0;
  for (const s of sources) {
    const d = vertexDistances(graph, s);
    for (let j = 0; j < V; j++) {
      if (j === s) continue;
      const exact = analyticDistance(mesh, s, j);
      if (exact < minDist) continue;
      const rel = (d[j] - exact) / exact;
      errors.push(rel);
      pairs++;
      if (rel < -1e-12) over++; // graph distance must not undershoot the true geodesic
    }
  }
  errors.sort((a, b) => a - b);
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const absMean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const p95 = abs[Math.min(abs.length - 1, Math.floor(0.95 * abs.length))];
  return {
    k, sources, pairs, nodes: graph.N, graphEdges: graph.adj.reduce((a, l) => a + l.length, 0) / 2,
    meanRelPct: mean * 100, meanAbsRelPct: absMean * 100,
    maxAbsRelPct: abs[abs.length - 1] * 100, p95AbsRelPct: p95 * 100,
    undershootPairs: over, diag,
  };
}

/* --------------------------------- fingerprint ----------------------------- */

export function fnv1a(strings) {
  let h = 0x811c9dc5;
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

/** Deterministic content hash of a mesh + a distance field. */
export function fingerprint(mesh, distances) {
  const parts = [mesh.kind, String(mesh.positions.length), String(mesh.indices.length)];
  for (let i = 0; i < distances.length; i++) parts.push(distances[i].toFixed(9));
  return fnv1a(parts);
}

/* ------------------------------ corpus helpers ----------------------------- */

export function corpus() {
  const out = [];
  for (const subdiv of [2, 3, 4]) out.push(makeMesh('sphere', { subdiv, radius: 1 }));
  for (const segments of [24, 48, 96]) out.push(makeMesh('cylinder', { segments, radius: 1, height: 2 }));
  for (const n of [8, 16, 32]) out.push(makeMesh('plane', { n, size: 1.5 }));
  return out;
}

export function label(mesh) {
  if (mesh.kind === 'sphere') {
    const tris = mesh.indices.length / 3;
    return `sphere(subdiv=${Math.round(Math.log(tris / 20) / Math.log(4))},R=${mesh.params.radius})`;
  }
  if (mesh.kind === 'cylinder') return `cylinder(seg=${mesh.positions.length / 3 / (mesh.params.rows + 1)},rows=${mesh.params.rows},R=${mesh.params.radius})`;
  return `plane(n=${Math.round(Math.sqrt(mesh.positions.length / 3)) - 1})`;
}
