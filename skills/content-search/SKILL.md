---
name: content-search
description: |
  学習者本人がアップロードした教材から、関連する箇所を探して引用する時に使用する。
  トリガー: "私の教材に〇〇について書いてある？", "アップロードした資料で〇〇を探して",
  "Blenderの〇〇は資料のどこ？", "〇〇に関連する箇所"
version: 1.1.0
---

# コンテンツ検索スキル

## 利用可能なドメイン
- `vibe-coding`: 物語駆動型コーディング (Prologue + Chapter 0-11)
- `claude-code`: Claude Code 実践、AIエージェントとの開発 (第1-11回)
- `blender-3d`: Blender 3Dモデリング (Stage 1-5+)
- `art-atelier`: 美術史、金継ぎ、トライバルアート、工芸
- `programming-web`: HTML/CSS, WebInspector
- `programming-ai`: Python, Gen AI
- `sonic-lab`: サウンド・シンセサイザー
- `p-school`: ブロックプログラミング (Phaser + Blockly)
- `unity`: Unity AI Game Dev

## 手順

### Step 1: クエリ分析
1. ユーザーの質問から、探す語（キーワード）を特定する
2. Rise Path のコースやレッスンを探している質問なら、このスキルの検索ではなく、コースの一覧（下の Step 2 の 2）から案内する

### Step 2: 検索実行
1. `rag-search` ツールで検索 (max_results: 3)。検索対象は学習者本人がアップロードした教材だけ（他の学習者の資料や Rise Path のコース教材は含まない。`domain` は絞り込みに使われない）
2. コース（ドメイン）の一覧は `content://domains` リソースで参照

### Step 3: 結果提示
1. 関連度スコア（`relevance_score`）の高い順に提示する
2. 各結果は、教材の中の場所 `location`（例: 「Blender入門.pdf」3 ページ目、あなたの教材・全 4 か所のうち 2 番目）を示して引用する。ページは PDF のファイルの先頭から数えた番号で、紙に印刷されたページ番号とは違うことがある。結果は学習者本人の教材でレッスンではないので、`location` にない教材の名前・ページ・レッスン名を作らない
3. 内容は、その結果の `content`（当たった語のまわりの抜き出し）から伝える。`content` にないことを、教材に書いてあるように言わない

## ルール
- ヒットしない場合は正直に「該当するコンテンツがありません」と伝える
- 近いトピックがあれば代替として提案する
- 新規カリキュラム生成を提案する場合は `curriculum-generator` スキルに引き継ぐ（ツール名: `save-curriculum-draft`）
