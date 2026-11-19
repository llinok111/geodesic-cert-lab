#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import {
  corpus, evaluate, makeMesh, label, buildGraph, vertexDistances,
  analyticDistance, scaleMesh, pickSources,
} from '../src/core.mjs';
import { naiveDistances } from '../baseline/naive.mjs';

const meshes = corpus();
const KS = [1, 2, 4, 6];
const accuracy = [];
let pairs = 0;
for (const k of KS) {
  const per = [];
  let sum = 0, worst = 0, under = 0;
  for (const m of meshes) {
    const r = evaluate(m, { k });
    per.push({ label: label(m), meanAbsRelPct: +r.meanAbsRelPct.toFixed(6), maxAbsRelPct: +r.maxAbsRelPct.toFixed(6), pairs: r.pairs, undershootPairs: r.undershootPairs });
    sum += r.meanAbsRelPct; worst = Math.max(worst, r.maxAbsRelPct); under += r.undershootPairs;
    if (k === 1) pairs += r.pairs;
  }
  accuracy.push({ k, aggregateMeanAbsRelPct: +(sum / meshes.length).toFixed(6), worstPairAbsRelPct: +worst.toFixed(6), pairs: per.reduce((a, p) => a + p.pairs, 0), undershootPairs: under, perMesh: per });
}

// Independent naive baseline on the plain edge graph (Bellman-Ford).
const baseMesh = meshes[0];
const sources = pickSources(baseMesh);
let naiveErr = 0, naivePairs = 0, oracleMaxDiff = 0;
for (const s of sources) {
  const dn = naiveDistances(baseMesh, s);
  const dc = vertexDistances(buildGraph(baseMesh, 1), s);
  for (let j = 0; j < dn.length; j++) {
    if (j === s) continue;
    const exact = analyticDistance(baseMesh, s, j);
    if (exact < 1e-9) continue;
    naiveErr += Math.abs((dn[j] - exact) / exact) * 100;
    oracleMaxDiff = Math.max(oracleMaxDiff, Math.abs(dn[j] - dc[j]));
    naivePairs++;
  }
}

// Scale invariance at 5 orders of magnitude.
const base = makeMesh('sphere', { subdiv: 2, radius: 1 });
const scale = [1e-6, 1e-3, 1, 1e3, 1e6].map((s) => ({ scale: s, meanAbsRelPct: +evaluate(scaleMesh(base, s), { k: 4 }).meanAbsRelPct.toFixed(9) }));

// Timing: sphere subdiv=3, k=6, 3 sources.
const work = meshes[1];
const coldStart = performance.now();
evaluate(work, { k: 6 });
const coldMs = performance.now() - coldStart;
evaluate(work, { k: 6 }); // warmup
const samples = [];
for (let i = 0; i < 7; i++) {
  const t0 = performance.now();
  evaluate(work, { k: 6 });
  samples.push(performance.now() - t0);
}
const sorted = [...samples].sort((a, b) => a - b);
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const median = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
const rsdPct = (stddev / mean) * 100;

const result = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform },
  corpus: {
    meshes: meshes.length,
    vertices: meshes.reduce((s, m) => s + m.positions.length / 3, 0),
    triangles: meshes.reduce((s, m) => s + m.indices.length / 3, 0),
    families: ['sphere', 'cylinder', 'plane'],
    scalesTested: [1e-6, 1e-3, 1, 1e3, 1e6],
  },
  accuracy,
  baseline: {
    name: 'plain edge graph + Bellman-Ford (baseline/naive.mjs)',
    mesh: label(baseMesh),
    meanAbsRelPct: +(naiveErr / naivePairs).toFixed(6),
    pairCount: naivePairs,
    oracleVsCoreK1MaxAbsDiff: +oracleMaxDiff.toExponential(3),
  },
  improvement: {
    metric: 'aggregate mean absolute relative error, k=1 vs k=6',
    k1Pct: accuracy[0].aggregateMeanAbsRelPct,
    k6Pct: accuracy[3].aggregateMeanAbsRelPct,
    factor: +(accuracy[0].aggregateMeanAbsRelPct / accuracy[3].aggregateMeanAbsRelPct).toFixed(3),
  },
  scaleInvariance: { baseMeanAbsRelPct: scale.find((s) => s.scale === 1).meanAbsRelPct, runs: scale,
    maxDeviationPctPoints: +Math.max(...scale.map((s) => Math.abs(s.meanAbsRelPct - scale.find((x) => x.scale === 1).meanAbsRelPct))).toExponential(3) },
  timing: { workload: 'evaluate(sphere(subdiv=3), k=6, 3 sources)', coldMs: +coldMs.toFixed(3), samples: samples.map((s) => +s.toFixed(3)), sampleCount: samples.length, minMs: +sorted[0].toFixed(3), medianMs: +median.toFixed(3), p95Ms: +p95.toFixed(3), meanMs: +mean.toFixed(3), stddevMs: +stddev.toFixed(3), rsdPct: +rsdPct.toFixed(3) },
  determinism: { fingerprint: '6005f74d', note: 'FNV-1a over 9-decimal distances; reproduced in verify.mjs' },
};
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ accuracy: accuracy.map((a) => ({ k: a.k, agg: a.aggregateMeanAbsRelPct, worst: a.worstPairAbsRelPct })), baseline: result.baseline, improvement: result.improvement, timing: result.timing, scale: result.scaleInvariance }, null, 2));
