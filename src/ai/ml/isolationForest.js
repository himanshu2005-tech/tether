// Minimal Isolation Forest (Liu, Ting & Zhou, 2008).
// Anomalies are isolated by fewer random splits, so a short average path length => high anomaly score.

function averagePathLength(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const harmonic = Math.log(n - 1) + 0.5772156649;
  return 2 * harmonic - (2 * (n - 1)) / n;
}

// Seeded PRNG so the same data always produces the same scores (explainable, reproducible)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTree(rows, depth, maxDepth, rand) {
  if (depth >= maxDepth || rows.length <= 1) return { size: rows.length };
  const dims = rows[0].length;
  // Pick a feature that actually varies in this node
  const candidates = [];
  for (let d = 0; d < dims; d++) {
    let min = Infinity, max = -Infinity;
    for (const r of rows) { if (r[d] < min) min = r[d]; if (r[d] > max) max = r[d]; }
    if (max > min) candidates.push({ d, min, max });
  }
  if (candidates.length === 0) return { size: rows.length };
  const { d, min, max } = candidates[Math.floor(rand() * candidates.length)];
  const split = min + rand() * (max - min);
  const left = [], right = [];
  for (const r of rows) (r[d] < split ? left : right).push(r);
  return {
    dim: d, split,
    left: buildTree(left, depth + 1, maxDepth, rand),
    right: buildTree(right, depth + 1, maxDepth, rand)
  };
}

function pathLength(point, node, depth) {
  if (node.size !== undefined) return depth + averagePathLength(node.size);
  return pathLength(point, point[node.dim] < node.split ? node.left : node.right, depth + 1);
}

class IsolationForest {
  constructor({ trees = 100, sampleSize = 64, seed = 42 } = {}) {
    this.treeCount = trees;
    this.sampleSize = sampleSize;
    this.seed = seed;
  }

  fit(rows) {
    const rand = mulberry32(this.seed);
    this.psi = Math.min(this.sampleSize, rows.length);
    const maxDepth = Math.ceil(Math.log2(Math.max(this.psi, 2)));
    this.trees = [];
    for (let t = 0; t < this.treeCount; t++) {
      const sample = [];
      for (let i = 0; i < this.psi; i++) sample.push(rows[Math.floor(rand() * rows.length)]);
      this.trees.push(buildTree(sample, 0, maxDepth, rand));
    }
    return this;
  }

  // Returns 0..1; values above ~0.6 are anomalous, around 0.5 or below are normal
  score(point) {
    const avg = this.trees.reduce((s, tree) => s + pathLength(point, tree, 0), 0) / this.trees.length;
    return Math.pow(2, -avg / averagePathLength(this.psi));
  }
}

export { IsolationForest };
