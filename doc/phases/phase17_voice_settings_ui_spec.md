# Phase 17 / Issue #4: 音声設定 UI/UX 仕様書

> 作成日: 2026-06-24  
> ステータス: レビュー反映済み・実装待ち（17-0 → 17-A → 17-B）  
> 関連: [Issue #4 Voice Selection](https://github.com/t012093/rise-path-demo-game-Integration-/issues/4)  
> TTS バックエンド: [`doc/ai-curriculum-spec/09_content_types_tts.md`](./ai-curriculum-spec/09_content_types_tts.md)（Kokoro v0.2）  
> 前提実装: Issue #3 Kokoro TTS（`tools/core/kokoroTts.js`, `POST /api/v2/tts/synthesize`）  
> 前提タスク（17-0）: `user_profiles.preferences` の GET/PUT API 拡張 — **完了**

---

## 0. 前提タスク（Phase 17-0）

DB には `user_profiles.preferences JSONB` があるが、`server/routes/user.js` は `display_name` / `avatar_url` のみ扱う。**UI 実装の前に API を拡張する。**

| 操作 | エンドポイント | 変更内容 |
|------|----------------|----------|
| 読み込み | `GET /api/v2/user/profile` | レスポンスに `preferences`（JSONB、未設定時 `{}`）を含める |
| 保存 | `PUT /api/v2/user/profile` | `preferences` を受け取り、既存 JSON と **deep-merge**（`tts` キーは部分更新可） |

```json
// PUT body 例（tts のみ更新）
{
  "preferences": {
    "tts": {
      "voice_id": "jf_alpha",
      "language": "ja",
      "lang_code": "j",
      "speed": 1.0,
      "output_format": "mp3",
      "auto_recommend": false,
      "updated_at": "2026-06-24T12:00:00.000Z"
    }
  }
}
```

- クライアントは既存の `apiPut`（`services/apiClient.ts`）を使用。**`PATCH` は新設しない。**
- バックエンド: `request-tts` / レッスン生成パイプラインが `req.userId` から `preferences.tts.voice_id` を参照する配線も 17-0 に含める（受け入れ基準 17-A #4）。

---

## 1. 背景と目的

### 1.1 背景

- TTS エンジンは Kokoro-82M ONNX に移行済み（Issue #3）。
- レッスン再生 UI（`/generated-lesson` → `GeneratedDocView`）にボイス表示・変更導線がなく、**ユーザーが声を選ぶ画面がない**。（レガシー `GeneratedLessonView` に「AI音声」バッジはあるが現行ルートでは未使用）
- プロフィール編集（`ProfileEditView`）は表示名・アバター専用。音声設定を混在させると IA が曖昧になる。
- 設定画面の統一ハブが未整備（通知・API キー・プロフィールが分散）。

### 1.2 目的

| 目的 | 説明 |
|------|------|
| **設定 UI でボイス選択** | ユーザーが明示的にナレーション声を選べる |
| **試聴必須** | 選択前に短いサンプルを聴ける（TTS は聴覚体験） |
| **診断連動** | Big5 / 学習スタイルから初期推奨（手動上書き可） |
| **永続化** | `user_profiles.preferences.tts` に保存し、生成・再生全体で参照 |

### 1.3 非目的（本フェーズではやらない）

- Kokoro 全ボイス（50+）の一覧表示
- 演技プロンプト・感情スライダー（Kokoro 非対応）
- レッスン内での本格編集 UI（v2 で検討。MVP は設定への導線のみ）
- 対話ブロックの話者マッピング UI（v2）

---

## 2. 設計原則（UI/UX）

1. **設定は設定、プロフィールはプロフィール** — 音声は Settings に集約する。
2. **リスト + ラジオ選択** — 設定画面らしいスキャンしやすさ。カードグリッドは使わない。
3. **選択即保存** — 「保存」ボタンなし。行タップで確定 + API 同期。
4. **内部 ID を隠す** — UI には `jf_alpha` 等を出さず、キャラクター名とトーン説明のみ。
5. **試聴は各行に同居** — 別画面に飛ばさない。
6. **既存ビジュアル言語を踏襲** — `NotificationsView` / `ProfileEditView` と同系統（`bg-slate-50/50`, 白カード, indigo アクセント）。

---

## 3. 情報設計（IA）

### 3.1 ルーティング

| パス | 画面 | ViewState（新規） |
|------|------|-------------------|
| `/settings` | 設定ハブ | `SETTINGS` |
| `/settings/voice` | 音声とナレーション | `SETTINGS_VOICE` |

### 3.2 ナビゲーション（入口）

| 入口 | 遷移先 | 優先度 |
|------|--------|--------|
| プロフィール（`ProfilePassport`） | `/settings` | P0 |
| サイドバー（`Layout`）フッター付近 | `/settings` | P1（MVP 後でも可） |
| レッスン再生中のボイスバッジ（`GeneratedDocView` スライド欄） | `/settings/voice`（直接） | P0 |
| 診断結果画面のバナー | `/settings/voice` | P2 |

### 3.3 設定ハブのセクション構成

```
設定 (/settings)
├── 学習
│   ├── 音声とナレーション → /settings/voice
│   └── 表示言語（既存 LanguageContext へのリンク、読み取りのみでも可）
├── アカウント
│   ├── プロフィール編集 → /profile/edit
│   └── 通知 → /notifications（既存 NotificationsView へ）
└── 詳細
    ├── APIキー（既存 ProfilePassport 裏面の機能を移管検討）
    └── プライバシー（プレースホルダー、Phase 16-7 と統合予定）
```

---

## 4. 画面仕様

### 4.0 画面ワイヤーフレーム（全体）

#### 設定ハブ `/settings`

```
┌─────────────────────────────────────────────────────────┐
│  ← 戻る                                                  │
│                                                          │
│  設定                                                    │
│  アカウントと学習体験をカスタマイズ                        │
│                                                          │
│  学習                                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🎧  音声とナレーション                        ›   │   │
│  │     ルミナ                                       │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🌐  表示言語                                  ›   │   │
│  │     日本語                                       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  アカウント                                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 👤  プロフィール編集                          ›   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🔔  通知                                      ›   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  詳細                                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🔑  APIキー                                   ›   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🛡  プライバシー                              ›   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### 音声設定 `/settings/voice`

```
┌─────────────────────────────────────────────────────────┐
│  ← 設定                                                  │
│                                                          │
│  音声とナレーション                                       │
│  レッスンの読み上げに使う声を選びます                      │
│                                                          │
│  （おすすめバナー — Phase 17-B のみ）                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ◉ ルミナ                            [▶ 試聴]     │   │  ← 選択中
│  │   落ち着いたガイド                                │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ○ 物語の声                          [▶ 試聴]     │   │
│  │   対話・ストーリー向け                            │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ○ ゲスト                            [▶ 試聴]     │   │
│  │   会話の相手役                                    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  （詳細設定 — Phase 17-B のみ）                           │
│                                                          │
│  ┌────────────────────────────────────────┐             │
│  │ ✓ 保存しました                          │  ← toast   │
│  └────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

> トーストは `ProfileEditView` と同様、画面下部固定ではなくヘッダー直下または `fixed bottom-6` で 2 秒表示。

---

### 4.1 設定ハブ（`SettingsView`）

**レイアウト**

- コンテナ: `min-h-screen bg-slate-50/50 px-6 pt-12 pb-20`
- 最大幅: `max-w-2xl mx-auto`
- 戻る: `navigate(-1)` を優先。遷移元がない場合は `/profile`（プロフィールから来た想定）

**Phase 17-A で実装する行**

| 行 | 17-A | 備考 |
|----|------|------|
| 音声とナレーション | ✓ | `/settings/voice` へ |
| プロフィール編集 | ✓ | `/profile/edit` へ |
| 通知 | ✓ | `/notifications` へ |
| 表示言語 | プレースホルダー | disabled + 「準備中」— `LanguageContext` 連動は 17-B |
| APIキー | プレースホルダー | disabled — 移管は 17-C |
| プライバシー | プレースホルダー | disabled — Phase 16-7 と統合予定 |

**ヘッダー**

| 要素 | jp | en |
|------|----|----|
| タイトル | 設定 | Settings |
| サブタイトル | アカウントと学習体験をカスタマイズ | Customize your account and learning experience |

**セクション行コンポーネント（`SettingsRow`）**

```
┌──────────────────────────────────────────────┐
│ [icon]  ラベル                          ›   │
│         サブテキスト（現在値）                 │
└──────────────────────────────────────────────┘
```

- ホバー: `hover:bg-slate-50`
- 枠: `border border-slate-100 rounded-2xl bg-white`
- セクション見出し: `text-xs font-bold uppercase tracking-wider text-slate-500`

**「音声とナレーション」行のサブテキスト**

- 現在選択中の表示名（例: `ルミナ` / `Lumina`）
- 未設定時: `ルミナ（既定）`

---

### 4.2 音声設定（`SettingsVoiceView`）

**レイアウト** — 設定ハブと同じトークン。

**ヘッダー**

| 要素 | jp | en |
|------|----|----|
| 戻る | 設定 | Settings |
| タイトル | 音声とナレーション | Voice & Narration |
| 説明 | レッスンの読み上げに使う声を選びます | Choose the voice for lesson narration |

#### 4.2.1 おすすめバナー（条件付き表示）— **Phase 17-B**

**表示条件**

- `auto_recommend === true` かつ診断プロファイルあり → 推奨声を表示
- 診断なし → 「診断を受けるとおすすめの声を提案します」+ CTA

```
┌─ おすすめ ─────────────────────────────────┐
│ ✨ 診断に合う声: ルミナ                      │
│    落ち着いたガイド向き                       │
│    [診断結果を見る]                           │
└────────────────────────────────────────────┘
```

- 背景: `bg-indigo-50 border border-indigo-100 rounded-2xl`
- 診断未実施 CTA → `/profile/diagnosis` または診断フロー

#### 4.2.2 ナレーター選択リスト（コア UI）

**リスト形式（ラジオ）** — 1画面に3項目（MVP）。

| # | 表示名 (jp) | 表示名 (en) | `voice_id` | トーン (jp) |
|---|-------------|-------------|------------|-------------|
| 1 | ルミナ | Lumina | `jf_alpha` | 落ち着いたガイド |
| 2 | 物語の声 | Storyteller | `jf_tebukuro` | 対話・ストーリー向け |
| 3 | ゲスト | Guest | `jm_kumo` | 会話の相手役 |

**1行の構造（`VoiceOptionRow`）**

```
┌────────────────────────────────────────────────┐
│ ( ) ルミナ                          [▶ 試聴]   │
│     落ち着いたガイド                             │
└────────────────────────────────────────────────┘
```

| 状態 | スタイル |
|------|----------|
| 未選択 | `border-slate-100` |
| 選択中 | `border-indigo-500 ring-2 ring-indigo-100` + 左に `◉` |
| 試聴中 | 試聴ボタンがスピナー、`aria-busy=true` |
| 無効（TTS 503） | 行全体 `opacity-50`, 試聴・選択 disabled |

**インタラクション**

| 操作 | 挙動 |
|------|------|
| 行タップ（試聴ボタン以外） | 即選択 → `PUT` 保存 → トースト「保存しました」 |
| 試聴タップ | `POST /api/v2/tts/synthesize`（`voiceCatalog` の `previewText`）→ `audio_url` を `new Audio()` で再生 |
| 試聴中に他行試聴 | 前の再生を停止して新規再生 |
| 試聴中に行選択 | 選択を優先。再生は継続してもよい |

**試聴サンプル文（`voiceCatalog.previewText` — 声ごとに定義）**

| `voice_id` | jp | en |
|------------|----|----|
| `jf_alpha` | こんにちは。ルミナです。一緒に学びましょう。 | Hello. I'm Lumina. Let's learn together. |
| `jf_tebukuro` | 物語の声です。対話形式で進めましょう。 | I'm the storyteller voice. Let's explore together. |
| `jm_kumo` | ゲストの声です。一緒に考えていきましょう。 | I'm the guest voice. Let's think this through. |

#### 4.2.3 詳細設定（折りたたみ）— **Phase 17-B**

17-A では **セクション自体を非表示**。17-B で追加。

デフォルト: **閉じた状態**（`詳細設定 ▼`）。

| 項目 | コントロール | 範囲 | 既定 |
|------|-------------|------|------|
| 読み上げ速度 | スライダー | 0.8 – 1.1（UI表示）。内部は 0.5–2.0 を API に渡せるがラベルは推奨域のみ | 1.0 |
| 診断から自動で選ぶ | トグル | on/off | on（新規ユーザー） |

- 速度変更: デバウンス 300ms で自動保存
- 自動おすすめ ON: 診断更新時に推奨 `voice_id` を再計算（手動選択済みなら上書きしない — 下記ルール）

**自動おすすめと手動選択の優先**

```
手動で声を選んだ時点で auto_recommend = false にする
ユーザーがトグルで再度 ON にした時のみ、診断ベースで voice_id を再適用
```

---

### 4.3 レッスン再生 UI との連携（MVP）

現行ルート `/generated-lesson/:courseId` は `GeneratedLessonViewWrapper` → **`GeneratedDocView`** を使用する。スライドモードのコントロールバー（Play / Mute ボタン付近）に **ボイスバッジ** を追加する。

| 状態 | 表示 | タップ |
|------|------|--------|
| 通常 | 現在の表示名（例: `ルミナ`） | `/settings/voice` へ遷移 |
| TTS 未設定 / 503 | `AI音声` + 警告アイコン（`AlertTriangle`） | 同上 |
| 音声読み込み中 | スライド TTS 準備中はバッジ非表示または `準備中` | 無効（`pointer-events-none`） |

**配置・スタイル（MVP）**

- 位置: `GeneratedDocView` スライドヘッダー右側、Play / Mute の左または間
- `button type="button"`、`text-xs font-bold px-3 py-1.5 rounded-lg border`
- 通常: `border-indigo-200 text-indigo-600 bg-indigo-50`
- ホバー: `hover:bg-indigo-100`
- `title` / `aria-label`: 「音声設定を変更」
- `useNavigate('/settings/voice')` または `onNavigate(ViewState.SETTINGS_VOICE)`

> レガシー `GeneratedLessonView` のバッジ改修は **対象外**（現行フローで未到達）。

レッスン内でボイスを切り替えるシートは **v2**。MVP は設定へ誘導のみ。

### 4.4 プロフィールからの入口（`ProfilePassport`）

パスポート**表面**フッターに設定ショートカットを追加（P0）。裏面のアカウントアクションにも重複配置可。

| 配置 | ラベル (jp/en) | 遷移 |
|------|----------------|------|
| 表面: Flip ボタン下 | 設定 / Settings | `/settings` |
| 裏面: Account Actions 先頭 | 設定 / Settings | `/settings` |

裏面の既存行（プロフィール編集・通知等）は維持。設定ハブ経由で各機能へ再編成する IA と整合させる。

---

## 5. 診断連動ロジック（表示層）— **Phase 17-B**

UI 専用の推奨マッピング（`data/tts/voiceRecommendations.ts`）。バックエンド Stylist と同期可能な決定論ルール。

**データソース優先順位**

1. `localStorage` キー `personalized.profile.v1`（`assessmentConstants.STORAGE_KEY` — 診断 UI が書き込む）
2. API `learner_profiles`（ログイン時・利用可能なら上書き参照）
3. どちらもなし → 既定 `jf_alpha`

**決定論ルール（Big5 スコア 0–100）**

| 条件 | 推奨 `voice_id` | 表示名 |
|------|-----------------|--------|
| データなし | `jf_alpha` | ルミナ |
| `agreeableness ≥ 65` または `aiAdvice.tone` に gentle 系 | `jf_alpha` | ルミナ |
| `openness ≥ 65` または `extraversion ≥ 65` | `jf_tebukuro` | 物語の声 |
| 上記複数該当 | `jf_tebukuro` を優先（外向・開放を物語声に寄せる） |
| 対話形式コンテンツ比率（将来） | `jf_tebukuro` | 物語の声 |

---

## 6. データモデル

### 6.1 永続化（`user_profiles.preferences`）

```json
{
  "tts": {
    "voice_id": "jf_alpha",
    "language": "ja",
    "lang_code": "j",
    "speed": 1.0,
    "output_format": "mp3",
    "auto_recommend": true,
    "updated_at": "2026-06-24T12:00:00.000Z"
  }
}
```

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| `voice_id` | string | ✓ | Kokoro voice ID |
| `language` | `ja` \| `en` | ✓ | UI 言語連動 |
| `lang_code` | string | ✓ | Kokoro misaki code |
| `speed` | number | | 既定 1.0 |
| `output_format` | `mp3` \| `wav` | | 既定 mp3 |
| `auto_recommend` | boolean | | 既定 true |
| `updated_at` | ISO8601 | | クライアントまたはサーバー |

### 6.2 フロントエンド カタログ（表示専用）

`data/tts/voiceCatalog.ts`:

```ts
export type VoiceCatalogEntry = {
  id: string;           // voice_id
  langCode: 'j' | 'a';
  label: { jp: string; en: string };
  description: { jp: string; en: string };
  previewText: { jp: string; en: string };
  languages: ('ja' | 'en')[];
};
```

MVP エントリ: 3件（§4.2.2 表 + §4.2.2 `previewText`）。英語 UI 時も日本語声を出すかは `languages` でフィルタ。

**UI 言語 ↔ TTS 言語マッピング**（`ttsPreferencesService`）

| `LanguageContext.language` | `preferences.tts.language` | TTS API `language` |
|----------------------------|----------------------------|---------------------|
| `jp` | `ja` | `ja` |
| `en` | `en` | `en` |

- `lang_code` は `voiceCatalogEntry.langCode` から自動設定（ユーザー入力なし）
- 保存時に `updated_at` を ISO8601 で付与

### 6.3 ゲスト / ローカルフォールバック

- API 未接続: `localStorage` キー `rp_tts_preferences` にミラー
- ログイン後 hydration: **サーバー `preferences.tts` を正**とする
  - サーバーに `tts` なし → ローカル `rp_tts_preferences` を初期シードして PUT
  - サーバーとローカル両方あり → `updated_at` が新しい方を採用し、古い方を上書き

---

## 7. API 連携

| 操作 | エンドポイント | 備考 |
|------|----------------|------|
| 設定読み込み | `GET /api/v2/user/profile` | レスポンス `profile.preferences.tts`（§0 で API 拡張後） |
| 設定保存 | `PUT /api/v2/user/profile` | `{ preferences: { tts: {...} } }` — `apiPut` 使用、deep-merge |
| 試聴 | `POST /api/v2/tts/synthesize` | `previewText` + `voice_id` + `lang_code` + `language` |
| レッスン生成 | MCP `request-tts` / バッチ音声 | `req.userId` → DB `preferences.tts.voice_id`（§0 配線） |

**試聴レスポンスの再生**

```ts
const { audio_url } = await response.json();
const audio = new Audio(audio_url);
await audio.play();
```

> base64 変換は不要（`services/geminiService.ts` の `generateAudioContent` はレガシー互換用）。

**エラー表示**

| 状況 | UI |
|------|-----|
| `tts_unavailable` (503) | ページ上部に `bg-amber-50` バナー「音声サービスに接続できません」 |
| 保存失敗 | インライン toast + 選択をロールバック |
| 試聴失敗 | 行下に `text-sm text-red-600` で1行メッセージ |

---

## 8. コンポーネント構成

```
components/features/settings/
  SettingsView.tsx           # 設定ハブ
  SettingsVoiceView.tsx      # 音声設定
  SettingsSection.tsx        # セクション見出し + 子
  SettingsRow.tsx            # ナビゲーション行
  VoiceOptionRow.tsx         # ラジオ + 試聴
  VoiceRecommendBanner.tsx   # おすすめバナー
  VoiceAdvancedPanel.tsx     # 折りたたみ詳細

data/tts/
  voiceCatalog.ts            # 表示カタログ
  voiceRecommendations.ts    # 診断 → voice_id

services/
  ttsPreferencesService.ts   # load/save/merge preferences.tts
```

**既存との関係**

| 既存 | 変更 |
|------|------|
| `ProfileEditView` | 音声項目は追加しない |
| `ProfilePassport` | 「設定」行を追加 → `/settings` |
| `GeneratedDocView` | スライド欄にボイスバッジ追加 → `/settings/voice` |
| `GeneratedLessonViewWrapper` | `GeneratedDocView` へ `onNavigate` または navigate を渡す（必要時） |
| `types.ts` | `ViewState.SETTINGS`, `SETTINGS_VOICE` 追加 |

---

## 9. ビジュアル仕様（トークン）

| トークン | 値 | 参照 |
|----------|-----|------|
| ページ背景 | `bg-slate-50/50` | `NotificationsView` |
| カード | `bg-white rounded-2xl border border-slate-100 shadow-sm` | `ProfileEditView` |
| プライマリ | `indigo-600` / `indigo-50` | 既存ダッシュボード |
| タイトル | `text-3xl font-bold text-slate-900` | 既存 |
| 行ラベル | `font-medium text-slate-700` | — |
| 行サブ | `text-sm text-slate-500` | — |
| 選択リング | `ring-2 ring-indigo-100 border-indigo-500` | アバター選択と同系 |

**アイコン（lucide-react）**

| 用途 | アイコン |
|------|----------|
| 設定ハブ | `Settings` |
| 音声 | `Headphones` または `Volume2` |
| 試聴 | `Play` / 再生中 `Loader2` animate-spin |
| おすすめ | `Sparkles` |

---

## 10. アクセシビリティ

| 要件 | 実装 |
|------|------|
| ラジオグループ | `role="radiogroup"` + 各 `role="radio"` `aria-checked` |
| 試聴ボタン | `aria-label="ルミナの声を試聴"` |
| キーボード | 行: Enter/Space で選択、試聴ボタンは独立フォーカス |
| 色だけに依存しない | 選択はリング + ラジオマーク両方 |
| 動きの抑制 | `prefers-reduced-motion` でスピナーのみ、機能は維持 |

---

## 11. 国際化（i18n）

- `useLanguage()` の `language`（`jp` | `en`）を使用 — **TTS / DB には §6.2 のマッピングで `ja` / `en` に変換**
- 各画面 `copy` オブジェクトパターン（`NotificationsView` 準拠）
- カタログの `label` / `description` / `previewText` は `voiceCatalog.ts` で二言語保持
- `language === 'en'` 時は英語声カタログを追加（17-B）。17-A は日本語3声のみ表示し、英語 UI でもラベルだけ en 表示

---

## 12. ユーザーフロー

```mermaid
flowchart TD
    A[プロフィール or サイドバー] --> B[/settings 設定ハブ]
    B --> C[/settings/voice 音声設定]
    C --> D{行をタップ}
    D --> E[PUT preferences.tts]
    E --> F[トースト: 保存しました]
    E --> E2[localStorage rp_tts_preferences ミラー]
    C --> G{試聴タップ}
    G --> H[POST /api/v2/tts/synthesize]
    H --> I[audio_url で再生]
    C --> J{診断バナー CTA — 17-B}
    J --> K[/profile/diagnosis]
    L[GeneratedDocView ボイスバッジ] --> C
```

---

## 13. 実装フェーズ

### Phase 17-0（前提 / P0）— 完了

- [x] `GET/PUT /api/v2/user/profile` に `preferences` JSONB 対応（deep-merge + 検証 + トランザクション）
- [x] `request-tts` / `POST /api/v2/tts/synthesize` が `preferences.tts` を参照（明示引数優先）
- [x] API ユニットテスト: preferences merge、voice_id フォールバック、合成パラメータ検証

### Phase 17-A（MVP / P0）— 完了

- [x] `SettingsView` + ルーティング `/settings`（音声・プロフィール・通知は有効、他はプレースホルダー）
- [x] `SettingsVoiceView` + `/settings/voice`（リスト + 試聴 + 即保存のみ。詳細設定・診断バナーは非表示）
- [x] `voiceCatalog.ts`（日本語3声 + 声ごと `previewText`）
- [x] `ttsPreferencesService.ts` + `apiPut` + localStorage ミラー
- [x] `VoiceOptionRow` 試聴（`audio_url` 再生）+ 即時保存
- [x] `ProfilePassport` から設定への入口
- [x] `GeneratedDocView` ボイスバッジ → 設定誘導
- [x] ユニットテスト: `ttsPreferencesService` merge、`jp`→`ja` マッピング（サーバー側 `userPreferences` / `applyTtsRequestOptions`）

### Phase 17-B（P1）

- [ ] サイドバー設定入口
- [ ] 英語声カタログ（`af_bella`, `af_heart`）
- [ ] `VoiceAdvancedPanel`（速度スライダー + `auto_recommend` トグル）
- [ ] `VoiceRecommendBanner` + `voiceRecommendations.ts` + 診断 CTA
- [ ] 設定ハブ「表示言語」行の有効化

### Phase 17-C（P2 / v2）

- [ ] レッスン内クイック切替シート
- [ ] 対話ブロック話者マッピング
- [ ] API キー設定の Settings 移管

---

## 14. 受け入れ基準（Done の定義）

### 14.1 Phase 17-0

1. `GET /user/profile` が `preferences` を返す（未設定時 `{}`）。
2. `PUT /user/profile` で `preferences.tts` の部分更新が deep-merge される。
3. 新規 TTS 生成がログインユーザーの `voice_id` を参照する（未設定時 `jf_alpha`）。

### 14.2 Phase 17-A

1. プロフィールから **設定 → 音声とナレーション** に到達できる。
2. 3つの声がリスト表示され、**タップで即保存**される（DB 接続時はリロード後も維持、未接続時は localStorage）。
3. 各声で **試聴** が動作する（Kokoro サイドカー起動時、`audio_url` 再生）。
4. `jp` / `en` のラベル切り替えが動作する。
5. TTS 503 時は選択・試聴が無効化され、説明バナーが出る。
6. a11y: ラジオグループがキーボード操作可能。
7. `GeneratedDocView` スライド欄から `/settings/voice` に遷移できる。

### 14.3 Phase 17-B

1. 診断未実施時はルミナ既定 + 診断への誘導バナーが表示される。
2. `auto_recommend` トグルと手動選択の優先ルール（§4.2.3）が動作する。
3. 速度スライダーがデバウンス保存される。

---

## 15. テスト計画

| 種別 | 対象 |
|------|------|
| ユニット | `voiceRecommendations.ts`, `ttsPreferencesService.ts` |
| コンポーネント | `VoiceOptionRow` 選択・試聴状態（React Testing Library、導入済みなら） |
| 手動 | `npm run smoke:tts` 後、設定画面から試聴 |
| E2E（任意） | Playwright: settings → voice → select → reload 確認 |

---

## 16. 実装フック（既存コードへの接続）

### 16.1 `types.ts`

```ts
// ViewState enum に追加
SETTINGS = 'SETTINGS',
SETTINGS_VOICE = 'SETTINGS_VOICE',
```

### 16.2 `App.tsx`

`getCurrentViewState()`:

```ts
if (path.startsWith('/settings/voice')) return ViewState.SETTINGS_VOICE;
if (path.startsWith('/settings')) return ViewState.SETTINGS;
```

`handleNavigate()`:

```ts
case ViewState.SETTINGS: navigate('/settings'); break;
case ViewState.SETTINGS_VOICE: navigate('/settings/voice'); break;
```

`<Routes>`:

```tsx
<Route path="/settings/voice" element={<SettingsVoiceView onNavigate={handleNavigate} />} />
<Route path="/settings" element={<SettingsView onNavigate={handleNavigate} />} />
```

> `/settings/voice` を `/settings` より**先**に登録すること（`startsWith` 競合回避）。

### 16.3 `ProfilePassport.tsx`

- 表面フッターに `onNavigate(ViewState.SETTINGS)` ボタン追加
- 裏面 Account Actions 先頭に同ボタン

### 16.4 `GeneratedDocView.tsx`

- スライドコントロールバー（`showSlideControls` ブロック内）にボイスバッジ `button` を追加
- 表示名: `ttsPreferencesService.getDisplayName()`
- クリック時: `navigate('/settings/voice')` または `onNavigate(ViewState.SETTINGS_VOICE)`
- `GeneratedLessonViewWrapper` から `navigate` / `onNavigate` を渡す（既存 props パターンに合わせる）

### 16.5 `server/routes/user.js`（17-0）

- `GET /profile`: `SELECT` に `preferences` を追加
- `PUT /profile`: `preferences` の JSONB merge（`COALESCE(preferences, '{}') || $n::jsonb` 等）

### 16.6 フィードバック（保存トースト）

`ProfileEditView` の `saved` パターンを踏襲:

```tsx
const [saved, setSaved] = useState(false);
// PUT 成功後
setSaved(true);
setTimeout(() => setSaved(false), 2000);
```

表示: `text-sm text-emerald-600 font-medium` + Check アイコン。

### 16.7 ローディング・エラー状態

| 画面 | 初回ロード | 保存中 | TTS 503 |
|------|-----------|--------|---------|
| `SettingsVoiceView` | スケルトン 3 行 | 選択行に subtle spinner | 上部 amber バナー + 全行 disabled |
| `SettingsView` | 即表示（音声行のみサブテキスト非同期） | — | 音声行サブテキスト「サービス停止中」 |

---

## 17. 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-06-24 | 初版。設定ハブ + リスト型ボイス選択 UI を Issue #4 として確定 |
| 2026-06-24 | 全体ワイヤーフレーム、ProfilePassport / GeneratedLessonView 接続、App.tsx 実装フックを追記 |
| 2026-06-24 | レビュー反映: §0 API 前提、GeneratedDocView 差し替え、PUT/deep-merge、17-A/B 受け入れ基準分割、`jp`↔`ja`、声ごと previewText |
| 2026-06-24 | 17-0 実装 + レビュー修正（検証、レート制限、MCP fail-closed、optionalAuth、エラーハンドリング） |