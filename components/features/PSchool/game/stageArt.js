// stageArt.js - 戦闘画面の画像と、キャラクターの立ち位置
//
// ステージ1は、オーナーが手で調整した元の配置と画像をそのまま使う（ORIGINAL_LAYOUT）。
// ステージ2〜20は2026年版の新しい画像（public/p_school/assets/v2/、scripts/assets/ のスクリプトで作る）。
// 新しい画像は背景ごとに地面の高さを決め、キャラクターの足元をそこにそろえて立たせる。
// テクスチャのキーはステージごとに分ける（同じキーだと、先に読んだステージの画像が残るため）。

const V2 = '/p_school/assets/v2';

/**
 * 元の配置（ステージ1と、STAGE_ART に登録のないステージ）。大きさはピクセル、x と y は
 * キャラクターの中心の位置（画面に対する割合）。背景は画面いっぱいに引き伸ばし、キャラクターは少し透ける。
 */
export const ORIGINAL_LAYOUT = Object.freeze({
  player: Object.freeze({ key: 'player', path: '/p_school/assets/main-chara01_transparent.png', height: 350, x: 0.25, y: 0.67 }),
  enemy: Object.freeze({ width: 133, x: 0.75, y: 0.6 }),
  alpha: 0.9,
});

/** 新しい画像のステージの主人公（右向き）。height は画面の高さに対する表示の高さ、x は中心の位置。 */
export const PLAYER_ART = Object.freeze({ key: 'player-v2', path: `${V2}/characters/hero.webp`, height: 0.31, x: 0.25 });

/** 新しい画像の足元の位置（画像の高さに対する割合）。画像の下には 2% の余白がある。 */
export const FEET = 0.97;

/** 敵の表示幅の上限（画面の幅に対する割合）。横長の敵が主人公に近づきすぎないようにする。 */
export const ENEMY_MAX_WIDTH = 0.36;

const DEFAULTS = Object.freeze({ ground: [0.8, 0.75], enemyX: 0.74, hover: 0, focus: [0.5, 0.8] });

const art = (stage, enemyHeight, extra = {}) => ({
  ...DEFAULTS,
  enemy: `${V2}/enemies/stage${String(stage).padStart(2, '0')}.webp`,
  background: `${V2}/backgrounds/stage${String(stage).padStart(2, '0')}.webp`,
  enemyHeight,
  ...extra,
});

/**
 * ステージごとの画像と立ち位置。
 * - enemyHeight: 敵の表示の高さ（画面の高さに対する割合）
 * - ground: 足元の高さ [主人公, 敵]（背景の高さに対する割合）。敵は少し奥に立たせる
 * - enemyX: 敵の中心（画面の幅に対する割合）
 * - hover: 宙に浮く敵の、地面からの高さ（画面の高さに対する割合）。影は地面に残る
 * - focus: 背景の縦横比が画面と合わないとき、どこを残すか [横, 縦]（0〜1）
 * - boss: ボス戦（呼吸をゆっくりにする）
 */
export const STAGE_ART = Object.freeze({
  2: art(2, 0.38, { ground: [0.8, 0.74] }), // ケミカルゴリラ（研究所の床）
  3: art(3, 0.4, { ground: [0.8, 0.76] }), // アイスゴーレム（雪原）
  4: art(4, 0.29, { ground: [0.8, 0.775] }), // フレイムウルフ（横長。溶岩の上の岩棚。溶岩に埋もれないよう大きめ）
  5: art(5, 0.3, { ground: [0.785, 0.745], hover: 0.06 }), // タイムイーター（浮遊。空中庭園の細い石畳）
  6: art(6, 0.3, { ground: [0.8, 0.77], hover: 0.08 }), // ポイズンモス（浮遊。沼のほとりの小道）
  7: art(7, 0.27, { ground: [0.8, 0.75] }), // アーマードキメラ（横長。鋳造所の鉄板の床）
  8: art(8, 0.3, { ground: [0.8, 0.75] }), // シールドゴブリン（砦の前の土の道）
  9: art(9, 0.36, { ground: [0.8, 0.77], hover: 0.03 }), // シャドウゴースト（浮遊。屋敷の前の石畳）
  10: art(10, 0.46, { ground: [0.8, 0.75], boss: true }), // ダークナイト（ボス。玉座の間）
  11: art(11, 0.34, { ground: [0.8, 0.76] }), // 幻影魔術師（森の草地）
  12: art(12, 0.34, { ground: [0.8, 0.75] }), // ビーストマスター（森の土の道）
  13: art(13, 0.28, { ground: [0.8, 0.75] }), // 双子剣士（横長。武器庫の石の床）
  14: art(14, 0.4, { ground: [0.8, 0.75] }), // クリスタルゴーレム（水晶の洞窟）
  15: art(15, 0.36, { ground: [0.8, 0.76], hover: 0.03, enemyX: 0.68, focus: [0.3, 0.8] }), // エレメンタルシフター（浮遊。同じ色の光の柱に重ならないよう、氷と雷の柱の間に）
  16: art(16, 0.34, { ground: [0.8, 0.75] }), // ミラーナイト（水晶の湖のほとり）
  17: art(17, 0.24, { ground: [0.8, 0.77] }), // スケルトン軍団（横長。墓地の土の道）
  18: art(18, 0.35, { ground: [0.8, 0.75] }), // ペストドクター（錬金術の店の板の床）
  19: art(19, 0.35, { ground: [0.8, 0.75] }), // 武器の達人（訓練場）
  20: art(20, 0.46, { ground: [0.8, 0.77], boss: true }), // コードイーター（ボス。電脳空間の床）
});

/** ステージの画像・立ち位置とテクスチャのキー。登録のないステージは null（元の配置になる）。 */
export function stageArt(stage) {
  const entry = STAGE_ART[stage];
  if (!entry) return null;
  return { ...entry, enemyKey: `enemy-stage${stage}`, backgroundKey: `battleBg-stage${stage}` };
}
