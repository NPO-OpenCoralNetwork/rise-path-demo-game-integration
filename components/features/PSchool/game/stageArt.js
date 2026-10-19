// stageArt.js - 戦闘画面の画像（2026年版の新しい絵柄）と、その表示サイズ
//
// 画像は public/p_school/assets/v2/ にあり、scripts/assets/ の生成・変換スクリプトで作る。
// サイズと位置は画面の高さに対する割合。キャラクターは足元を地面の線にそろえて立たせる。
// テクスチャのキーはステージごとに分ける（同じキーだと、先に読んだステージの画像が残るため）。

const V2 = '/p_school/assets/v2';

/** 主人公（右向き）。height は画面の高さに対する表示の高さ。 */
export const PLAYER_ART = Object.freeze({
  key: 'player-v2',
  path: `${V2}/characters/hero.webp`,
  height: 0.42,
});

/** 地面の線（足元の y）。敵は少し奥に立たせる。 */
export const GROUND = Object.freeze({ player: 0.8, enemy: 0.76 });

/** 敵の表示幅の上限（画面の幅に対する割合）。横長の敵が主人公に重ならないようにする。 */
export const ENEMY_MAX_WIDTH = 0.42;

const enemy = (stage, height = 0.4, extra = {}) => ({
  enemy: `${V2}/enemies/stage${String(stage).padStart(2, '0')}.webp`,
  background: `${V2}/backgrounds/stage${String(stage).padStart(2, '0')}.webp`,
  enemyHeight: height,
  ...extra,
});

/**
 * ステージごとの画像。enemyHeight は敵の表示の高さ、lift は宙に浮く敵を地面から浮かせる量
 * （どちらも画面の高さに対する割合）、boss はボス戦。
 */
export const STAGE_ART = Object.freeze({
  1: enemy(1, 0.36, { lift: 0.03 }), // 森の精霊
  2: enemy(2, 0.4), // ケミカルゴリラ
  3: enemy(3, 0.42), // アイスゴーレム
  4: enemy(4, 0.32), // フレイムウルフ（横長）
  5: enemy(5, 0.36, { lift: 0.05 }), // タイムイーター
  6: enemy(6, 0.36, { lift: 0.06 }), // ポイズンモス
  7: enemy(7, 0.34), // アーマードキメラ（横長）
  8: enemy(8, 0.38), // シールドゴブリン
  9: enemy(9, 0.42, { lift: 0.03 }), // シャドウゴースト
  10: enemy(10, 0.52, { boss: true }), // ダークナイト
  11: enemy(11, 0.44, { lift: 0.02 }), // 幻影魔術師
  12: enemy(12, 0.44), // ビーストマスター
  13: enemy(13, 0.38), // 双子剣士（横長）
  14: enemy(14, 0.44), // クリスタルゴーレム
  15: enemy(15, 0.4, { lift: 0.04 }), // エレメンタルシフター
  16: enemy(16, 0.46), // ミラーナイト
  17: enemy(17, 0.36), // スケルトン軍団（横長）
  18: enemy(18, 0.46), // ペストドクター
  19: enemy(19, 0.46), // 武器の達人
  20: enemy(20, 0.54, { boss: true, lift: 0.02 }), // コードイーター
});

/** ステージの画像とテクスチャのキー。登録のないステージは null（従来の画像の推測に戻る）。 */
export function stageArt(stage) {
  const art = STAGE_ART[stage];
  if (!art) return null;
  return { ...art, enemyKey: `enemy-stage${stage}`, backgroundKey: `battleBg-stage${stage}` };
}
