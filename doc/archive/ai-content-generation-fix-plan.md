# 修正計画: AI生成でDocChapter形式のリッチなコンテンツを生成

## 問題点

### 現状
現在の `geminiBackendService.js` は以下の問題があります：

1. **スキーマが簡素すぎる** (188-200行目)
   - `doc_blocks` は `{ type, content, items, language }` のみ
   - バイリンガル（LocalizedText）に対応していない
   - `callout`, `mermaid`, `image` などのリッチなタイプに対応していない

2. **プロンプトが不十分** (388-400行目)
   - 具体的なコンテンツ構造の指示がない
   - どのようなブロックタイプを使うべきか明示されていない
   - サンプル出力がない

### 目標のフォーマット（サンプル chapter1.ts より）
```typescript
{
  id: 'vibe-ch1',
  title: { en: 'Chapter 1 | Minimum Viable Knowledge', jp: '第1章｜人間が理解すべき最低ライン' },
  subtitle: { en: '...', jp: '...' },
  readingTime: { en: '15 min read', jp: '15分で読める' },
  sections: [
    {
      id: '1-1',
      title: { en: '1-1. Frontend / Backend / DB relationship', jp: '1-1. フロントエンド / バックエンド / DBの関係' },
      content: [
        { type: 'text', text: { en: '...', jp: '...' }, style: 'lead' },
        { type: 'mermaid', chart: 'graph LR...', caption: { en: '...', jp: '...' } },
        { type: 'callout', variant: 'tip', title: { en: '...', jp: '...' }, text: { en: '...', jp: '...' } },
        { type: 'list', items: [{ en: '...', jp: '...' }, ...] },
        { type: 'code', language: 'json', filename: '...', code: '...' }
      ]
    },
    // 複数のセクション...
  ]
}
```

---

## 修正計画

### Phase 1: 新しいスキーマ定義

`geminiBackendService.js` に以下の新しいスキーマを追加：

```javascript
// LocalizedText schema
const localizedTextSchema = {
  type: Type.OBJECT,
  properties: {
    en: { type: Type.STRING },
    jp: { type: Type.STRING }
  },
  required: ["en", "jp"]
};

// DocBlock schema (リッチなブロックタイプ)
const docBlockSchema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, enum: ["text", "callout", "code", "list", "mermaid", "image"] },
    // text type
    text: localizedTextSchema,
    style: { type: Type.STRING, enum: ["normal", "lead", "quote"] },
    // callout type
    variant: { type: Type.STRING, enum: ["info", "warning", "tip", "success"] },
    title: localizedTextSchema,
    // code type  
    code: { type: Type.STRING },
    language: { type: Type.STRING },
    filename: { type: Type.STRING },
    // list type
    items: { type: Type.ARRAY, items: localizedTextSchema },
    // mermaid type
    chart: { type: Type.STRING },
    caption: localizedTextSchema,
    // image type
    src: { type: Type.STRING },
    alt: { type: Type.STRING }
  },
  required: ["type"]
};

// DocSection schema
const docSectionSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: localizedTextSchema,
    content: { type: Type.ARRAY, items: docBlockSchema }
  },
  required: ["id", "title", "content"]
};

// 新しいレッスン構造（DocChapter互換）
const lessonSchema = {
  type: Type.OBJECT,
  properties: {
    lesson_id: { type: Type.STRING },
    title: localizedTextSchema,
    subtitle: localizedTextSchema,
    reading_time: localizedTextSchema,
    sections: { type: Type.ARRAY, items: docSectionSchema },
    estimated_min: { type: Type.NUMBER },
    quiz: quizSchema  // 既存のクイズスキーマ
  },
  required: ["lesson_id", "title", "sections", "estimated_min"]
};
```

### Phase 2: プロンプトの改善

`generateCurriculum` 関数の `systemInstruction` を大幅に強化：

```javascript
systemInstruction: `
You are an expert educational content developer for 'Rise Path Learning Platform'.
Generate RICH, EDUCATIONAL content in DocChapter format.

## OUTPUT STRUCTURE

