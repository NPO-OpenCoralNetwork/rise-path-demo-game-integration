# コンテンツ型とTTS仕様（v0.2 — Kokoro）

このドキュメントは、`vibe_coding` の**ドキュメントタイプ**と**スライドタイプ**、
および**TTS生成/音声同期**の仕様方針をまとめる。
TTS エンジンは **Kokoro-82M ONNX** を採用する（Gemini Native TTS / gTTS は廃止予定）。

## 1. ドキュメントタイプ（DocChapter）

### 1.1 目的
- 章単位の教材を「読み物」として構造化する
- UIは `VibeDocView` の `doc` タブで表示する

### 1.2 構造
```ts
type LocalizedText = { en: string; jp: string };

type DocChapter = {
  id: string;
  title: LocalizedText;
  subtitle: LocalizedText;
  readingTime: LocalizedText;
  sections: DocSection[];
};

type DocSection = {
  id: string;
  title: LocalizedText;
  content: LocalizedDocBlock[];
};
```

### 1.3 Docブロック種別（LocalizedDocBlock）
以下は `types.ts` の `LocalizedDocBlock` に準拠する。

- `text`: `text`, `style?` (`normal` | `lead` | `quote`)
- `image`: `src`, `alt`, `caption?`, `layout?` (`full` | `float-right`)
- `code`: `code`, `language`, `filename?`, `highlightLines?`
- `list`: `items`, `style?` (`bullet` | `number` | `check`)
- `callout`: `title?`, `text`, `variant` (`info` | `warning` | `tip` | `success`)
- `mermaid`: `chart`, `caption?`
- `table`: `headers`, `rows`
- `mindmap`: `root`（階層ノード構造）

### 1.4 ローカライズ
- 生成は `LocalizedText`（`jp` と `en`）を基本とする
- UI側のフォールバックは `jp → en → string` の順で許容

## 2. スライドタイプ（GeneratedChapter.slides）

### 2.1 目的
- ドキュメントの要点をスライド形式で表示する
- TTSの読み上げ単位として利用する

### 2.2 構造
```ts
type Slide = {
  title: string;
  bullets: string[];
  speechScript?: string;
  timing?: string;
  visualStyle?: string;
  motionCue?: string;
  accentIcon?: string;
  layoutHint?: string;
  imagePrompt?: string;
  highlightBox?: string;
};
```

### 2.3 生成方針（MVP）
- 1章あたり**最低1枚**のスライドを保証する
- 1セクションあたり1〜3枚を目安にし、章全体で8枚以内を推奨
- `speechScript` を優先してTTSに流し、無い場合は `bullets` を結合して読む
- `visualStyle` / `motionCue` / `accentIcon` / `layoutHint` は任意（将来の演出用）

### 2.4 ドキュメント → スライド変換ルール
**優先順位**
1) `section.title` をスライド見出しに使う  
2) `doc_blocks` を種類ごとにスライド化  
3) 余力があれば「まとめ/次のアクション」のスライドを追加  

**ブロック別の基本変換**
- `text`: 1ブロック=1スライド。長文は2〜3文に分割して `bullets` へ
- `list`: 各 `items[]` を `bullets` に並べる
- `code`: `highlightBox` に短いコマンド、`bullets` に意図/効果を要約
- `callout`: `bullets` 1〜2行で要点化、`accentIcon` で意味を示す
- `table`: 重要行を2〜4件に圧縮して `bullets` 化
- `image`: `layoutHint="visual-first"`、`imagePrompt` は `caption/alt` を短文化

**演出用フィールドの制約**
- `layoutHint`: `text-only` / `visual-first` / `wide` / `two-column` を推奨
- `visualStyle`: `tech`, `cyan`, `neon`, `warm`, `sunset`, `creative`, `nature`, `green` を推奨
- `motionCue`: `fade-in` / `slide-up` / `slide-left` / `pop` を推奨
- `accentIcon`: `lightbulb` / `target` / `key` / `palette` から選ぶ

**長さの目安**
- `title`: 40文字以内
- `bullets`: 2〜5項目、各80文字以内
- `speechScript`: 1スライドあたり15〜35秒程度（目安 50〜150 文字 / 日本語）

## 3. TTS生成（Kokoro-82M ONNX）

### 3.1 エンジン選定

