# Issue #8: Blender画像メタデータ強化と検索設計

## 概要
Blenderマニュアルの画像をカリキュラム生成に活用するために、画像メタデータを厚くし、検索精度を上げるための設計とアーキテクチャを定義する。

## 目的
- カリキュラム生成時に、LLMが「どの画像を使うべきか」を判断しやすいメタ情報を提供する。
- 検索精度を段階的に向上できる土台を作る（BM25 → ベクトル → 再ランキング）。
- 日本語クエリでも妥当な検索結果が返るようにする。

## 非目的
- 画像の視覚認識（画像内容の自動理解）までは行わない。
- 管理UIの実装は本Issueの範囲外。

## 現状
- `data/curricula/blender/image_index.jsonl` を生成済み。
- 主要フィールドは `image`, `caption`, `headingPath`, `pageTitle`, `alt`, `file`。
- 検索は簡易スコアリングのみで、LLM生成時の注入は未実装。

---

# 設計書

## 1) メタデータ強化（メタを厚くする）
### 追加フィールド案
- `contextBefore`: 図の直前段落の要約/短文（~240文字）
- `contextAfter`: 図の直後段落の要約/短文（~240文字）
- `keywords`: `caption` + `headingPath` + `context` から抽出したタグ（配列）
- `langHints`: `["en", "ja"]` などの推定言語
- `tokens`: 正規化済みトークン（検索用）

### 抽出ルール
- `<figure>` 内の `<figcaption>` を最優先で `caption` に採用。
- `<img>` の前後にある `<p>`, `<li>` などから `contextBefore/After` を収集。
- `headingPath` は `<h1..h3>` を階層で連結。

### タグ生成ルール
- `caption/headingPath/pageTitle` をトークン化し、ストップワードを除去。
- `file` のパス分割からドメイン語彙を追加（例: `scene_layout` -> `scene layout`）。
- Blender固有語彙の辞書を追加（JP/EN相互変換）。

## 2) 検索手法の改善
### フェーズ1: BM25（軽量）
- フィールド重み: `caption > headingPath > context > pageTitle > alt`
- 低コストで精度改善、クライアントでも実装可能。

### フェーズ2: ベクトル検索（精度重視）
- `caption + headingPath + context` の埋め込みを作成。
- 近傍検索 + BM25のハイブリッド（スコア合成）。

### フェーズ3: 再ランキング
- 上位K件をLLM/軽量モデルで再ランキング。
- 例: `query` と `caption+context` を比較し最適を選ぶ。

## 3) 日本語クエリ対策
- JP/EN辞書での展開（例: `頂点` -> `vertex`）。
- 形態素分割 or 簡易分割で重要語抽出。
- 英日両方で検索し、結果をマージ。

## 4) LLM注入フォーマット
LLMに渡す候補は、**簡潔で比較しやすい形**にする。

例:
```
【画像候補】
1) image=_images/scene-layout_collections_introduction_scene-collection.png
   caption=The scene collection.
   heading=Introduction
   page=Scene Layout > Collections
```

---

# アーキテクチャ

## データフロー
```
Blender HTML
  -> Extractor (scripts/extract_blender_images.js)
  -> image_index.jsonl (metadata)
  -> Search Service (BM25 / Vector / Hybrid)
  -> Prompt Assembler
  -> LLM (generateCourse)
```

## コンポーネント
- **Extractor**: HTMLから画像・キャプション・見出し・文脈を抽出
- **Index Store**: JSONL or SQLite/FTS5 or Vector DB
- **Search Service**: query -> topK image candidates
- **Prompt Assembler**: 生成時に画像候補を付与

## 既存構成との接続
- `services/geminiService.ts` に画像検索結果を注入
- `services/blenderRagService.ts` の画像版を追加（予定）
- `public/data/curricula/blender/image_index.jsonl` をフロントで取得

---

# 検証・評価
## 評価指標
- Top-K 内に「目的画像」が入る割合（手動判定）
- 生成結果の「画像の妥当性」レビュー（人手）

## 受け入れ条件
- 主要カテゴリ（入門/モデリング/レンダー）で妥当な候補が上位に出る。
- 日本語クエリでのヒット率が明確に向上する。

---

# 実装フェーズ案
1. **メタ拡充**: context/keywords を生成し JSONL を更新
2. **BM25導入**: 既存検索をBM25化 + フィールド重み付け
3. **日本語対策**: JP/EN辞書展開 + 検索合成
4. **統合**: 生成時に画像候補を prompt へ注入
5. **評価**: 手動レビュー/ログ改善

---

# リスク
- JSONLが肥大化し、初回ロードが重くなる
- 文脈抽出が冗長でノイズになる
- 画像の意図がキャプションだけでは伝わらないケースが残る

---

# 未決定事項
- ベクトル化をローカルで行うか、API経由にするか
- 再ランキングにどのモデルを使うか
- 画像候補の最大数とUI表示方針
