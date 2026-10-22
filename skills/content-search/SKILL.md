---
name: content-search
description: |
  Rise Path の教育コンテンツを検索・取得する時に使用する。
  トリガー: "〇〇のレッスンを探して", "〇〇について教材はある？",
  "Blenderの〇〇はどこ？", "〇〇に関連するコンテンツ"
version: 1.0.0
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
1. ユーザーの質問からドメインとキーワードを特定
2. 曖昧な場合はドメインを確認する

### Step 2: 検索実行
1. `rag-search` ツールで検索 (max_results: 3)。検索対象は学習者本人がアップロードした教材だけ（他の学習者の資料や Rise Path のコース教材は含まない。`domain` は絞り込みに使われない）
2. コース（ドメイン）の一覧は `content://domains` リソースで参照

### Step 3: 結果提示
1. 関連度スコアの高い順に提示
2. 各結果にドメイン名・レッスンタイトル・概要を含める
3. 「このレッスンを始めますか？」と次のアクションを促す

## ルール
- ヒットしない場合は正直に「該当するコンテンツがありません」と伝える
- 近いトピックがあれば代替として提案する
- 新規カリキュラム生成を提案する場合は `curriculum-generator` スキルに引き継ぐ（ツール名: `save-curriculum-draft`）
