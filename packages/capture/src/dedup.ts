export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Greedily keep items, dropping any that are too similar to one already kept.
// Guards against the model emitting two near-identical learnings in one run.
export function dedupeWithinBatch<T extends { embedding: number[] }>(
  items: T[],
  threshold: number,
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const isDup = kept.some((k) => cosineSimilarity(k.embedding, item.embedding) >= threshold);
    if (!isDup) kept.push(item);
  }
  return kept;
}
