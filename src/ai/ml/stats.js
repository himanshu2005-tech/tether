function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Robust z-score using median absolute deviation, so a single outlier can't hide itself
function robustZ(value, sample) {
  if (sample.length < 3) return 0;
  const med = median(sample);
  const mad = median(sample.map(v => Math.abs(v - med)));
  if (mad === 0) {
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    const sd = Math.sqrt(sample.reduce((a, b) => a + (b - mean) ** 2, 0) / sample.length);
    return sd === 0 ? (value === med ? 0 : Math.sign(value - med) * 10) : (value - mean) / sd;
  }
  return (0.6745 * (value - med)) / mad;
}

function coefficientOfVariation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return sd / mean;
}

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export { median, robustZ, coefficientOfVariation, clamp };