| 項目 | 仕様 |
|------|------|
| モデル | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) |
| ランタイム | [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)（ONNX Runtime） |
| 配置 | `risepath-vm` 上の TTS サイドカー（HTTP API）または Express からの直接呼び出し |
| 出力 | ネイティブ WAV（24 kHz）→ Web 配信用に MP3 へトランスコード可 |
| 廃止対象 | `scripts/gemini_tts_node.js`（Gemini Native TTS）、レガシー Python gTTS |

**採用理由**
- ローカル推論で API コスト・レート制限を回避できる
- 日本語ボイス（`jf_*` / `jm_*`）が用意されている
- 既存 AI パイプライン（STT: Faster Whisper / LLM: DeepSeek / **TTS: Kokoro ONNX**）と統一できる

### 3.2 ランタイム API（Rise Path TTS サイドカー）

[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) は Python ライブラリであり、HTTP サーバーは含まない。
Rise Path では **kokoro-onnx をラップしたサイドカー**（`risepath-vm` 上）が次の契約を提供する（実装は Issue #3）。

```
POST /tts/synthesize
Content-Type: application/json

{
  "text": "読み上げテキスト",
  "voice_id": "jf_alpha",
  "lang_code": "j",
  "speed": 1.0,
  "output_format": "mp3"
}

→ 200 OK（サイドカー内部レスポンス）
{
  "audio_base64": "...",
  "duration_seconds": 18.4,
  "content_type": "audio/mpeg",
  "cached": false,
  "engine": "kokoro-82m-onnx"
}
```

Express / MCP は上記を受け取り `public/audio/cache/` に保存し、クライアントへ `audio_url` を返す。

環境変数（`.env.example` 参照）:

```env
KOKORO_TTS_URL=http://127.0.0.1:8880
KOKORO_TTS_DEFAULT_VOICE_JA=jf_alpha
KOKORO_TTS_DEFAULT_VOICE_EN=af_bella
```

MCP ツール `request-tts` および `POST /api/generate-audio` は、このサイドカー API を呼び出す。
全レイヤーで出力形式フィールド名は **`output_format`** に統一する（`format` は使用しない）。

#### 3.2.1 ユーザー preference オーバーレイ（Phase 17-0）

`tools/core/kokoroTts.js` の `applyTtsRequestOptions` が、リクエスト引数と `user_profiles.preferences.tts` をマージする。

| 経路 | ユーザー解決 | preference 適用 |
|------|-------------|----------------|
| `POST /api/v2/tts/synthesize` | `optionalAuth` → `req.userId`（無効 JWT は匿名） | 認証時のみ |
| MCP `request-tts` | SSE セッション / `RISE_PATH_ACTIVE_SESSION_KEY` | `voice_id` 省略時は **セッション必須**（fail-closed） |

**優先順位:** 明示引数（`voice_id`, `speed` 等）> 保存済み `preferences.tts` > 環境変数デフォルト（`jf_alpha` / `af_bella`）。

**`language` → `lang_code` 対応**

| `language` | `lang_code` | 備考 |
|------------|-------------|------|
| `ja` | `j` | 日本語（既定） |
| `en` | `a` | アメリカ英語（既定） |
| `en` | `b` | イギリス英語（明示指定時） |

### 3.3 ボイスカタログ

ボイス ID は Kokoro 公式の命名規則に従う。一覧は [VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) を正とする。

**Rise Path 推奨ボイス**

| 用途 | `voice_id` | `lang_code` | 備考 |
|------|------------|-------------|------|
| 日本語チューター（ルミナ / Rise Path 既定） | `jf_alpha` | `j` | 落ち着いた女性声。スライドナレーションのデフォルト |
| 日本語（物語・対話向け） | `jf_tebukuro` | `j` | Dialogue Block の Rise Path 役 |
| 日本語（男性ゲスト） | `jm_kumo` | `j` | Dialogue Block のゲスト役 |
| 英語チューター（既定） | `af_bella` | `a` | 高品質アメリカ英語女性 |
| 英語（代替） | `af_heart` | `a` | 汎用ナレーション |

**Issue #4（ボイス選択）** では、学習者プロファイル（Big5 / 言語設定）から上記 `voice_id` を選ぶ。Gemini 時代の `Kore` / `Puck` / `Enceladus` 等の名前は使用しない。

### 3.4 出力するTTS用情報（tts_bundle）

TTS生成の際は「スライドごとの読み上げ文」と「同期用タイムライン」を出力する。
演技指導プロンプト（Gemini 5-Element Prompting）は**廃止**し、プレーンテキスト + `voice_id` で合成する。

