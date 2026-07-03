# 素材取り込み仕様（Audio / YouTube / DB）v0.1

## 目的
- audio / youtube / db の取り込みを統一したフローで扱い、RAGと引用に耐える抽出データを生成する
- 失敗理由を明示し、再試行や再アップロードの判断ができる状態にする

## 共通フロー（MVP）
1. `POST /api/materials` で素材メタを登録（`materials.status=uploaded`）
2. `POST /api/rag/index` が `jobs` に `ingest` を作成
3. Worker が `ingest` を実行し、`extracted_text_path` と `extracted_summary` を生成
4. `ingest` 完了後、`embed` を起動して `material_chunks` を生成
5. すべて成功で `materials.status=ready`、失敗は `materials.status=error`

## 生成物と保存先
- `materials.storage_path`: raw 原本
- `materials.extracted_text_path`: 文字起こし/抽出の ndjson
- `materials.extracted_summary`: 短い要約（DB保存）
- `material_chunks.content`: embedding対象テキスト
- `material_chunks.metadata`: 参照位置（time/page/rowなど）

## citations 参照形式（共通）
- `ref` の形式を素材種別で統一する
  - audio/youtube: `time:MM:SS-MM:SS`
  - db: `row:<row_id>` または `row:<row_id>/col:<col_name>`
- `quote` には抽出テキストの該当部分を入れる

## Audio 仕様
### 受け入れ
- 形式: mp3, m4a, wav
- 上限: サイズ/長さは運用で決定（例: 200MB / 120分）

### 処理
1. 正規化（mono, 16kHz など）
2. ASR で文字起こし
3. ndjson 生成（`start_ms`, `end_ms`, `text`）
4. チャンク化して埋め込み

### ndjson 例
```json
{"start_ms":0,"end_ms":12000,"text":"イントロダクションです。"}
```

### meta 例
```json
{
  "duration_sec": 734,
  "language": "ja",
  "asr_engine": "gemini-2.5-pro",
  "channels": 1
}
```

### 失敗コード例
- `unsupported_format`
- `duration_limit`
- `transcription_failed`
- `storage_read_failed`

## YouTube 仕様
### 受け入れ
- `source_url` に YouTube URL を保存
- `materials.type = youtube`

### 処理方針
1. 字幕がある場合は字幕を優先して抽出
2. 字幕が無ければ音声を取得して ASR（許可する場合のみ）
3. ndjson 生成と埋め込み

### meta 例
```json
{
  "video_id": "abc123",
  "channel": "ExampleChannel",
  "duration_sec": 1280,
  "caption_lang": "ja",
  "caption_source": "youtube"
}
```

### 失敗コード例
- `private`
- `geo_blocked`
- `caption_unavailable`
- `download_failed`

## DB 仕様（MVP）
### 受け入れ
- MVPはファイルベース（CSV/JSON/SQL dump）を想定
- 直接DB接続は vNext で検討

### 処理
1. スキーマ推定（カラム型、欠損率）
2. 行数、代表サンプルの抽出
3. 各行をテキスト化して ndjson 生成
4. 埋め込み対象は行テキスト

### ndjson 例
```json
{"row_id": 42, "text": "name=Alice, age=29, role=designer"}
```

### meta 例
```json
{
  "row_count": 12034,
  "column_types": {"name":"text","age":"int","role":"text"},
  "sample_rate": 0.05,
  "pii_flag": false
}
```

### 失敗コード例
- `unsupported_db_format`
- `schema_infer_failed`
- `row_parse_failed`

## リトライと再処理
- `jobs.dedupe_key` で冪等化し、重複実行を防ぐ
- 失敗時は `materials.status=error` と `materials.meta.error_code` を保存
- 再実行は `POST /api/rag/index?force=1` で新規ジョブを作成

## セキュリティ/プライバシー
- raw 原本は Storage に隔離し、DBには要約のみ保存
- DB素材は `pii_flag` を立て、必要なら UI で警告表示
- エラーログは最小限（素材本文は記録しない）

## 未決定事項
- ASRエンジンの確定（Gemini / Whisper / 外部API）
- YouTube の字幕のみ許可か、音声取得を許可するか
- DB 直接接続の範囲と認可方式
