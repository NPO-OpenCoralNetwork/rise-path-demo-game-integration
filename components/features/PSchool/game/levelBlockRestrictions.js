/**
 * レベル別ブロック制限システム
 * プレイヤーのレベルに応じて利用可能なブロックを制限する
 */

// レベル別で利用可能なブロック設定
const LEVEL_BLOCK_UNLOCKS = {
  1: {
    unlockedBlocks: ['attack_basic', 'wait'],
    newBlocks: ['attack_basic', 'wait']
  },
  2: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire'],
    newBlocks: ['attack_fire']
  },
  3: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water'],
    newBlocks: ['attack_water']
  },
  4: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth'],
    newBlocks: ['attack_earth']
  },
  5: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind'],
    newBlocks: ['attack_wind']
  },
  6: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic'],
    newBlocks: ['heal_basic']
  },
  7: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic'],
    newBlocks: ['shield_basic']
  },
  8: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo'],
    newBlocks: ['attack_combo']
  },
  9: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced'],
    newBlocks: ['heal_advanced']
  },
  10: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced'],
    newBlocks: ['shield_advanced']
  },
  11: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning'],
    newBlocks: ['attack_lightning']
  },
  12: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice'],
    newBlocks: ['attack_ice']
  },
  13: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'custom_function_placeholder'],
    newBlocks: ['buff_attack', 'custom_function_placeholder']
  },
  14: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'custom_function_placeholder'],
    newBlocks: ['buff_defense']
  },
  15: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'debuff_enemy', 'custom_function_placeholder'],
    newBlocks: ['debuff_enemy']
  },
  16: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'debuff_enemy', 'attack_ultimate', 'custom_function_placeholder'],
    newBlocks: ['attack_ultimate']
  },
  17: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'debuff_enemy', 'attack_ultimate', 'heal_ultimate', 'custom_function_placeholder'],
    newBlocks: ['heal_ultimate']
  },
  18: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'debuff_enemy', 'attack_ultimate', 'heal_ultimate', 'shield_ultimate', 'custom_function_placeholder'],
    newBlocks: ['shield_ultimate']
  },
  19: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'debuff_enemy', 'attack_ultimate', 'heal_ultimate', 'shield_ultimate', 'loop', 'custom_function_placeholder'],
    newBlocks: ['loop']
  },
  20: {
    unlockedBlocks: ['attack_basic', 'wait', 'attack_fire', 'attack_water', 'attack_earth', 'attack_wind', 'heal_basic', 'shield_basic', 'attack_combo', 'heal_advanced', 'shield_advanced', 'attack_lightning', 'attack_ice', 'buff_attack', 'buff_defense', 'debuff_enemy', 'attack_ultimate', 'heal_ultimate', 'shield_ultimate', 'loop', 'if_condition', 'custom_function_placeholder'],
    newBlocks: ['if_condition']
  }
};

/**
 * プレイヤーレベルに基づいてブロックをフィルタリング
 * @param {Array<string>} stageBlocks - ステージで定義されたブロック配列
 * @param {number} playerLevel - プレイヤーのレベル
 * @param {boolean} isDevelopmentMode - 開発モードかどうか
 * @returns {Array<string>} フィルタリングされたブロック配列
 */
export function filterBlocksByLevel(stageBlocks, playerLevel, isDevelopmentMode = false) {
  // 開発モードの場合、制限なし
  if (isDevelopmentMode) {
    return stageBlocks;
  }
  
  // プレイヤーレベルで利用可能なブロックを取得
  const availableBlocks = getAvailableBlocksByLevel(playerLevel);
  
  // ステージのブロックと利用可能なブロックの共通部分を返す
  return stageBlocks.filter(block => availableBlocks.includes(block));
}

/**
 * 特定レベルで利用可能なブロックを取得
 * @param {number} level - プレイヤーのレベル
 * @returns {Array} 利用可能なブロックタイプの配列
 */
export function getAvailableBlocksByLevel(level) {
  const levelConfig = LEVEL_BLOCK_UNLOCKS[level];
  if (!levelConfig) {
    // レベル設定が見つからない場合は、最大レベルのブロックを返す
    const maxLevel = Math.max(...Object.keys(LEVEL_BLOCK_UNLOCKS).map(Number));
    return LEVEL_BLOCK_UNLOCKS[maxLevel]?.unlockedBlocks || ['attack_basic', 'wait'];
  }
  return levelConfig.unlockedBlocks;
}

/**
 * 新しくアンロックされたブロックを取得
 * @param {number} level - プレイヤーのレベル
 * @returns {Array} 新しくアンロックされたブロックタイプの配列
 */
export function getNewlyUnlockedBlocks(level) {
  const levelConfig = LEVEL_BLOCK_UNLOCKS[level];
  if (!levelConfig) {
    return [];
  }
  return levelConfig.newBlocks || [];
}
