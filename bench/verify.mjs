#!/usr/bin/env node
import {
  corpus, evaluate, analyticDistance, makeMesh, buildGraph, dijkstra,
  vertexDistances, fingerprint, scaleMesh, label, pointAt,
} from '../src/core.mjs';
import { naiveDistances } from '../baseline/naive.mjs';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
};

const meshes = corpus();
const V = meshes.reduce((s, m) => s + m.positions.length / 3, 0);
const T = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
check('corpus', meshes.length === 9 && V > 8000 && T > 13000,
  `${meshes.length} meshes, ${V} vertices, ${T} triangles`);

// --- analytic oracle sanity (closed form, independent of the graph code) ---
const sphere = makeMesh('sphere', { subdiv: 2, radius: 2 });
const dSphere = analyticDistance(sphere, 0, 0);
check('analytic-sphere-zero', dSphere === 0, `d(p,p)=${dSphere}`);
const custom = { kind: 'sphere', params: { radius: 3 }, positions: [3, 0, 0, -3, 0, 0], indices: [] };
const anti = analyticDistance(custom, 0, 1);
check('analytic-sphere-antipodal', Math.abs(anti - 3 * Math.PI) < 1e-12,
  `d=${anti.toFixed(15)} vs 3*pi`);

const cyl = makeMesh('cylinder', { segments: 48, radius: 1, height: 2 });
const half = analyticDistance(cyl, 0, 24);
check('analytic-cylinder-half-wrap', Math.abs(half - Math.PI) < 1e-12, `d=${half.toFixed(15)} vs pi`);

const pl = makeMesh('plane', { n: 8, size: 1.5 });
const p0 = pointAt(pl.positions, 0), p1 = pointAt(pl.positions, 1), p2 = pointAt(pl.positions, 9);
const tri = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
check('analytic-plane-grid', Math.abs(tri - 0.375) < 1e-15, `grid step=${tri.toFixed(15)}`);

// --- independent baseline: Bellman-Ford on the plain edge graph ---
let oracleMismatch = 0, oraclePairs = 0, oracleMax = 0;
for (const [idx, src] of [[0, 0], [3, 17], [6, 5]]) {
  const m = meshes[idx];
  const g1 = buildGraph(m, 1);
  const dCore = vertexDistances(g1, src);
  const dNaive = naiveDistances(m, src);
  for (let j = 0; j < dCore.length; j++) {
    const diff = Math.abs(dCore[j] - dNaive[j]);
    oracleMax = Math.max(oracleMax, diff);
    if (diff > 1e-12) oracleMismatch++;
    oraclePairs++;
  }
}
check('baseline-oracle', oracleMismatch === 0,
  `${oraclePairs} pair distances, ${oracleMismatch} mismatches, max|diff|=${oracleMax.toExponential(3)}`);

// --- accuracy sweep ---
const KS = [1, 2, 4, 6];
const table = [];
for (const k of KS) {
  let sum = 0, worst = 0, pairs = 0, under = 0;
  const per = [];
  for (const m of meshes) {
    const r = evaluate(m, { k });
    per.push({ label: label(m), meanAbsRelPct: r.meanAbsRelPct, maxAbsRelPct: r.maxAbsRelPct });
    sum += r.meanAbsRelPct;
    worst = Math.max(worst, r.maxAbsRelPct);
    pairs += r.pairs;
    under += r.undershootPairs;
  }
  table.push({ k, aggregateMeanAbsRelPct: sum / meshes.length, worstMeshMaxAbsRelPct: worst, pairs, undershootPairs: under, per });
  console.log(`  k=${k}: aggregate mean |err| = ${(sum / meshes.length).toFixed(4)}%, worst pair = ${worst.toFixed(3)}%, pairs=${pairs}, undershoot=${under}`);
}
const k1 = table[0], k4 = table[2], k6 = table[3];
check('accuracy-k1-baseline', k1.aggregateMeanAbsRelPct > 10,
  `k=1 mean |err| = ${k1.aggregateMeanAbsRelPct.toFixed(4)}%`);
check('accuracy-k4', k4.aggregateMeanAbsRelPct < 1.0,
  `k=4 mean |err| = ${k4.aggregateMeanAbsRelPct.toFixed(4)}% (threshold 1.0%)`);
check('accuracy-k6', k6.aggregateMeanAbsRelPct < 0.5,
  `k=6 mean |err| = ${k6.aggregateMeanAbsRelPct.toFixed(4)}% (threshold 0.5%)`);
const factor = k1.aggregateMeanAbsRelPct / k6.aggregateMeanAbsRelPct;
check('improvement-factor', factor > 30, `${factor.toFixed(2)}x vs plain edge graph`);

let perMeshOk = true;
for (let i = 0; i < meshes.length; i++) {
  const f = k1.per[i].meanAbsRelPct / k6.per[i].meanAbsRelPct;
  if (!(f > 5)) { perMeshOk = false; console.log(`  low improvement on ${label(meshes[i])}: ${f.toFixed(2)}x`); }
}
check('every-mesh-improves', perMeshOk, 'all 9 meshes improve >5x from k=1 to k=6');

// --- scale invariance: same geometry at 1e-6 .. 1e6 ---
const base = makeMesh('sphere', { subdiv: 2, radius: 1 });
const baseErr = evaluate(base, { k: 4 }).meanAbsRelPct;
const scaleErrs = [];
for (const s of [1e-6, 1e-3, 1, 1e3, 1e6]) {
  const err = evaluate(scaleMesh(base, s), { k: 4 }).meanAbsRelPct;
  scaleErrs.push({ scale: s, meanAbsRelPct: err });
}
const maxDev = Math.max(...scaleErrs.map((e) => Math.abs(e.meanAbsRelPct - baseErr)));
check('scale-invariance', maxDev < 1e-6,
  `5 scales 1e-6..1e6, max deviation ${maxDev.toExponential(2)} percentage points (base ${baseErr.toFixed(6)}%)`);

// --- determinism ---
const g = buildGraph(meshes[1], 4);
const fp1 = fingerprint(meshes[1], vertexDistances(g, 7));
const fp2 = fingerprint(meshes[1], vertexDistances(buildGraph(meshes[1], 4), 7));
check('determinism', fp1 === fp2, `fingerprint ${fp1} reproduced`);
check('finite', scaleErrs.every((e) => Number.isFinite(e.meanAbsRelPct)), 'no NaN/Infinity in scale sweep');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
