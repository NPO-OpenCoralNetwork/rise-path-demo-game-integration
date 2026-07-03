# 📚 RisePath プロジェクト ドキュメントハブ

プロジェクト開発におけるすべてのドキュメントをここで管理します。

## 🗺️ コラボレーションツール（外部リンク）
開発メンバー間でのアイデア共有やデザイン共有のために、以下の外部ボードを使用しています。

*   **🎨 Figma (UIデザイン & プロトタイプ)**: [Figmaメインプロジェクトボード](https://figma.com/...)
    *   画面設計、キャラクターの立ち絵・ビジュアルアセット、UIパーツなどの最新デザインはこちらで管理されています。
*   **📍 Miro (世界観 & ゲームフロー設計)**: [Miroビジュアル・イメージボード](https://miro.com/...)
    *   ゲーム全体のシステムフロー、ストーリー構成、初期のコンセプトイメージなどがまとめられています。

---

## 📂 ドキュメントの構成

| ディレクトリ | 役割・内容 |
| :--- | :--- |
| **[`README.md`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/README.md)** | このインデックスファイル。全体マップ。 |
| **[`assets_management.md`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/assets_management.md)** | **[NEW]** アセットのブラッシュアップ進行管理リストと適用ルール。 |
| **[`design_concept.md`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/design_concept.md)** | **[NEW]** ゲームのアート＆デザインコンセプト仕様書（配色定義、AI推奨プロンプト等）。 |
| **[`system_design/`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/system_design/)** | システムの基本仕様書、データベース設計（RLS）、マルチエージェントシステムの設計など。 |
| **[`curricula/`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/curricula/)** | カリキュラム設計書。各チャプターのドキュメント原稿。 |
| **[`phases/`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/phases/)** | フェーズごとの要件定義および詳細仕様書（Phase 7〜19）。 |
| **[`guides/`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/guides/)** | 開発者向け各種ガイド。環境構築・デプロイ方法のほか、以下を含みます：<br>・[アセット安全適用ワークフロー](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/guides/assets_workflow.md)<br>・[チーム開発ガイドライン](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/guides/team_development_guidelines.md)<br>・[NanoBananaアセット生成・適用ワークフロー](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/guides/nanobanana_workflow.md)<br>・[コンセプトボード作成ガイドライン](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/guides/concept_board_guidelines.md)<br>・[セキュリティガイドライン & 漏洩防止](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/guides/security_guidelines.md) **[NEW]** |
| **[`archive/`](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/archive/)** | 過去バージョンのアーキテクチャ設計や、解決済みのIssueに関する一時メモ。 |

---

## 🛠️ ドキュメント管理・更新のルール

1.  **新しいドキュメントを追加する場合**:
    *   適切なディレクトリ（仕様書なら `phases/`、システム全体設計なら `system_design/`）に配置してください。
    *   本ファイル（`doc/README.md`）の一覧に追記してください。
2.  **アセットを更新・追加する場合**:
    *   [アセット管理ドキュメント (`doc/assets_management.md`)](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/assets_management.md) のステータスとFigmaリンクを必ず更新してください。

---

## 📋 GitHub Issues (タスク・進捗追跡)
本ドキュメントの再配置とアセット進行管理は、以下のGitHub Issuesにてタスク化し、追跡しています。

*   **Epic**: [#39 [Epic] ドキュメント整理とアセット進行管理の構築](https://github.com/t012093/rise-path-demo-game-Integration-/issues/39)
    *   [#35 [Task] カテゴリ別フォルダ整理](https://github.com/t012093/rise-path-demo-game-Integration-/issues/35) (✅ 完了)
    *   [#36 [Task] アセット管理ドキュメントの作成](https://github.com/t012093/rise-path-demo-game-Integration-/issues/36) (✅ 完了)
    *   [#37 [Task] アセット安全適用ワークフロー定義](https://github.com/t012093/rise-path-demo-game-Integration-/issues/37) (✅ 完了)
    *   [#38 [Task] チーム開発ガイドライン作成](https://github.com/t012093/rise-path-demo-game-Integration-/issues/38) (✅ 完了)

---

## ⚖️ ライセンス (License)

本プロジェクトは **[Apache License, Version 2.0](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/LICENSE)** の下でライセンスされています。商用利用、改変、再配布が許諾されていますが、著作権表示および免責事項の保持が必要です。詳細は [LICENSE](file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/LICENSE) ファイルを参照してください。

Copyright 2026 Naoya Kusunoki / Coral Network

