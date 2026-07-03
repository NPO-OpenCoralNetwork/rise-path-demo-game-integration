export interface BlenderSegment {
  id: string;
  source: string;
  version: string;
  language: string;
  file: string;
  section: string;
  headingPath?: string;
  headings: string[];
  text: string;
}

let indexPromise: Promise<BlenderSegment[]> | null = null;
let cachedSegments: (BlenderSegment & { tokens: string[]; length: number })[] | null = null;
let avgDocLength = 0;
let docFreq: Map<string, number> | null = null;

const tokenize = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[\s、。,.!?]+/)
    .map((t) => t.trim())
    .filter(Boolean);

const loadIndex = async (): Promise<BlenderSegment[]> => {
  if (indexPromise) return indexPromise;
  indexPromise = fetch('/data/curricula/blender/index.jsonl')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load blender index: ${res.status}`);
      return res.text();
    })
    .then((text) =>
      text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as BlenderSegment)
    )
    .catch((err) => {
      console.warn('Blender RAG index load failed', err);
      return [];
    });
  return indexPromise;
};

const ensureCache = async () => {
  if (cachedSegments) return cachedSegments;
  const index = await loadIndex();
  const dfMap = new Map<string, number>();
  let totalLen = 0;

  cachedSegments = index.map((seg) => {
    const tokens = tokenize(seg.text);
    totalLen += tokens.length;
    const tokenSet = new Set(tokens);
    tokenSet.forEach((t) => dfMap.set(t, (dfMap.get(t) || 0) + 1));
    return { ...seg, tokens, length: tokens.length };
  });

  avgDocLength = cachedSegments.length ? totalLen / cachedSegments.length : 0;
  docFreq = dfMap;
  return cachedSegments;
};

/**
 * Retrieve top segments by simple keyword overlap.
 * This is a lightweight fallback until embeddings are added.
 */
export const retrieveBlenderContext = async (query: string, limit: number = 2): Promise<BlenderSegment[]> => {
  // Only attempt when topic is related to Blender/3D to avoid fetching 7MB unnecessarily.
  if (!/blender|3d|geometry|render/i.test(query)) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const segments = await ensureCache();
  if (!segments.length || !docFreq || !avgDocLength) return [];

  const uniqQuery = Array.from(new Set(queryTokens));
  const docCount = segments.length;
  const k1 = 1.5;
  const b = 0.75;

  const scored = segments
    .map((seg) => {
      let score = 0;
      uniqQuery.forEach((qt) => {
        const df = docFreq!.get(qt) || 0;
        if (df === 0) return;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        const tf = seg.tokens.filter((t) => t === qt).length;
        if (tf === 0) return;
        const denom = tf + k1 * (1 - b + b * (seg.length / avgDocLength));
        score += idf * ((tf * (k1 + 1)) / denom);
      });
      return { seg, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.seg);

  return scored;
};
