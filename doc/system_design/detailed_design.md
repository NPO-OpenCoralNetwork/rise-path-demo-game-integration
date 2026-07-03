# Detailed Design - Rise Path Learning Platform

## 1. System Architecture

### 1.1 Overview
The application is a **Hybrid Single Page Application (SPA)** built with **React 19**, **TypeScript**, and **Vite**. It employs a **Feature-Based Architecture** to manage complexity, organizing code by domain (AI, Art, Programming) rather than technical layer.

### 1.2 Technology Stack
*   **Frontend:** React 19, TypeScript, Vite.
*   **AI Engine:** Google Gemini API (Model Agnostic: 2.0 Flash, 3.0 Pro).
*   **State Management:** Local React State (`useState`) lifted to `App.tsx` for global navigation.
*   **Styling:** Tailwind CSS (via utility classes).
*   **Icons:** `lucide-react`.

## 2. Directory Structure (Feature-Based)
```
/src
  /components
    /common          # Shared UI (Layout, Buttons, Modals)
    /features
      /ai            # AI Generator, Chat, Concierge
      /art           # Art Museum curriculums
      /blender       # Blender curriculums
      /dashboard     # Dashboard, Profile, MyContent
      /programming   # Coding curriculums (Python, Web, Vibe)
      /sonic         # Sonic Pi / Synth
  /services          # API clients, Data fetchers
  /types             # TypeScript definitions
  App.tsx            # Main Controller & Router
```

## 3. Data Models (`types.ts`)

### 3.1 Big5 Profile
```typescript
export interface Big5Profile {
  openness: number;        // 0-100
  conscientiousness: number; // 0-100
  extraversion: number;    // 0-100
  agreeableness: number;   // 0-100
  neuroticism: number;     // 0-100
}
```

### 3.2 Generated Content
```typescript
export interface GeneratedChapter {
  id: string | number;
  title: string;
  duration: string;
  type: string;
  content: string;
  // Rich Educational Fields
  whyItMatters: string;
  keyConcepts: string[];
  actionStep: string;
  analogy: string;
}

export interface GeneratedCourse {
  id: string;
  title: string;
  description: string;
  // ...
  targetProfile?: Big5Profile;
}
```

## 4. Key Services (`geminiService.ts`)

### 4.1 Pedagogical Strategy Generation
The service includes a helper `generatePedagogicalStrategy(profile: Big5Profile)` that translates Big5 scores into specific prompting instructions:
*   **High Openness:** "Use metaphors, abstract concepts, connect dots."
*   **High Conscientiousness:** "Structure clearly, define outcomes, step-by-step."
*   **High Extraversion:** "Interactive, social context, energetic tone."
*   **High Neuroticism:** "Warn of pitfalls, provide safe guides, reassuring tone."

### 4.2 Course Generation Flow
1.  **Input:** User Topic + Big5 Profile + Model Preference.
2.  **Strategy:** Generate system prompt based on Profile.
3.  **Retrieval (Simulated):** Search `_mockVectorStore` for relevant context (RAG).
4.  **Generation:** Call Gemini API (Standard/Pro) with strict JSON schema.
5.  **Output:** Return `GeneratedCourse` object.

### 4.3 Self-Check & Autofix (Planned/Implemented)
*   **Schema Validation:** Runtime validation of Gemini出力を行い、必須欠落・型ズレを検知。
*   **Autofix Loop:** 1回目が不正ならエラー内容を添えて再プロンプトし、修正版のJSONのみを返すよう依頼する。
*   **Fallback:** 規定回数失敗時は最小限の構造（タイトル/説明/空チャプター）で返却し、UI崩壊を防ぐ。
*   **API Key Guard:** `API_KEY` 未設定を検知し、ユーザー向けに明示的なエラーメッセージを返す。
*   **RAG併用（将来）:** 参考コンテキストを「矛盾する場合はトピック優先」と明記してプロンプトに注入予定。

## 5. UI/UX Design

### 5.1 Course Generator View
*   **Topic Input:** Text field.
*   **Model Toggle:** Standard vs. Pro (Gemini 3.0).
*   **Personalization:** Sliders for Big5 traits + Preset buttons (Artist, Scientist, etc.).

### 5.2 Generated Lesson View
*   **Dynamic Rendering:** Displays content specific to the generated course.
*   **Rich Layout:** Cards for "Why It Matters", "Analogy", "Key Concepts", "Action Step".
*   **Navigation:** Next/Prev chapter controls.
*   **AI Chat Sidebar:** Context-aware chat (toggleable).