推奨JSON（例）:
```json
{
  "tts_bundle": {
    "engine": "kokoro-82m-onnx",
    "language": "ja",
    "lang_code": "j",
    "voice_id": "jf_alpha",
    "speed": 1.0,
    "output_format": "mp3",
    "slides": [
      {
        "slide_id": "ch1-s1",
        "tts_script": "今日は最小限の知識から始めましょう。",
        "estimated_sec": 18,
        "voice_id": "jf_alpha"
      }
    ],
    "slide_timeline_sec": [0, 18, 37, 55]
  }
}
```

- `slide_id` は `"{chapter_id}-s{index}"` を基本とする
- `tts_script` は `slides[].speechScript` に格納する（生成時にコピー）
- `estimated_sec` は文字数ベースの推定値（例: 日本語 `ceil(chars / 5)`、英語 `ceil(chars / 12)`）
- `slide_timeline_sec` は**スライド開始時刻（秒）**の配列で、必ず `0` から開始
- 実際の `duration_seconds` は合成後に上書きし、タイムラインを再計算する

### 3.5 テキスト前処理ルール

Kokoro はプロンプトベースの演技制御を持たない。品質は**テキスト整形**と**ボイス選択**で担保する。

**推奨ルール**
- `transcript` は箇条書きを自然な読み上げ文に変換する（記号や番号は読まない）
- 1スライドあたり 50〜150 文字（日本語）/ 80〜200 トークン（英語）を目安にする
- 10 文字未満の短文は前後スライドと結合する（Kokoro の短 utterance 弱点対策）
- 400 トークン超は文境界で分割し、複数 WAV を結合する（長文の rushing 対策）
- 専門語は初出時にカタカナまたは短い言い換えを添える
- `speed` は 0.8〜1.1 の範囲で調整（デフォルト `1.0`）

### 3.6 対話（マルチスピーカー）ブロック

Gemini Multi-speaker TTS の代替として、**発話行ごとに個別合成 → 無音区間を挟んで結合**する。

```json
{
  "dialogue_audio": {
    "engine": "kokoro-82m-onnx",
    "lines": [
      { "speaker": "Rise Path", "voice_id": "jf_tebukuro", "text": "準備はいい？" },
      { "speaker": "Guest", "voice_id": "jm_kumo", "text": "はい、始めましょう。" }
    ],
    "pause_ms_between_lines": 400,
    "output_format": "mp3"
  }
}
```

### 3.7 音声同期の方針
- `slide_timeline_sec` を基準にスライドを自動送りする
- 既存の `SlideViewer` は固定配列 `SLIDE_TIMINGS` を使用しているため、
  合成後の実測 `duration_seconds` から `slide_timeline_sec` を再生成して参照する
- キャッシュキー: `sha256(voice_id + lang_code + speed + normalized_text)`

### 3.8 移行メモ（Gemini TTS からの差分）

| 旧（Gemini） | 新（Kokoro） |
|-------------|-------------|
| `tts_prompt`（5-Element Prompting） | 廃止 → テキスト前処理ルール（§3.5） |
| `voice: "auto"` / `Kore` / `Enceladus` | `voice_id: "jf_alpha"` 等の Kokoro ID |
| `responseMimeType: "audio/mp3"` | ONNX 推論 → WAV → ffmpeg で MP3 |
| マルチスピーカー単一 API | 行ごと合成 + 結合（§3.6） |
| `GEMINI_API_KEY` 必須 | `KOKORO_TTS_URL`（ローカル推論） |

## 4. 現フェーズの優先順位
1. DocChapter（ドキュメントタイプ）の生成
2. Slide生成（任意）
3. **Kokoro TTS サイドカー + `request-tts` 実装**（Issue #3）
4. ボイス選択 UI（Issue #4）— 仕様: [`doc/phase17_voice_settings_ui_spec.md`](../phase17_voice_settings_ui_spec.md)
5. 音声同期（`slide_timeline_sec` 連動）

## 5. JSON Schema
- `schemas/doc_chapter.schema.json`
- `schemas/slide_set.schema.json`
- `schemas/tts_bundle.schema.json`（v0.2 — Kokoro）
  - ルートは `oneOf`: `{ "tts_bundle": ... }` または `{ "dialogue_audio": ... }`

## 6. 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-06-24 | v0.2: TTS エンジンを Kokoro-82M ONNX に変更。Gemini 5-Element Prompting 廃止 |
| 2026-06-24 | レビュー反映: `dialogue_audio` をスキーマ root に接続、`language` から `jp` 削除、`output_format` に統一、`lang_code` 必須化 |