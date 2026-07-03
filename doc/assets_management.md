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

### 🏞️ 背景アセット (Backgrounds)
| ステージ | アセットID | 現行ファイルパス | 新ビジュアル（Figma/Miro個別URL） | ステータス | 担当 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ステージ1 | `bg1` | `/p_school/assets/forest_stage1.jpg` | [Figma#Stage1_BG](https://figma.com/...) | ✅ **適用完了** | 鈴木 | 新アセットに更新済 |
| ステージ2 | `bg2` | `/p_school/assets/labo.jpg` | [Figma#Stage2_BG](https://figma.com/...) | ✅ **適用完了** | 鈴木 | 新アセットに更新済 |
| ステージ3 | `bg3` | `/p_school/assets/snow.jpg` | [Figma#Stage3_BG](https://figma.com/...) | 💤 **未着手 (旧アセット使用中)** | - | 順次着手予定 |
| その他 | `bg_main` | `/p_school/assets/home-background.jpg` | [Figma#Home_BG](https://figma.com/...) | 💤 **未着手 (旧アセット使用中)** | - | メインホーム背景 |

### 👾 モンスター・キャラクター (Sprites)
| キャラ名 | アセットID | 現行ファイルパス | 新ビジュアル（Figma/Miro個別URL） | ステータス | 担当 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| プレイヤー | `player` | `/p_school/assets/main-chara.png` | [Figma#Player_Chara](https://figma.com/...) | 🚧 **制作中** | 山田 | 立ち絵イラストの清書段階 |
| 森の精霊 | `seirei` | `/p_school/assets/seirei01_transparent.png` | [Miro#Enemy_Seirei](https://miro.com/...) | ✅ **適用完了** | 鈴木 | ステージ1の敵、透過済を正式適用 |
| ポイズンモス | `poison` | `/p_school/assets/chemical.png` | [Miro#Enemy_Poison](https://miro.com/...) | ✅ **適用完了** | 鈴木 | ステージ2の敵、更新済 |
| スライム | `slime` | `/p_school/assets/srime.png` | [Miro#Enemy_Slime](https://miro.com/...) | 💤 **未着手 (旧アセット使用中)** | - | 各ステージで使用中 |
| 双子剣士 | `knight` | `/p_school/assets/mirrorknight.png` | [Miro#Enemy_Knight](https://miro.com/...) | 💤 **未着手 (旧アセット使用中)** | - | ステージ13で使用 |

### 🎵 音楽・効果音 (Audio)
| 音声種別 | アセットID | 現行ファイルパス | 新音源（GoogleDrive等URL） | ステータス | 担当 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ホームBGM | `homeTheme` | `/p_school/assets/audio/tokinootozure.mp3` | - | 🔄 **既存維持** | - | 音質改善のみ必要に応じて |
| バトルBGM | `battleTheme`| `/p_school/assets/audio/battle_bgm_01.mp3` | - | 🔄 **既存維持** | - | 既存で問題なし |
