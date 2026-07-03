# 実装計画: AIカリキュラム生成のドキュメント形式対応

## 概要

現在のAI生成カリキュラムはシンプルな `doc_blocks` 形式を使用していますが、これを `DocChapter` / `LocalizedDocBlock` 形式に変更し、`VibeDocView` コンポーネントで美しいドキュメントビューとして表示できるようにします。

## 現状分析

### 現在のデータ構造 (`geminiBackendService.js`)
```javascript
// 現在の簡素な doc_blocks
doc_blocks: [
  { type: "text", content: "説明文..." },
  { type: "code", content: "...", language: "python" },
  { type: "bullets", items: ["項目1", "項目2"] }
]
```

### 目標のデータ構造 (`DocChapter` 形式)
```typescript
// リッチな LocalizedDocBlock 形式
sections: [
  {
    id: "section-1",
    title: { en: "Introduction", jp: "はじめに" },
    content: [
      { type: "text", text: { en: "...", jp: "..." }, style: "lead" },
      { type: "callout", variant: "tip", title: {...}, text: {...} },
      { type: "mermaid", chart: "graph LR...", caption: {...} },
      { type: "code", code: "...", language: "python", filename: "example.py" }
    ]
  }
]
```

---

## Phase 1: バックエンド - AI生成スキーマの更新

### Task 1.1: 新しい `DocChapter` スキーマの定義
**ファイル:** `server/geminiBackendService.js`

新しい JSON Schema を追加して Gemini が `DocChapter` 形式で生成するようにする：

```javascript
const docBlockSchema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, enum: ["text", "code", "callout", "list", "mermaid", "image"] },
    // text type
    text: { 
      type: Type.OBJECT, 
      properties: { 
        en: { type: Type.STRING }, 
        jp: { type: Type.STRING } 
      }
    },
    style: { type: Type.STRING, enum: ["normal", "lead", "quote"] },
    // code type
    code: { type: Type.STRING },
    language: { type: Type.STRING },
    filename: { type: Type.STRING },
    // callout type
    variant: { type: Type.STRING, enum: ["info", "warning", "tip", "success"] },
    title: { type: Type.OBJECT, properties: { en: { type: Type.STRING }, jp: { type: Type.STRING } } },
    // list type
    items: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { en: {...}, jp: {...} } } },
    // mermaid type
    chart: { type: Type.STRING },
    caption: { type: Type.OBJECT, properties: { en: {...}, jp: {...} } }
  },
  required: ["type"]
};

const docSectionSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: { type: Type.OBJECT, properties: { en: {...}, jp: {...} }, required: ["en", "jp"] },
    content: { type: Type.ARRAY, items: docBlockSchema }
  },
  required: ["id", "title", "content"]
};
```

### Task 1.2: `curriculumSchema` のレッスン構造を更新
**ファイル:** `server/geminiBackendService.js`

現在の `doc_blocks` を `sections` (DocSection[]) に置き換え：

```javascript
lessons: {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      lesson_id: { type: Type.STRING },
      title: { type: Type.OBJECT, properties: { en: {...}, jp: {...} } },
      subtitle: { type: Type.OBJECT, properties: { en: {...}, jp: {...} } },
      reading_time: { type: Type.OBJECT, properties: { en: {...}, jp: {...} } },
      // 新しい sections 形式
      sections: { type: Type.ARRAY, items: docSectionSchema },
      // クイズは別途保持
      quiz: quizSchema
    }
  }
}
```

### Task 1.3: プロンプトの更新
**ファイル:** `server/geminiBackendService.js`

`generateCurriculum` 関数の `systemInstruction` を更新：

```javascript
systemInstruction: `
  You are a Content Developer for 'Rise Path Learning Platform'.
  Generate educational content in the DocChapter format.
  
  IMPORTANT CONTENT RULES:
  1. ALL text content MUST be bilingual (en + jp).
  2. Use varied block types for engagement:
     - 'text' with style='lead' for introductions
     - 'callout' with variant='tip' for important hints
     - 'mermaid' for diagrams (use valid Mermaid syntax)
     - 'code' with filename for code examples
     - 'list' for step-by-step instructions
  3. Each section should have 3-5 content blocks.
  4. Create RICH, EDUCATIONAL content - not just summaries.
  
  OUTPUT STRUCTURE:
  Each lesson should have 'sections' array with DocSection objects.
  Each section has 'id', 'title' (LocalizedText), and 'content' (LocalizedDocBlock[]).
`
```

---

## Phase 2: 型定義の拡張

### Task 2.1: 生成されたカリキュラム用の型を追加
**ファイル:** `types.ts`

```typescript
// 生成されたレッスン（DocChapter互換）
export interface GeneratedLesson extends DocChapter {
  lesson_id: string;
  estimated_min: number;
  unlock_rule: 'doc_completed' | 'manual' | 'immediate';
  quiz?: QuizData;
  ui_hints?: {
    card_title: string;
    card_text: string;
    cta: string;
    difficulty: 'easy' | 'medium' | 'hard';
    time: string;
    tags: string[];
  };
}

// 生成されたモジュール
export interface GeneratedModule {
  module_id: string;
  title: LocalizedText;
  objective: LocalizedText;
  estimated_hours: number;
  lessons: GeneratedLesson[];
  module_ui_hints?: {
    card_title: string;
    card_text: string;
    tags: string[];
    difficulty: 'easy' | 'medium' | 'hard';
  };
}

// 生成されたカリキュラム（V2）
export interface GeneratedCurriculumV2 {
  curriculum_id: string;
  version: number;
  ui_template_id: 'doc_chapter'; // 新しいテンプレートID
  title: LocalizedText;
  description: LocalizedText;
  modules: GeneratedModule[];
  created_at: Date;
}
```

