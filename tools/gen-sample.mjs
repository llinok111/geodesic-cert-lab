#!/usr/bin/env node
// Deterministic corpus generator: writes data/corpus.json (no randomness).
import { mkdirSync, writeFileSync } from 'node:fs';
import { corpus, label } from '../src/core.mjs';

const meshes = corpus().map((m) => ({
  label: label(m),
  kind: m.kind,
  params: m.params,
  positions: Array.from(m.positions),
  indices: Array.from(m.indices),
}));
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const out = new URL('../data/corpus.json', import.meta.url);
writeFileSync(out, JSON.stringify({ version: 1, meshes }));
const bytes = Buffer.byteLength(JSON.stringify({ version: 1, meshes }));
console.log(`wrote ${meshes.length} meshes, ${bytes} bytes`);
for (const m of meshes) console.log(`  ${m.label}: ${m.positions.length / 3} vertices, ${m.indices.length / 3} triangles`);