Each lesson MUST have this structure:
{
  "lesson_id": "m1-l1",
  "title": { "en": "English Title", "jp": "日本語タイトル" },
  "subtitle": { "en": "Brief description", "jp": "簡単な説明" },
  "reading_time": { "en": "10 min read", "jp": "10分で読める" },
  "sections": [
    {
      "id": "1-1",
      "title": { "en": "Section Title", "jp": "セクションタイトル" },
      "content": [ /* DocBlock array */ ]
    }
  ],
  "estimated_min": 10
}

## CONTENT BLOCK TYPES (Use ALL of these for variety!)

1. **text** - Use for explanations
   { "type": "text", "text": { "en": "...", "jp": "..." }, "style": "lead" }
   Styles: "lead" (intro paragraph), "normal", "quote"

2. **callout** - Use for tips, warnings, important notes
   { "type": "callout", "variant": "tip", "title": { "en": "...", "jp": "..." }, "text": { "en": "...", "jp": "..." } }
   Variants: "tip" (green), "info" (blue), "warning" (yellow), "success" (green)

3. **code** - Use for code examples
   { "type": "code", "language": "python", "filename": "example.py", "code": "print('Hello')" }

4. **list** - Use for step-by-step or key points
   { "type": "list", "items": [{ "en": "Point 1", "jp": "ポイント1" }, ...], "style": "bullet" }

5. **mermaid** - Use for diagrams (VERY IMPORTANT for visual learning!)
   { "type": "mermaid", "chart": "graph LR\\n  A-->B", "caption": { "en": "...", "jp": "..." } }

## CONTENT QUALITY RULES

1. ALL text MUST be bilingual (English AND Japanese)
2. Each section should have 4-6 content blocks
3. Use varied block types - NOT just text!
4. Include at least 1 diagram (mermaid) per lesson
5. Include at least 1 callout per section
6. Code examples must be practical and runnable
7. Make content EDUCATIONAL, not just summaries

## EXAMPLE SECTION

{
  "id": "1-1",
  "title": { "en": "Understanding Variables", "jp": "変数の理解" },
  "content": [
    { "type": "text", "text": { "en": "Variables are containers for storing data.", "jp": "変数はデータを格納するための入れ物です。" }, "style": "lead" },
    { "type": "mermaid", "chart": "graph LR\\n  Value[123]-->Variable[x]\\n  Variable-->Memory[(Memory)]", "caption": { "en": "How variables work", "jp": "変数の仕組み" } },
    { "type": "callout", "variant": "tip", "title": { "en": "Naming Convention", "jp": "命名規則" }, "text": { "en": "Use snake_case for Python variables.", "jp": "Pythonの変数にはsnake_caseを使いましょう。" } },
    { "type": "code", "language": "python", "filename": "variables.py", "code": "# Creating variables\\nname = 'Alice'\\nage = 25\\nprint(f'{name} is {age} years old')" },
    { "type": "list", "items": [{ "en": "Variables can store different types", "jp": "変数は様々な型を格納できる" }, { "en": "Names should be descriptive", "jp": "名前は説明的であるべき" }] }
  ]
}
`
```

### Phase 3: curriculumSchema の更新

`curriculumSchema` の `lessons` 部分を新しい `lessonSchema` に置き換え。

### Phase 4: アダプターの更新

`curriculumAdapter.ts` で新しいフォーマットを直接サポート（`sections` が既に存在する場合はそのまま使用）。

---

## 実装ファイル

| ファイル | 変更内容 |
|---------|---------|
| `server/geminiBackendService.js` | スキーマ更新 + プロンプト強化 |
| `services/curriculumAdapter.ts` | 新フォーマット対応（既に部分的に対応済み） |

## 見積り時間

- スキーマ更新: 30分
- プロンプト改善: 30分
- テスト: 30分
- **合計: 約1.5時間**

---

## 注意事項

1. **トークン制限**: リッチなコンテンツは出力が長くなるため、モジュール数を制限するか、分割生成を検討
2. **Mermaid構文**: Geminiが無効な構文を生成する場合があるため、UIでのエラーハンドリングが必要（既に実装済み）
3. **後方互換性**: 既存のカリキュラムは `curriculumAdapter` で変換されるため影響なし
