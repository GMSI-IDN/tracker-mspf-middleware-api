const fs = require('fs');

const path = require('path');
const defaultPath = path.resolve(__dirname, '../results/loadtest-cpu.cpuprofile');
const profilePath = process.argv[2] || defaultPath;
if (!fs.existsSync(profilePath)) {
  console.error(`File not found: ${profilePath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const samples = data.samples || [];
const timeDeltas = data.timeDeltas || [];
const nodes = data.nodes || [];

const nodeMap = new Map();
for (const n of nodes) {
  nodeMap.set(n.id, n);
}

// Calculate self time per node
const selfTimes = new Map();
for (let i = 0; i < samples.length; i++) {
  const nodeId = samples[i];
  const delta = timeDeltas[i] || 0;
  selfTimes.set(nodeId, (selfTimes.get(nodeId) || 0) + delta);
}

// Aggregate by function name + url
const funcMap = new Map();
for (const [nodeId, selfTime] of selfTimes.entries()) {
  const node = nodeMap.get(nodeId);
  if (!node) continue;
  const cf = node.callFrame || {};
  const fnName = cf.functionName || '(anonymous)';
  const url = cf.url ? cf.url.replace(/^.*\/node_modules\//, 'node_modules/').replace(/^.*\/src\//, 'src/') : '(native)';
  const key = `${fnName} (${url}:${cf.lineNumber || 0})`;

  funcMap.set(key, (funcMap.get(key) || 0) + selfTime);
}

const sorted = Array.from(funcMap.entries())
  .filter(([_, time]) => time > 0)
  .sort((a, b) => b[1] - a[1]);

const totalTime = sorted.reduce((sum, [_, t]) => sum + t, 0);

console.log('='.repeat(80));
console.log(`V8 CPU PROFILE TOP FUNCTIONS (Self Time) — Total sampled: ${(totalTime / 1000).toFixed(2)} ms`);
console.log('='.repeat(80));

for (let i = 0; i < Math.min(20, sorted.length); i++) {
  const [fn, time] = sorted[i];
  const pct = ((time / totalTime) * 100).toFixed(2);
  const ms = (time / 1000).toFixed(2);
  console.log(`${(i + 1).toString().padStart(2, ' ')}. ${pct.padStart(6, ' ')}% (${ms.padStart(8, ' ')} ms) | ${fn}`);
}
console.log('='.repeat(80));
