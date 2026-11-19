import * as THREE from 'three';
import { buildGraph, vertexDistances, analyticDistance, label, pickSources } from './src/core.mjs';

const state = { meshes: [], mesh: null, k: 4, certified: null, group: null, geom: null, src: 0 };
const $ = (id) => document.getElementById(id);

function colorFor(t) {
  // blue -> cyan -> yellow -> red
  const r = Math.min(1, Math.max(0, 1.6 * t - 0.6));
  const g = Math.min(1, Math.max(0, 1.6 - Math.abs(2.4 * t - 1.2)));
  const b = Math.min(1, Math.max(0, 1.2 - 2.2 * t));
  return [r, g, b];
}

async function boot() {
  const data = await (await fetch('./data/corpus.json')).json();
  state.meshes = data.meshes;
  try { state.certified = await (await fetch('./bench/result.json')).json(); } catch { state.certified = null; }
  const sel = $('mesh');
  state.meshes.forEach((m, i) => { const o = document.createElement('option'); o.value = i; o.textContent = m.label; sel.appendChild(o); });
  sel.value = '1';
  $('mesh').onchange = () => select(+$('mesh').value);
  $('k').oninput = () => { state.k = +$('k').value; $('kval').textContent = state.k; render(); };
  select(1);
  requestAnimationFrame(animate);
}

function select(i) {
  state.mesh = state.meshes[i];
  state.src = pickSources(state.mesh)[0];
  buildScene();
  render();
}

function buildScene() {
  if (state.group) scene.remove(state.group);
  const m = state.mesh;
  state.geom = new THREE.BufferGeometry();
  state.geom.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  state.geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(m.positions.length), 3));
  state.geom.setIndex(m.indices);
  state.geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.05, flatShading: false });
  state.group = new THREE.Group();
  state.group.add(new THREE.Mesh(state.geom, mat));
  const srcPos = new THREE.Vector3(m.positions[3 * state.src], m.positions[3 * state.src + 1], m.positions[3 * state.src + 2]);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  dot.position.copy(srcPos);
  state.group.add(dot);
  scene.add(state.group);
  camera.position.set(2.4, 1.6, 2.4);
  camera.lookAt(0, 0, 0);
}

function render() {
  const m = state.mesh;
  const graph = buildGraph(m, state.k);
  const dist = vertexDistances(graph, state.src);
  const V = m.positions.length / 3;
  let max = 0;
  for (let i = 0; i < V; i++) max = Math.max(max, dist[i]);
  const col = state.geom.getAttribute('color');
  let sum = 0, worst = 0, n = 0;
  for (let i = 0; i < V; i++) {
    const t = max > 0 ? dist[i] / max : 0;
    const [r, g, b] = colorFor(t);
    col.setXYZ(i, r, g, b);
    if (i === state.src) continue;
    const exact = analyticDistance(m, state.src, i);
    if (exact < 1e-12) continue;
    const rel = Math.abs((dist[i] - exact) / exact) * 100;
    sum += rel; worst = Math.max(worst, rel); n++;
  }
  col.needsUpdate = true;
  $('title').textContent = m.label;
  $('live').textContent = `live mean |err| ${(sum / n).toFixed(4)}%  max ${worst.toFixed(4)}%  (${n} vertices, k=${state.k})`;
  const cert = state.certified?.accuracy?.find((a) => a.k === state.k)?.perMesh?.find((p) => p.label === m.label);
  if (cert) {
    const delta = Math.abs(cert.meanAbsRelPct - sum / n);
    $('cert').textContent = `certified ${cert.meanAbsRelPct.toFixed(4)}%  |  delta ${delta.toExponential(2)} pp  ${delta < 1e-6 ? 'MATCH' : 'MISMATCH'}`;
    $('cert').className = delta < 1e-6 ? 'ok' : 'bad';
  } else {
    $('cert').textContent = 'no certified entry for this mesh/k';
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); scene.add(key);

let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag || !state.group) return;
  state.group.rotation.y += (e.clientX - drag.x) * 0.01;
  state.group.rotation.x += (e.clientY - drag.y) * 0.01;
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener('wheel', (e) => {
  camera.position.multiplyScalar(e.deltaY > 0 ? 1.08 : 0.92);
  camera.lookAt(0, 0, 0);
}, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function animate() { renderer.render(scene, camera); requestAnimationFrame(animate); }
boot();
