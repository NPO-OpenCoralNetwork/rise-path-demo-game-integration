// 実際にステージで使用されているブロック一覧（ステージ別avaiableBlocksから集計）

const USED_BLOCKS = [
  // 基本アクション (全ステージ)
  'attack_basic',
  'heal_magic', 
  'wait',
  
  // 魔法関連 (ステージ3以降)
  'wave_left_hand',
  'wave_right_hand', 
  'cast_magic',
  
  // 個別魔法 (ステージ7以降)
  'cast_fire',
  'cast_ice', 
  'cast_thunder',
  'cast_water',
  
  // 防御・特殊 (特定ステージ)
  'ice_shield',
  
  // アイテム関連 (ステージ6)
  'make_antidote',
  'use_antidote',
  
  // 繰り返し (ステージ8-10)
  'repeat_2x',
  'repeat_3x',
  
  // 変数・条件 (ステージ11以降)
  'set_variable',
  'get_variable',
  'if_condition',
  
  // ステージ固有機能
  'check_mirage',      // ステージ11
  'check_hp',          // ステージ12  
  'auto_heal',         // ステージ12
  'check_underground', // ステージ13
  'wait_for_surface',  // ステージ13
  'for_loop',          // ステージ14
  'while_loop',        // ステージ14
  'break_crystal',     // ステージ14
  'combo_attack',      // ステージ14
  'detect_element',    // ステージ15
  'check_counter',     // ステージ16
  'wait_for_opening',  // ステージ16
  'timing_attack',     // ステージ16
  'define_function',   // ステージ17
  'call_function',     // ステージ17
  'attack_and_heal',   // ステージ17
  'check_health',      // ステージ17
  'craft_potion',      // ステージ18
  'use_potion',        // ステージ18
  'check_materials',   // ステージ18
  'define_recipe',     // ステージ18
  'call_recipe',       // ステージ18
  'upgrade_weapon',    // ステージ19
  'switch_weapon',     // ステージ19
  'craft_function',    // ステージ19
  'use_materials',     // ステージ19
  'debug_code',        // ステージ20
  'restore_function',  // ステージ20
  'adaptive_strategy', // ステージ20
  'master_concept',    // ステージ20
  'final_strike'       // ステージ20
];

// 未使用ブロック（削除対象）
const UNUSED_BLOCKS = [
  'attack',              // attack_basicを使用
  'cast_spell',          // 個別魔法ブロックを使用
  'heal',               // heal_magicを使用
  'wait_seconds',       // waitを使用
  'cast_healing',       // heal_magicを使用
  'cast_healing_magic', // heal_magicを使用
  'cast_fire_magic',    // cast_fireを使用
  'cast_ice_magic',     // cast_iceを使用
  'brew_antidote',      // make_antidoteを使用
  'repeat_twice',       // repeat_2xを使用
  'repeat_three_times', // repeat_3xを使用
  'evaluate_expression',
  'complex_magic_sequence',
  'if_enemy_weak',
  'change_variable',
  'counter_reset',
  'attack_real_target',
  'conditional_heal',
  'monitor_enemy_pets',
  'hp_below_threshold',
  'analyze_pattern',
  'counter_attack',
  'defensive_stance',
  'pattern_prediction',
  'if_statement',
  'compare_values',
  'check_enemy_state',
  'adaptive_attack',
  'smart_heal',
  'check_enemy_element',
  'cast_water_spell',
  'cast_fire_spell',
  'cast_thunder_spell',
  'optimal_spell',
  'element_counter',
  'check_counter_state',
  'check_enemy_stance',
  'wait_for_opportunity',
  'careful_attack',
  'defensive_wait',
  'brew_potion',
  'use_medicine',
  'change_weapon',
  'check_weapon_info',
  'gather_weapon_materials',
  'use_weapon_skill',
  'robust_attack',
  'adaptive_heal',
  'check_code_disruption',
  'backup_strategy',
  'check_robustness',
  'try_catch_block',
  'redundancy_check'
];

export { USED_BLOCKS, UNUSED_BLOCKS };
