---
name: personal-memory-curator
description: |
  会話終了後に、ユーザーの明示 opt-in に基づき学習傾向を 0〜2 件だけ記憶する。
  トリガー: learning-coach / life-habit-analyst の応答完了後（親 Skill から委譲）
version: 1.0.0
metadata:
  hermes:
    category: rise-path
    tags: [memory, privacy, capture]
---

# 個人記憶キュレーター（Phase 19-4）

Hermes が応答を完了した**後**にのみ実行する。メイン回答の前に呼ばない。

## 前提（サーバー側で強制）

- `ai_memory.enabled === false` → **何もしない**（ツールを呼ばない）
- `allow_conversation_capture === false` → **何もしない**
- 上記は `learner-memory-remember` 側でもゲートされるが、Skill でも無駄呼び出しを避ける

## 手順

1. 直前のユーザー発話 + 自分の応答を見て、**保存候補を 0〜2 件**だけ抽出する。
2. 保存してよい type のみ: `preference` / `instruction` / `goal`
3. 各候補は **原子事実 1 文**（最大 2000 文字）。日記全文・健康の詳細・第三者の個人情報は禁止。
4. `confidence >= 0.7` のものだけ `learner-memory-remember` を呼ぶ。
   - `provenance`: `inferred`（省略時もサーバーが `inferred` 扱い）
   - `source`: `hermes-skill`
   - `explicit_statement` は使わない（ユーザー明示の「覚えて」は親 Skill が `source: hermes-explicit` で処理）
5. 1 件でも保存したら、ユーザーに 1 行だけ通知する:
   - 例（jp）: `「短いセッションを好む」を記憶しました。設定でいつでも削除できます。`
   - 例（en）: `I saved that you prefer short sessions. You can remove it in Settings.`
6. 候補が 0 件、または confidence が低い場合は **remember を呼ばず**、通知もしない。

## 保存してよい例

- 「図解で説明してほしい」→ `preference`
- 「毎朝 30 分だけ勉強したい」→ `goal`
- 「結論を先に言ってほしい」→ `instruction`

## 保存禁止

- 日記の全文・睡眠の数値羅列
- 医療・心理の診断内容
- 他人の名前・連絡先
- 会話ログの要約丸ごと（`event` 相当）

## ツール

| ツール | 用途 |
|--------|------|
| `mcp_rise_path_learner_memory_remember` | 候補を 1 件ずつ保存（最大 2 回/応答） |

`learner-memory-recall` は呼ばない（親 Skill がセッション開始時に実施済み）。