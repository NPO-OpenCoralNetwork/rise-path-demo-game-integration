# 📊 RisePath アセット管理 & ブラッシュアップ進行状況

本ドキュメントは、ブロックプログラミングゲーム『Code of Ruins』（P-School）で使用されるビジュアル・オーディオアセットのブラッシュアップ状況を追跡し、安全にコードに適用するためのガイドラインです。

---

## 🛠️ アセットの安全な適用ルール（ハイブリッドモデル）

ゲームプログラム内（`HomeScene.js` や `battle.js` など）では、アセットのファイルパスが直接ハードコードされています。
動作を壊さずにビジュアルを新しくするため、以下のルールを厳守してください。

1.  **既存ファイルの上書き適用（推奨）**:
    *   Figma等でアセットが完成した際、既存のファイル（例: `srime.png`）と**全く同じファイル名・同じ拡張子（小文字）**で保存してください。
    *   新しいファイルを `/public/p_school/assets/` 配下の同じ場所にコピーし、上書き保存します。
    *   **メリット**: コード（Phaser側）の書き換えが不要なため、動作が崩れるリスクがありません。
2.  **別名で追加・適用する場合**:
    *   画像比率の変更や、異なるアセットタイプとして別名にせざるを得ない場合は、アセットを新規ファイル名で配置し、Phaser側のロードコード（例: `battle.js:137` など）を慎重に変更してください。
    *   ロード名（キー名）が他のシーンで使われていないかを必ず `grep` 等で確認してください。

---

## 📊 アセットブラッシュアップ進行リスト

*   **ステータス定義**:
    *   ✅ **適用完了**: 新しいアセットが作成され、ゲーム内で正常に表示されることを確認済。
    *   🚧 **制作・ブラッシュアップ中**: デザイナーによる制作、または適用作業中。
    *   💤 **未着手 (旧アセット使用中)**: 開発初期の古い画像が現在もゲーム内で使用されている状態。
    *   🔄 **既存維持**: ブラッシュアップ不要と判断され、既存のアセットをそのまま使い続けるもの。

### ⚔️ 戦闘画像（2026年10月：全20ステージを v2 に置き換え）

戦闘画面の主人公、20ステージの敵と背景は、すべて `/p_school/assets/v2/` の WebP を使います（✅ **適用完了**）。旧ドット絵（`chemical.png`、`srime.png`、`labo.jpg` など）は戦闘では使っていません。

*   **どの画像をどの大きさで出すか**: `components/features/PSchool/game/stageArt.js` で決めます。同じファイル名・同じ形式で上書きすれば、コードを変えずに差し替えられます。
*   **置き場所**: 敵は `v2/enemies/stageNN.webp`（左向き・全身・背景透過）、背景は `v2/backgrounds/stageNN.webp`（16:9、下3分の1が地面）、主人公は `v2/characters/hero.webp`（右向き）です。
*   **作り方**（GPT Image 2.5 Flare、OpenRouter 経由。1枚約0.04〜0.07ドル）:
    1. プロンプトは `scripts/assets/pschool-assets.json` にステージごとに書きます。絵柄を合わせるため、主人公・森の精霊・ステージ1の背景を参照画像として渡します。
    2. 生成: `OPENROUTER_API_KEY=… node scripts/assets/try-image-models.mjs --plan scripts/assets/pschool-assets.json --models gptImageFlare --out <出力先>`（`--jobs stage05-enemy` のように1枚だけ作り直せます）
    3. 変換: `python3 scripts/assets/prepare-pschool-art.py <出力先>`（余白の切り詰め・縮小・WebP 化。Pillow が必要）
*   **ステージ1**: 敵（森の精霊 `serirei01.png`）と背景（`battle-seen01.jpeg`）、主人公（`main-chara01_transparent.png`）は、既存の新しい絵柄を変換して使っています。
*   **動き**: 待機の呼吸・攻撃の踏み込み・被弾ののけぞり・詠唱・倒れる・勝利のジャンプは `characterMotion.js` で JS（tween）だけで動かしています。画像を差し替えても動きはそのまま使えます。

### 🏞️ 背景アセット（戦闘以外）
| 画面 | アセットID | 現行ファイルパス | 新ビジュアル（Figma/Miro個別URL） | ステータス | 担当 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ホーム | `home_bg` | `/p_school/assets/home-background.jpg` | [Figma#Home_BG](https://figma.com/...) | 💤 **未着手 (旧アセット使用中)** | - | メインホーム背景 |
| ストーリー | `story_bg` | `/p_school/assets/bg1.png` | - | 🔄 **既存維持** | - | 中身は `forest_stage1.jpg` と同じ JPEG |

### 👾 キャラクター（戦闘以外）
| キャラ名 | アセットID | 現行ファイルパス | 新ビジュアル（Figma/Miro個別URL） | ステータス | 担当 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| プレイヤー（ストーリー） | `character1` | `/p_school/assets/main-chara.png` | [Figma#Player_Chara](https://figma.com/...) | 🚧 **制作中** | 山田 | 立ち絵イラストの清書段階 |
| 森の精霊（ストーリー） | `character2` | `/p_school/assets/serirei01.png` | [Miro#Enemy_Seirei](https://miro.com/...) | ✅ **適用完了** | 鈴木 | 戦闘ではステージ1の敵として v2 に変換して使用 |

### 🎵 音楽・効果音 (Audio)
| 音声種別 | アセットID | 現行ファイルパス | 新音源（GoogleDrive等URL） | ステータス | 担当 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ホームBGM | `homeTheme` | `/p_school/assets/audio/tokinootozure.mp3` | - | 🔄 **既存維持** | - | 音質改善のみ必要に応じて |
| バトルBGM | `battleTheme`| `/p_school/assets/audio/battle_bgm_01.mp3` | - | 🔄 **既存維持** | - | 既存で問題なし |
