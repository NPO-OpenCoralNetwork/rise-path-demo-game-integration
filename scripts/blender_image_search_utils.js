import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_INDEX_PATH = path.join(
  process.cwd(),
  'data/curricula/blender/image_index.jsonl'
);

const JP_EN_MAP = {
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

export const tokenize = (text) =>
  text
    .toLowerCase()
    .split(/[\s、。,.!?:"'()\\/\[\]-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

export const expandQuery = (query) => {
  const extras = [];
  for (const [jp, en] of Object.entries(JP_EN_MAP)) {
    if (query.includes(jp)) extras.push(en);
    if (query.toLowerCase().includes(en)) extras.push(jp);
  }
  return [query, ...extras].join(' ');
};

export const buildWeightedText = (record) => {
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

export const loadImageIndex = async (indexPath = DEFAULT_INDEX_PATH) => {
  const raw = await fs.readFile(indexPath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

export const bm25Search = (records, query, limit = 5) => {
  const queryTokens = tokenize(expandQuery(query));
  if (!queryTokens.length) return [];

  const docFreq = new Map();
  let totalLen = 0;
  const indexed = records.map((record) => {
    const text = buildWeightedText(record);
    const tokens = tokenize(text);
    totalLen += tokens.length;
    const uniq = new Set(tokens);
    uniq.forEach((token) => docFreq.set(token, (docFreq.get(token) || 0) + 1));
    return { record, tokens, length: tokens.length };
  });

  const avgLen = indexed.length ? totalLen / indexed.length : 0;
  const uniqQuery = Array.from(new Set(queryTokens));
  const k1 = 1.5;
  const b = 0.75;

  return indexed
    .map((doc) => {
      let score = 0;
      uniqQuery.forEach((qt) => {
        const df = docFreq.get(qt) || 0;
        if (df === 0) return;
        const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5));
        const tf = doc.tokens.filter((t) => t === qt).length;
        if (tf === 0) return;
        const denom = tf + k1 * (1 - b + b * (doc.length / avgLen));
        score += idf * ((tf * (k1 + 1)) / denom);
      });
      return { record: doc.record, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