---

## Phase 3: フロントエンド - ビューコンポーネントの作成

### Task 3.1: `GeneratedDocView.tsx` の作成
**ファイル:** `components/features/ai/GeneratedDocView.tsx`

`VibeDocView` をベースに、生成されたカリキュラムを表示するコンポーネントを作成。

主な機能：
- Doc / Quiz のタブ切り替え（Slideは任意）
- `LocalizedDocBlock` のレンダリング（`BlockRenderer`）
- 目次 (TOC) サイドバー
- 言語切り替え (EN/JP)

```tsx
interface GeneratedDocViewProps {
  lesson: GeneratedLesson;
  onBack: () => void;
  onComplete: () => void;
  language: 'en' | 'jp';
}
```

### Task 3.2: `GeneratedLessonView` の更新
**ファイル:** `components/features/ai/GeneratedLessonView.tsx`

既存のスライド形式から `GeneratedDocView` を使用するように変更。

```tsx
// 変更前
<SlidePlayer slides={chapter.slides} />

// 変更後
<GeneratedDocView lesson={lesson} onBack={...} onComplete={...} language={language} />
```

### Task 3.3: ルーティングの更新
**ファイル:** `App.tsx` / `GeneratedLessonViewWrapper.tsx`

レッスンIDからデータを取得し、新しい `GeneratedDocView` に渡す。

---

## Phase 4: データ変換アダプター

### Task 4.1: `curriculumAdapter.ts` の作成
**ファイル:** `services/curriculumAdapter.ts`

現行フォーマットと新フォーマットを相互変換するアダプター：

```typescript
// 旧形式 (doc_blocks) → 新形式 (sections)
export const legacyToDocChapter = (lesson: LegacyLesson): GeneratedLesson => {
  return {
    id: lesson.lesson_id,
    title: normalizeLocalizedText(lesson.summary),
    subtitle: { en: '', jp: '' },
    readingTime: { en: `${lesson.estimated_min} min`, jp: `${lesson.estimated_min}分` },
    sections: [{
      id: 'main',
      title: { en: 'Content', jp: 'コンテンツ' },
      content: lesson.doc_blocks.map(convertBlock)
    }],
    lesson_id: lesson.lesson_id,
    estimated_min: lesson.estimated_min,
    unlock_rule: lesson.unlock_rule,
    quiz: lesson.quiz ? convertQuiz(lesson.quiz) : undefined
  };
};

// 旧ブロック → LocalizedDocBlock
const convertBlock = (block: LegacyBlock): LocalizedDocBlock => {
  if (block.type === 'text') {
    return { 
      type: 'text', 
      text: { en: block.content, jp: block.content },
      style: 'normal'
    };
  }
  // ... 他のタイプも同様
};
```

---

## Phase 5: テストと検証

### Task 5.1: バックエンドのテスト
- 新しいスキーマで Gemini API を呼び出し、有効な JSON が返されることを確認
- 必須フィールドの存在確認
- バイリンガルテキストの検証

### Task 5.2: フロントエンドのテスト
- 既存のカリキュラム（旧形式）が引き続き表示されることを確認
- 新形式のカリキュラムが `GeneratedDocView` で正しく表示されることを確認
- 言語切り替えが動作することを確認

### Task 5.3: E2Eテスト
- 新規カリキュラム生成 → 承認 → 閲覧の全フローをテスト

---

## 実装順序

| 順序 | タスク | 優先度 | 見積り時間 |
|-----|--------|--------|-----------|
| 1 | Task 4.1: アダプター作成（後方互換性確保） | 高 | 1時間 |
| 2 | Task 3.1: GeneratedDocView 作成 | 高 | 2時間 |
| 3 | Task 3.2-3.3: 既存ビューとルーティング更新 | 高 | 1時間 |
| 4 | Task 1.1-1.3: バックエンドスキーマ＆プロンプト更新 | 中 | 2時間 |
| 5 | Task 2.1: 型定義の拡張 | 中 | 30分 |
| 6 | Task 5.1-5.3: テスト | 高 | 1時間 |

**合計見積り時間:** 約 7.5 時間

---

## リスクと考慮事項

1. **後方互換性**: 既存のカリキュラムデータは旧形式のため、アダプターで変換する必要がある
2. **API レスポンスサイズ**: リッチなコンテンツは出力が長くなる可能性がある（Gemini のトークン制限に注意）
3. **Mermaid 構文**: Gemini が無効な Mermaid 構文を生成する可能性がある（エラーハンドリングが必要）
4. **多言語品質**: 自動翻訳の品質を確認する必要がある

---

## 成果物

完了後、以下が実現されます：

1. ✅ AIが `DocChapter` 形式のリッチなカリキュラムを生成
2. ✅ 各レッスンがドキュメントビュー（目次付き）で表示される
3. ✅ callout、mermaid、code などの多様なブロックタイプをサポート
4. ✅ EN/JP 言語切り替えが全コンテンツで動作
5. ✅ 既存のカリキュラムも引き続き表示可能（アダプター経由）
