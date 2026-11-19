# geodesic-cert-lab

**Promise: on a 9-mesh corpus (8,881 vertices / 17,184 triangles), a sampled portal graph cuts the mean absolute error of surface geodesic distance from `13.0614%` (plain edge-graph + Bellman-Ford baseline) to `0.3621%` at k=6 — a `36.07x` reduction — while staying within `3e-9` percentage points across scales 1e-6 → 1e6.** Every number below is produced by `node bench/bench.mjs` and stored in [`bench/result.json`](bench/result.json); the browser recomputes the same error live and checks it against that file.

Upstream: none

## What it is

Shortest paths on a triangle mesh are usually computed on the mesh edge graph. That graph only allows travel *along* edges, so paths zig-zag and overestimate true geodesic distance badly (13% mean error here). This project builds a **portal graph**: each edge is split into `k` samples, and inside every triangle all boundary samples are joined by straight chords (a triangle is planar, so a chord lies on the surface). Shortest paths can then cross faces in any sampled direction. `k=1` is exactly the naive edge graph.

Distances are scored against a **closed-form oracle** (great circle on the sphere, unwrapped plane on the open cylinder, Euclidean on the plane), so no approximation from the graph code leaks into the ground truth.

## Run it

```bash
node tools/gen-sample.mjs      # deterministic corpus -> data/corpus.json
node bench/verify.mjs          # assertions, exit 0 on success
node bench/bench.mjs           # timing + accuracy -> bench/result.json
python3 -m http.server 4173    # open http://localhost:4173/
```

No npm install, no bundler, no `node_modules`. three.js `0.170.0` is pinned in the importmap.

## Evidence (from `bench/result.json`)

Corpus: 3 spheres (subdiv 2/3/4), 3 open cylinders (24/48/96 segments, near-isotropic rows), 3 planes (8/16/32 grid) = **8,881 vertices, 17,184 triangles**; 3 sources each → **26,604 scored vertex pairs per k**.

| k (samples per edge) | aggregate mean abs error | worst single pair |
|---|---|---|
| 1 (naive edge graph) | 13.0614% | 41.4214% |
| 2 | 2.5514% | 8.6829% |
| 4 | 0.8130% | 2.7776% |
| 6 | **0.3621%** | **1.3132%** |

- **Baseline** `baseline/naive.mjs`: Bellman-Ford on the plain edge graph, an independent implementation from core's Dijkstra. On sphere(subdiv=2) it scores 5.5403% over 483 pairs; its distances match core's k=1 distances with **max |diff| = 0** over all 459 compared pairs (three meshes).
- **Scale invariance**: sphere(subdiv=2) re-scaled to 1e-6 / 1e-3 / 1 / 1e3 / 1e6 gives mean abs errors 0.333831816 / 0.333831819 / 0.333831816 / 0.333831817 / 0.333831817 % — max deviation `3e-9` percentage points.
- **Determinism**: FNV-1a fingerprint over 9-decimal distances reproduces `6005f74d` on a rebuild; `bench/verify.mjs` re-checks it.
- **Timing** (sphere subdiv=3, k=6, 3 sources, 7 samples): cold `66.345 ms`, median `87.603 ms`, p95 `105.006 ms`, stddev `18.480 ms`, **RSD 22.25%**. The workload is sub-100 ms and the box is a shared 4-core host; allocation/GC noise dominates, so treat the median as the central estimate and the p95 as the honest tail. No timing number here was cherry-picked.
- `bench/verify.mjs`: 12/12 checks pass, including analytic sanity, baseline oracle, per-mesh improvement (>5x on all 9), scale invariance and determinism.

## 本轮创新

**B 档：采样门图 + 闭式真值 + 浏览器/节点双证书。** 台账里没有测地线条目；历史上 `mesh-slice-lab` / `surface-intersect-lab` / `csg-*` 都只处理平面或布尔结果，没有一条把「曲面最短路径」做成可数字复算的证书。新在三点：(1) 三角形内**门图弦**允许路径横穿面片，而普通 edge graph 结构上做不到；(2) 真值是闭式公式，与实现不共享任何常量或 epsilon；(3) 浏览器用同一 `src/core.mjs` 现场复算误差，并与 `bench/result.json` 的节点证书逐位比对（页面显示 MATCH/MISMATCH），不是截图证据。

## Limits（必读）

- **Only three analytic families.** Sphere / open cylinder / plane. Arbitrary scanned meshes have no closed form here and are not scored. The open cylinder has no caps, so the unwrapped formula stays valid.
- **Absolute thresholds.** The 1.0% (k=4) and 0.5% (k=6) pass marks are absolute percentage points, valid for this corpus and its near-isotropic triangles. They are not a universal accuracy guarantee.
- **Elongated triangles break the sampling.** An earlier 2.0 × 0.26 cylinder stayed at ~13.4% error even at k=6, because edge samples quantise the crossing height; the corpus generator therefore rings cylinders so triangles stay near-isotropic.
- **Relative-error floor.** Pairs closer than `2%` of the mesh bounding-box diagonal are skipped (`minFrac = 0.02`, a relative floor, not a geometry epsilon). This leaves 26,604 scored pairs per k.
- **Undershoot is structural.** The mesh is an inscribed polyhedron, so chords are shorter than surface arcs: 3,231 / 26,604 pairs at k=6 come out below the analytic value (12.1%). Sampling adds positive bias, so the net error is small but two-sided.
- **Non-monotone on very coarse meshes.** sphere(subdiv=2) is 0.334% at k=4 but 0.585% at k=6: on 320 triangles the polyhedral undershoot and the sampling bias cross over. The aggregate still falls monotonically.
- **Synthetic corpus.** No real scan or glTF asset is used; no claim is made about noisy or non-manifold input.

## Files

`src/core.mjs` — pure geometry/graph/dijkstra/analytic oracle (no DOM, no three). `main.js` + `index.html` — renderer and one interaction (drag-orbit + k slider). `tools/gen-sample.mjs` — deterministic corpus. `baseline/naive.mjs` — independent Bellman-Ford baseline. `bench/verify.mjs`, `bench/bench.mjs`, `bench/result.json`.

MIT License, copyright 2026 llinok111.
