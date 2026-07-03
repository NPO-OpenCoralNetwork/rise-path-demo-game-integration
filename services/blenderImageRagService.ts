export interface BlenderImageRecord {
  id: string;
  source: string;
  version: string;
  language: string;
  file: string;
  pageTitle: string;
  section: string;
  headingPath?: string;
  headings?: string[];
  image: string;
  caption?: string | null;
  alt?: string | null;
  contextBefore?: string | null;
  contextAfter?: string | null;
  keywords?: string[];
}

let indexPromise: Promise<BlenderImageRecord[]> | null = null;
let cachedRecords: (BlenderImageRecord & { tokens: string[]; length: number })[] | null = null;
let avgDocLength = 0;
let docFreq: Map<string, number> | null = null;

const JP_EN_MAP: Record<string, string> = {
  '頂点': 'vertex',
  '辺': 'edge',
  '面': 'face',
  '法線': 'normal',
  'モデリング': 'modeling',
  'レンダー': 'render',
  'マテリアル': 'material',
  'テクスチャ': 'texture',
  'シェーダー': 'shader',
  'ノード': 'node',
  'ジオメトリ': 'geometry',
  'コレクション': 'collection',
  'アウトライナー': 'outliner',
  'カメラ': 'camera',
  'ライト': 'light',
  'アニメーション': 'animation',
  'リギング': 'rigging',
  'スカルプト': 'sculpt',
  'ベイク': 'bake',
  'コンポジット': 'compositing',
  'ビューポート': 'viewport'
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[\s、。,.!?:"'()\\/\[\]-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

const expandQuery = (query: string): string => {
  const extras: string[] = [];
  Object.entries(JP_EN_MAP).forEach(([jp, en]) => {
    if (query.includes(jp)) extras.push(en);
    if (query.toLowerCase().includes(en)) extras.push(jp);
  });
  return [query, ...extras].join(' ');
};

const buildWeightedText = (record: BlenderImageRecord): string => {
  const context = `${record.contextBefore || ''} ${record.contextAfter || ''}`.trim();
  const keywords = Array.isArray(record.keywords) ? record.keywords.join(' ') : '';
  return [
    record.caption,
    record.caption,
    record.caption,
    record.headingPath,
    record.headingPath,
    context,
    record.pageTitle,
    record.alt,
    keywords
  ]
    .filter(Boolean)
    .join(' ');
};

const loadIndex = async (): Promise<BlenderImageRecord[]> => {
  if (indexPromise) return indexPromise;
  indexPromise = fetch('/data/curricula/blender/image_index.jsonl')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load blender image index: ${res.status}`);
      return res.text();
    })
    .then((text) =>
      text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as BlenderImageRecord)
    )
    .catch((err) => {
      console.warn('Blender image index load failed', err);
      return [];
    });
  return indexPromise;
};

const ensureCache = async () => {
  if (cachedRecords) return cachedRecords;
  const index = await loadIndex();
  const dfMap = new Map<string, number>();
  let totalLen = 0;

  cachedRecords = index.map((record) => {
    const tokens = tokenize(buildWeightedText(record));
    totalLen += tokens.length;
    const tokenSet = new Set(tokens);
    tokenSet.forEach((t) => dfMap.set(t, (dfMap.get(t) || 0) + 1));
    return { ...record, tokens, length: tokens.length };
  });

  avgDocLength = cachedRecords.length ? totalLen / cachedRecords.length : 0;
  docFreq = dfMap;
  return cachedRecords;
};

export const retrieveBlenderImages = async (query: string, limit: number = 3): Promise<BlenderImageRecord[]> => {
  if (!/blender|3d|geometry|render|model|sculpt|uv|shader|material|node|viewport|scene|rig|animation|texture|light|camera|bake|composit|collection|outliner|ブレンダー|レンダー|モデリング|スカルプト|ジオメトリ|ノード|マテリアル|テクスチャ|シーン|リギング|アニメ|カメラ|ライト|アウトライナー|コレクション|ベイク/i.test(query)) {
    return [];
  }

  const expandedQuery = expandQuery(query);
  const queryTokens = tokenize(expandedQuery);
  if (queryTokens.length === 0) return [];

  const records = await ensureCache();
  if (!records.length || !docFreq || !avgDocLength) return [];

  const uniqQuery = Array.from(new Set(queryTokens));
  const docCount = records.length;
  const k1 = 1.5;
  const b = 0.75;

  return records
    .map((record) => {
      let score = 0;
      uniqQuery.forEach((qt) => {
        const df = docFreq!.get(qt) || 0;
        if (df === 0) return;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        const tf = record.tokens.filter((t) => t === qt).length;
        if (tf === 0) return;
        const denom = tf + k1 * (1 - b + b * (record.length / avgDocLength));
        score += idf * ((tf * (k1 + 1)) / denom);
      });
      return { record, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.record);
};
