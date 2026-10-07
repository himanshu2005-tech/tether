// TF-IDF + cosine similarity for comparing free text (bid proposals, invoice descriptions)

const STOP = new Set('a an the and or of to in for on with by at from is are be we our your you it this that as will can per'.split(' '));

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9₹. ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t));
}

function tfidfVectors(texts) {
  const docs = texts.map(tokenize);
  const df = new Map();
  docs.forEach(tokens => new Set(tokens).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
  const n = docs.length;
  return docs.map(tokens => {
    const tf = new Map();
    tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
    const vec = new Map();
    tf.forEach((count, t) => vec.set(t, (count / tokens.length) * (Math.log((1 + n) / (1 + df.get(t))) + 1)));
    return vec;
  });
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  a.forEach((v, k) => { na += v * v; if (b.has(k)) dot += v * b.get(k); });
  b.forEach(v => { nb += v * v; });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Pairwise similarity matrix; texts with fewer than minTokens tokens are skipped (score 0)
function pairwiseSimilarity(texts, minTokens = 5) {
  const vecs = tfidfVectors(texts);
  const lengths = texts.map(t => tokenize(t).length);
  const pairs = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (lengths[i] < minTokens || lengths[j] < minTokens) continue;
      pairs.push({ i, j, similarity: cosine(vecs[i], vecs[j]) });
    }
  }
  return pairs;
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export { tokenize, tfidfVectors, cosine, pairwiseSimilarity, normalize };
