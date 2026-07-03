# Issue: BYO-A (Bring Your Own Agent) カリキュラム生成・インポート方式の実装

## 1. 概要
ホスト側のLLM APIコストを削減し、学習者のプライバシーを保護しつつ、大ボリュームかつ動作検証済みのカリキュラムを生成・インポートできる **BYO-A（エージェント持ち込み型）** 方式を実装します。ユーザーローカルのAIエージェント（Antigravity等）が並行執筆とコード検証を行い、認証トークンを使ってRise Pathにカリキュラムを同期します。

---

## 2. 実装タスク・チェックリスト

### 【タスク1】フロントエンド：JWT セッションのエクスポート機能
- [ ] ログイン成功時または設定画面（`SettingsView`）に「エージェント接続用トークンの保存」ボタンを追加する。
- [ ] ローカルPCの `~/.config/risepath/credentials.json` に、現在の Supabase JWT トークンと API Base URL を書き出すヘルパーを実装する。

### 【タスク2】バックエンド：インポート API のUUID採番 & IDOR対策の改修
- [ ] `POST /api/v2/curricula` において、`curriculum_id` が未指定または無効なUUIDの場合、DB側で `gen_random_uuid()` を適用して自動採番するよう改修。
- [ ] 送信された `learner_profile_id` が、リクエスト送信者（`req.userId`）に紐づくものかを検証するIDOR防止ロジックを追加。

### 【タスク3】ローカル：同期用CLIツール (`byoa-sync-curriculum.js`) の作成
- [ ] `~/.config/risepath/credentials.json` から認証情報と接続先を自動ロードする。
- [ ] ローカルで生成したカリキュラム JSON を読み込み、API に同期（インポート）を試行するスクリプトを `/scripts` 配下に実装する。

### 【タスク4】ローカル：コード検証ハーネス (`harness-code-validator.js`) の作成
- [ ] 生成されたカリキュラム内のコードブロックをパースして抽出する。
- [ ] 抽出したコードを一時ディレクトリ（`/tmp/risepath-sandbox/`）に隔離し、5秒のタイムアウト付きで子プロセス（`child_process`）実行する。
- [ ] 実行時エラーやタイムアウトを検出し、エージェントへフィードバックする。

### 【タスク5】ローカルエージェント：MCP Tool への登録
- [ ] ローカルの Antigravity/Codex 用 MCP サーバーに `generate_rich_curriculum` ツールを登録し、上記検証・同期パイプラインと接続する。

---

## 3. 実装フロー

```
[フロント] ログイン/設定画面で JWT を `credentials.json` に書き出す
   ↓
[エージェント] `credentials.json` から JWT とユーザーの Big5 プロファイルを取得
   ↓
[エージェント] 子エージェントを回して各レッスン執筆 ＆ コードを `harness-code-validator.js` で検証
   ↓
[エージェント] 全レッスンをマージし、ローカル品質適合テストを実行
   ↓
[エージェント] `byoa-sync-curriculum.js` をキックし、VMの API へインポート完了
```
