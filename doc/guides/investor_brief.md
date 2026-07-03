# Rise Path Investor Brief

## One-liner
パーソナライズ学習と没入体験（Vibe）を融合した、次世代AI学習プラットフォーム。
静的カリキュラム（Gold Standard）とAI生成（Pro）をハイブリッド提供。

## Problem
- 既存LMSは画一的で継続率が低い
- 学習者の性格や目的に合わせた最適化が不足
- コミュニティ拠点（子ども食堂/サードプレイス）に導入しやすい学習基盤が少ない

## Solution
- Big5人格特性に基づくカリキュラム最適化
- 3段階承認（Requirements -> Roadmap -> Curriculum）で品質と納得感を担保
- RAGによる根拠付き生成と引用保持

## Product
- AIコンシェルジュが要件をヒアリング
- 段階承認後に構造化JSONとして保存
- 生成コンテンツを即UIに反映（vibe_codingテンプレ）

## Differentiation
- マルチエージェント設計（Interviewer/Architect/Writer/Reviewer）
- 構造化出力でUI品質を安定化
- マルチフォーマット学習（スライド/対話/チェックリスト/クイズ）

## Tech Snapshot
- Frontend: React 19 + Vite + TypeScript
- Backend: Node/Express + LangGraph
- Data: Postgres + pgvector（任意）
- AI: Google Gemini

## Pricing (USD / month)

### B2C
| Plan | Price | Generation/Chat | RAG Sources | Notes |
| --- | --- | --- | --- | --- |
| Free | $0 | 1 course/mo + light chat | 1 | 体験版 |
| Starter | $10 | 5 courses/mo + heavy | 10 | 非公開コース生成 |
| Creator | $20 | 15 courses/mo + very heavy | 30 | 公開/収益化 + API/MCP (上限あり) |
| Max | $50 | near-unlimited | 100 | ほぼ無制限 + API/MCP上限拡大 |

### Community / Facility (B2B2C, per site)
| Plan | Price | Learners | Credits | Notes |
| --- | --- | --- | --- | --- |
| Community Free (Sponsored) | $0 | <= 20 | 50 | 無料枠 |
| Community Start | $49 | <= 80 | 400 | 講師3名 |
| Community Plus | $149 | <= 250 | 1500 | TTS/講師10名 |
| Network | $299 | <= 5 sites | 3000 | 管理/レポート |

Add-on: $10 / 120 credits (生成 + API/MCP利用枠)  
Revenue mix: subscription + credits + sponsored community seats

## Traction / Status
- MVP完成
- 2月から大阪の子ども食堂2拠点で導入開始
- LangGraph + RAG + DB同期 + 承認フローまで実装済み
- Blender/Unity/Art/Programmingなど複数ドメインで展開可能

## 12-Month Roadmap (Targets)
- 0-3 months: 大阪2拠点パイロット稼働、RAG取り込み運用化
- 4-6 months: マルチフォーマット本番化、TTS/音声同期
- 7-9 months: B2C課金 + クレジット課金の本格運用
- 10-12 months: Community導入拡大とテンプレ拡充

## Ask
- €1.0M Seed (18-24 months runway)
- Use of funds: 45% Product/AI, 35% GTM/Partnerships, 20% Infra/Ops

## Demo Flow (2-3 min)
1. テーマ入力 or 資料アップロード
2. Requirements / Roadmap / Curriculum の承認
3. 生成コースをLesson Viewで閲覧

## Inputs Needed (if available)
- パイロットのKPI（MAU/週次利用/生成回数）
- 価格検証の結果（有料転換率）
- 導入パートナー数/増加計画