### 5.3 Geminiへのスライドデザイン指示（テンプレート参照用メタ生成）
*   **目的:** Geminiに見た目・動きのヒントをJSONで返させ、UI側でテンプレートに適用する。固定スライドを重ねるのではなく、メタ情報を解釈して描画する。
*   **プロンプト追記案 (`services/geminiService.ts` の必須出力要件に追加):**
    - 各スライドに `visualStyle`（色/質感・例: “インディゴ×シアン、暗め背景”）
    - `motionCue`（登場アニメ・例: “見出しフェードイン、箇条書き0.2秒ステップでスライドアップ”）
    - `accentIcon`（モチーフ・例: “sparkles”, “lightbulb”, “target” 等の一般名詞）
    - `layoutHint`（レイアウト意図・例: “左右2カラム、左テキスト右ビジュアル、余白広め”）
*   **JSONスキーマ拡張:** `slides[].{title, bullets[], timing?}` に加えて `visualStyle?: string`, `motionCue?: string`, `accentIcon?: string`, `layoutHint?: string` を許可。
*   **UI側の扱い:** 値が無い場合はデフォルトのスタイル/アニメを適用し、存在する場合のみ上書きする。未知の値は握りつぶして安全にフォールバック。
*   **トーン指定:** プロンプトに「暗色ベース」「過度な点滅禁止」「可読性優先」を入れ、過激なエフェクトを避ける。
*   **検証:** スキーマバリデーションで空配列や空文字を拒否しつつ、メタフィールドは任意扱いにすることで壊れないようにする。

## 6. Development Checklist (Generation Pipeline)
*   [x] `API_KEY` 未設定時の早期リターンとユーザーフレンドリーなメッセージ
*   [x] Gemini応答のJSONパース例外ハンドリング
*   [x] スキーマバリデーション（必須: title/description/duration/chapters[*].title/content/whyItMatters/keyConcepts/actionStep/analogy）
*   [x] 不正出力時の再プロンプト（エラー内容付き）と試行回数上限
*   [x] 最終フォールバック（簡易コース）でUIを壊さない
*   [x] RAG導入: 参考コンテキスト注入と矛盾解決方針の文言追加（現状はモックストアを参照）
*   [ ] ロギング: モデル種別・所要時間・失敗理由（PIIなし）

## 7. Future Considerations
*   **Real Vector DB:** Replace `_mockVectorStore` with Pinecone or pgvector.
*   **User Persistence:** Save generated courses and profiles to a backend DB.
*   **Content Sources:** 外部資料（HTML/PDFなど）は `data/curricula/blender/` などのサブディレクトリ＋メタデータ(JSON/YAML)で管理し、RAG時に出典・バージョンを参照できるようにする。

### Blender Docs Ingestion Status
- 現在: `data/curricula/blender/blender_manual_v500_en.html/` に公式マニュアルHTML一式を配置し、`metadata.json` にタイトル/バージョン/言語/ライセンス/抽出ポリシーを記載。
- 未着手: 本文抽出・分割・インデックス化・Embedding。

### Next Actions for Blender RAG
1) HTML構造の抽出スクリプトを作成（例: Node + cheerio）。対象: `article#furo-main-content` 配下の `h1/h2/h3` と `p/li` を連結し、不要な nav/aside/figure を除外。
2) セグメント分割: 800–1200文字 + 100文字オーバーラップで段落をまとめ、見出しパスをプレフィックスとして残す。
3) メタ付与: fileパス/セクションID/見出しパス/ソース/バージョン/言語/ライセンスを各レコードに付与し、`data/curricula/blender/index.jsonl` などに保存。
4) 検索: ひとまずキーワード/TF-IDFで検索、Embedding導入時は同レコードにベクトルを付加してセマンティック検索へ移行。
5) プロンプト注入: 上位2–3件を300–500字に短縮し、「参考情報（矛盾時はトピック優先）」として生成プロンプトに注入。

### RAG 取得・閾値・ログの運用案
- フィルタ: Blender/3D関連語のみでRAGを有効化（例: /blender|3d|geometry|render/i）。誤検知や過剰除外はログを見て調整。
- スコア閾値: BM25スコアが低いものは捨てる。まず得点分布をログし、誤ヒットが混ざらない下限を決める。閾値未達なら「参考コンテキストなし」で注入しない。
- 件数上限: 2〜3件を基本とし、詳細モードのみ5件など用途別に設定。トークン節約と矛盾リスク低減が目的。
- ログ: セグメントID/スコア/セクション名/クエリのみを記録（本文はログしない）。PII/著作権配慮を徹底。
- フォールバック: 閾値未達・ヒット0件の場合はRAGセクションを挿入しないか、短いメッセージを入れるだけにする。
