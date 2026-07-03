// ====================================================================================
// ゲームエンジン - メインエクスキューター
// ====================================================================================
// 
// このファイルには、全20ステージで使用される関数群が含まれています。
// 詳細なステージ別使用マップは以下を参照してください：
// docs/engine-stage-mapping.md
//
// 主要な関数：
// - runGameWithCommands(): メイン実行関数（全ステージ）
// - executeGameAction(): 個別アクション実行（全ステージ）
// - getPotionDisplayName(): ポーション名表示（ステージ18）
//
// ====================================================================================

import { delay } from "./utils";
import { BattleScene } from "./BattleScene";
import { BattleScene2 } from "./BattleScene2";
import { BattleScene3 } from "./BattleScene3";
import { BattleScene4 } from "./BattleScene4";
import { BattleScene5 } from "./BattleScene5";
import { BattleScene6 } from "./BattleScene6";
import { BattleScene7 } from "./BattleScene7";
import { BattleScene8 } from "./BattleScene8";
import { BattleScene9 } from "./BattleScene9";
import { BattleScene10 } from "./BattleScene10";
import { BattleScene11 } from "./BattleScene11";
import { BattleScene12 } from "./BattleScene12";
import { BattleScene13 } from "./BattleScene13";
import { BattleScene14 } from "./BattleScene14";
import { BattleScene15 } from "./BattleScene15";
import { BattleScene16 } from "./BattleScene16";
import { BattleScene17 } from "./BattleScene17";
import { BattleScene18 } from "./BattleScene18";
import { BattleScene19 } from "./BattleScene19";
import { BattleScene20 } from "./BattleScene20";
import { HomeScene } from "./HomeScene";
import { MapSelectionScene } from "./MapSelectionScene";
import { ShopScene } from "./ShopScene";
import { LibraryScene } from "./LibraryScene";

// ====================================================================================
// ステージ別機能マップ
// ====================================================================================
/*
ステージ1 (BattleScene): 基本攻撃
- 使用ブロック: attack_basic, wait
- 使用関数: executeGameAction (attack_basic, wait)

ステージ2 (BattleScene2): 回復魔法
- 使用ブロック: attack_basic, heal_magic, wait
- 使用関数: executeGameAction (attack_basic, heal_magic, wait)

ステージ3 (BattleScene3): 魔法詠唱
- 使用ブロック: attack_basic, wave_left_hand, wave_right_hand, cast_magic, wait
- 使用関数: executeGameAction

ステージ4 (BattleScene4): 氷の盾
- 使用ブロック: attack_basic, wave_left_hand, wave_right_hand, cast_magic, ice_shield, wait
- 使用関数: executeGameAction

ステージ5 (BattleScene5): 複合魔法
- 使用ブロック: attack_basic, heal_magic, wave_left_hand, wave_right_hand, cast_magic, wait
- 使用関数: executeGameAction

ステージ6 (BattleScene6): 解毒剤
- 使用ブロック: attack_basic, heal_magic, make_antidote, use_antidote, wave_left_hand, wave_right_hand, cast_magic, wait
- 使用関数: executeGameAction

ステージ7 (BattleScene7): 雷魔法
- 使用ブロック: attack_basic, heal_magic, cast_fire, cast_ice, cast_thunder, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ8 (BattleScene8): 繰り返し魔法 (2x)
- 使用ブロック: attack_basic, heal_magic, cast_fire, cast_ice, repeat_2x, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ9 (BattleScene9): 繰り返し魔法 (3x)
- 使用ブロック: attack_basic, heal_magic, cast_fire, cast_ice, cast_thunder, repeat_3x, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ10 (BattleScene10): 強化繰り返し
- 使用ブロック: attack_basic, heal_magic, cast_fire, cast_ice, cast_thunder, repeat_3x, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ11 (BattleScene11): 変数と幻影
- 使用ブロック: attack_basic, heal_magic, cast_magic, set_variable, get_variable, check_mirage, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ12 (BattleScene12): 自動回復
- 使用ブロック: attack_basic, heal_magic, set_variable, get_variable, check_hp, auto_heal, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ13 (BattleScene13): 地下敵
- 使用ブロック: attack_basic, heal_magic, cast_magic, if_condition, check_underground, wait_for_surface, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ14 (BattleScene14): ループと結晶
- 使用ブロック: attack_basic, heal_magic, for_loop, while_loop, break_crystal, combo_attack, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ15 (BattleScene15): 属性検出
- 使用ブロック: attack_basic, heal_magic, cast_fire, cast_water, cast_thunder, detect_element, if_condition, set_variable, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ16 (BattleScene16): タイミング攻撃
- 使用ブロック: attack_basic, heal_magic, check_counter, wait_for_opening, timing_attack, if_condition, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ17 (BattleScene17): 関数定義
- 使用ブロック: attack_basic, heal_magic, define_function, call_function, attack_and_heal, check_health, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ18 (BattleScene18): ポーション作成
- 使用ブロック: attack_basic, heal_magic, craft_potion, use_potion, check_materials, define_recipe, call_recipe, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction, getPotionDisplayName

ステージ19 (BattleScene19): 武器強化
- 使用ブロック: attack_basic, heal_magic, upgrade_weapon, switch_weapon, craft_function, use_materials, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction

ステージ20 (BattleScene20): 最終ボス戦略
- 使用ブロック: attack_basic, heal_magic, debug_code, restore_function, adaptive_strategy, master_concept, final_strike, wave_left_hand, wave_right_hand, wait
- 使用関数: executeGameAction
*/

// 魔法詠唱パターンの定義 (ステージ3以降で使用)
const MAGIC_PATTERNS = {
  FIRE: ["left", "right"],           // 左手→右手 = 炎の魔法
  ICE: ["left", "left"],             // 左手→左手 = 氷の魔法
  THUNDER: ["right", "left"],        // 右手→左手 = 雷の魔法
  WATER: ["right", "right"],         // 右手→右手 = 水の魔法
  HEALING: ["left", "right", "left"], // 左→右→左 = 回復魔法
  RAIDEN: ["right", "right", "right", "left"], // 右→右→右→左 = ライデン（水+雷複合魔法）
  PARALYZE: ["left", "right", "left", "right", "left", "right", "left", "right"], // 左右左右左右左右 = 麻痺魔法
  FLASH: ["left", "right", "right", "left", "left", "left", "right", "left", "right", "right", "left", "left", "left", "right", "left", "right", "right", "left", "left", "left", "right"], // 閃光魔法（回避不可攻撃）
  ANTIDOTE: ["left", "left", "right"], // 左→左→右 = 解毒薬調合
  CURE_POISON: ["right", "right", "left"] // 右→右→左 = 解毒薬使用
};

// ====================================================================================
// メイン実行関数 - 全ステージで使用
// ====================================================================================

// メインのゲーム実行関数
// 使用ステージ: 全ステージ (1-20)
// 機能: ブロックのASTを受け取り、順次実行する
// パターンベース魔法システム用ヘルパー関数
function detectSpellFromPattern(pattern) {
  console.log("detectSpellFromPattern called with pattern:", pattern);
  console.log("MAGIC_PATTERNS:", MAGIC_PATTERNS);
  
  if (!pattern || pattern.length === 0) {
    console.log("Pattern is empty or null");
    return null;
  }
  
  // パターンを文字列に変換して検索
  const patternStr = JSON.stringify(pattern);
  console.log("Pattern as JSON string:", patternStr);
  
  for (const [spellType, spellPattern] of Object.entries(MAGIC_PATTERNS)) {
    const spellPatternStr = JSON.stringify(spellPattern);
    console.log(`Comparing with ${spellType}: ${spellPatternStr}`);
    if (spellPatternStr === patternStr) {
      console.log(`Found match: ${spellType}`);
      return spellType;
    }
  }
  
  console.log("No pattern match found");
  return null; // パターンが一致しない場合
}

function getSpellDisplayName(spellType) {
  const spellNames = {
    'FIRE': '炎の魔法',
    'ICE': '氷の盾', 
    'THUNDER': '雷の魔法',
    'WATER': '水の魔法',
    'HEALING': '回復魔法',
    'RAIDEN': 'ライデン',
    'PARALYZE': '麻痺魔法',
    'FLASH': '閃光魔法',
    'ANTIDOTE': '解毒薬調合',
    'CURE_POISON': '解毒薬使用'
  };
  
  return spellNames[spellType] || '不明な魔法';
}

function getSpellDamage(spellType) {
  const spellDamages = {
    'FIRE': 15,
    'ICE': 0,       // 防御魔法
    'THUNDER': 20,
    'WATER': 10,
    'HEALING': -20, // 回復（負のダメージ）
    'RAIDEN': 35,
    'PARALYZE': 0,  // 状態異常
    'FLASH': 25,
    'ANTIDOTE': 0,
    'CURE_POISON': 0
  };
  
  return spellDamages[spellType] || 0;
}

export async function runGameWithCommands(ast, game, ui) {
  try {
    // 処理前にASTをチェック
    console.log("Original AST:", JSON.stringify(ast, null, 2));
    
    // ステージ12以降で条件分岐やカスタム変数/リストを使用する場合、
    // 新しいconvertASTToActions関数を使用
    const hasConditionals = JSON.stringify(ast).includes('"type":"if_condition"');
    const hasCustomVarsOrLists = JSON.stringify(ast).includes('"type":"custom_variable_') || 
                                  JSON.stringify(ast).includes('"type":"custom_list_');
    
    let actions = [];
    
    if (hasConditionals || hasCustomVarsOrLists) {
      console.log("Using new convertASTToActions for complex blocks");
      actions = convertASTToActions(ast, game.scene);
    } else {
      // 従来の処理方法を使用
      console.log("Using legacy AST processing");
      
      // フラット化されたASTを正しく処理
      let flattenedAst = [];
      for (const item of ast) {
        if (Array.isArray(item)) {
          flattenedAst = flattenedAst.concat(item);
        } else {
          flattenedAst.push(item);
        }
      }
      
      // 魔法詠唱ブロックの処理
      const magicBlocks = flattenedAst.filter(node => node.type === "cast_magic");
      console.log("Magic blocks found:", magicBlocks.length);
      
      for (const magicBlock of magicBlocks) {
        console.log("Processing magic block:", JSON.stringify(magicBlock, null, 2));
        
        // 魔法ブロック内の手振りブロックを探す
        const handWaveSequence = [];
        if (magicBlock.children && magicBlock.children.length > 0) {
          extractHandWaveSequence(magicBlock.children, handWaveSequence);
        }
        
        console.log("Hand wave sequence found:", handWaveSequence);
        
        // 手振りシーケンスを魔法ブロックに紐付け
        if (handWaveSequence.length > 0) {
          magicBlock.handWaveSequence = handWaveSequence;
        }
      }
      
      console.log("Processed AST:", JSON.stringify(flattenedAst, null, 2));
      
      // JavaScript実装で評価
      try {
        actions = evaluateAstJs(flattenedAst);
        // actionsが配列であることを確認
        if (!Array.isArray(actions)) {
          console.error("JS evaluation returned non-array result:", actions);
          actions = [];
        }
      } catch (e) {
        console.error("JS evaluation failed:", e);
        actions = [];
      }
    }

    console.log("Generated actions:", JSON.stringify(actions, null, 2));

    // アクションの実行（actionsが空配列の場合は何も実行されない）
    for (const action of actions) {
      await executeGameAction(action, game, ui);
      
      // 各アクション後にプレイヤー敗北のみチェック（勝利判定はターン終了後に行う）
      if (game.player.hp <= 0) {
        console.log("Player defeated during player turn!");
        if (game.scene && typeof game.scene.gameOver === 'function') {
          game.scene.gameOver(false); // false = 敗北
        }
        return; // プレイヤー敗北時は即座に終了
      }
    }
    
    // プレイヤーアクション実行後の待ち時間
    await delay(800);
    
    // プレイヤーターン終了後の処理（ステージ固有の処理を実行）
    if (game.scene && typeof game.scene.afterPlayerTurn === 'function') {
      await game.scene.afterPlayerTurn();
    }
    
    // プレイヤーターン終了後に勝利判定（1回のみ）
    if (game.enemy.hp <= 0) {
      console.log("Victory! Enemy defeated!");
      if (game.scene && typeof game.scene.handleVictory === 'function') {
        await game.scene.handleVictory();
      } else if (game.scene && typeof game.scene.gameOver === 'function') {
        game.scene.gameOver(true); // true = 勝利
      }
      return; // 勝利時は敵のターンを実行せずに終了
    }
    
    // プレイヤーターン後の勝敗チェック（毒ダメージなどで敗北した場合）
    if (game.player.hp <= 0) {
      console.log("Player defeated after player turn!");
      if (game.scene && typeof game.scene.gameOver === 'function') {
        game.scene.gameOver(false); // false = 敗北
      }
      return;
    }
    
    // 敵のターン前の待ち時間
    await delay(1000);
    
    // 敵のターン（敵が生存している場合のみ実行）
    if (game.scene && typeof game.scene.enemyTurn === 'function') {
      console.log("Using scene's enemyTurn method (with paralysis support)");
      await game.scene.enemyTurn();
    } else {
      console.log("Using default enemy.takeTurn method");
      await game.enemy.takeTurn();
    }
    
    // 敵のターン後の待ち時間
    await delay(800);
    
    // 敵のターン後の勝敗チェック
    if (game.player.hp <= 0) {
      console.log("Player defeated after enemy turn!");
      if (game.scene && typeof game.scene.gameOver === 'function') {
        game.scene.gameOver(false); // false = 敗北
      }
      return;
    }
  } catch (error) {
    console.error("Error running game commands:", error);
    ui.log("エラーが発生しました: " + error.message);
  }
}

// 手振りシーケンスを再帰的に抽出する関数
function extractHandWaveSequence(children, sequence) {
  console.log("extractHandWaveSequence called with children:", children);
  
  for (const child of children) {
    console.log("Processing child:", child);
    
    // 配列の場合は再帰的に処理
    if (Array.isArray(child)) {
      console.log("Child is array, recursing...");
      extractHandWaveSequence(child, sequence);
      continue;
    }
    
    // 繰り返しブロックの処理
    if (child.type === "repeat_2x") {
      console.log("Found repeat_2x block, expanding 2 times");
      if (child.children && child.children.length > 0) {
        // 2回繰り返し
        for (let i = 0; i < 2; i++) {
          extractHandWaveSequence(child.children, sequence);
        }
      }
      continue;
    } else if (child.type === "repeat_3x") {
      console.log("Found repeat_3x block, expanding 3 times");
      if (child.children && child.children.length > 0) {
        // 3回繰り返し
        for (let i = 0; i < 3; i++) {
          extractHandWaveSequence(child.children, sequence);
        }
      }
      continue;
    } else if (child.type === "controls_repeat_ext") {
      // 汎用繰り返しブロック
      const repeatTimes = child.fields?.TIMES || 2; // デフォルト2回
      console.log(`Found controls_repeat_ext block, expanding ${repeatTimes} times`);
      if (child.children && child.children.length > 0) {
        for (let i = 0; i < repeatTimes; i++) {
          extractHandWaveSequence(child.children, sequence);
        }
      }
      continue;
    }
    
    if (child.type === "wave_left_hand") {
      console.log("Found wave_left_hand, adding 'left' to sequence");
      sequence.push("left");
    } else if (child.type === "wave_right_hand") {
      console.log("Found wave_right_hand, adding 'right' to sequence");
      sequence.push("right");
    }
    
    // 子要素があれば再帰的に探す
    if (child.children && child.children.length > 0) {
      console.log("Child has children, recursing...");
      extractHandWaveSequence(child.children, sequence);
    }
  }
  console.log("Current sequence after processing:", sequence);
}

// ====================================================================================
// ヘルパー関数群
// ====================================================================================

// ポーション表示名取得関数
// 使用ステージ: ステージ18（ポーション作成）
// 機能: ポーションタイプから日本語表示名を取得
function getPotionDisplayName(potionType) {
  switch (potionType) {
    case "ANTIDOTE":
      return "解毒薬";
    case "HEALING":
      return "回復薬";
    case "BOOST":
      return "強化薬";
    default:
      return "薬";
  }
}

// ====================================================================================
// コアアクション実行関数 - 全ステージで使用
// ====================================================================================

// 個別アクション実行関数
// 使用ステージ: 全ステージ（1-20）
// 機能: 各ブロックタイプに対応するゲーム内アクションを実行
async function executeGameAction(action, game, ui) {
  const { action_type, parameters } = action;
  
  switch (action_type) {    case "Attack":
      // ステージ7の装甲判定
      if (game.scene && game.scene.settings && game.scene.settings.stageNumber === 7 && 
          typeof game.scene.playerAttack === 'function') {
        const damage = 10;
        await game.scene.playerAttack(damage);
      }
      // ステージ8のシールド判定
      else if (game.scene && game.scene.settings && game.scene.settings.stageNumber === 8 && 
          typeof game.scene.playerAttack === 'function') {
        const damage = 10;
        await game.scene.playerAttack(damage);
      }
      // Use scene's handlePlayerAction if available (for BattleScene5, BattleScene6, etc.)
      else if (game.scene && typeof game.scene.handlePlayerAction === 'function') {
        console.log("Using scene's handlePlayerAction for Attack");
        try {
          await game.scene.handlePlayerAction("Attack", parameters);
        } catch (e) {
          console.error("Error calling scene's handlePlayerAction for Attack:", e);
          // Fallback to player's attack method
          await game.player.attack();
        }
      } else {
        // Stage9の回避システムチェック
        if (game.scene && game.scene.shadowBeastEvades && 
            typeof game.scene.dealDamageToEnemy === 'function') {
          // BattleScene9の回避システムを使用
          const damage = Math.floor(Math.random() * 10) + 5;
          ui.log("プレイヤーの攻撃！");
          if (game.scene && typeof game.scene.playAnimation === 'function') {
            await game.scene.playAnimation('playerAttack');
          }
          game.scene.dealDamageToEnemy(damage, 'normal');
        } else {
          await game.player.attack();
        }
      }
      break;
      
    case "Heal":
      const healAmount = parameters.amount || 10;
      // Use scene's handlePlayerAction if available (for BattleScene5, BattleScene6, etc.)
      if (game.scene && typeof game.scene.handlePlayerAction === 'function') {
        console.log("Using scene's handlePlayerAction for Heal");
        try {
          await game.scene.handlePlayerAction("Heal", { amount: healAmount });
        } catch (e) {
          console.error("Error calling scene's handlePlayerAction for Heal:", e);
          // Fallback to player's heal method
          await game.player.heal(healAmount);
        }
      } else {
        await game.player.heal(healAmount);
      }
      break;
        case "Wait":
      const seconds = parameters.seconds || 1;
      ui.log(`${seconds}秒間待機中...`);
      
      // シーン用の特殊待機処理（ステージ5向け）
      if (game.scene && typeof game.scene.handlePlayerAction === 'function') {
        console.log("Using scene's handlePlayerAction for Wait");
        try {
          await game.scene.handlePlayerAction("Wait");
        } catch (e) {
          console.error("Error calling scene's handlePlayerAction for Wait:", e);
          // フォールバックとして単純な遅延を使用
          await delay(seconds * 1000);
        }
      } else {
        // 通常の待機処理
        await delay(seconds * 1000);
      }
      break;
      
    case "StartIncantation":
      const spellName = parameters.spellName || parameters.spell;
      ui.log(`${spellName}の魔法を詠唱開始...`);
      break;
        case "WaveLeftHand":
      ui.log("左手を振った！");
      // ステージ3以降で利用する魔法詠唱（左手）の処理
      if (game.scene && typeof game.scene.castSpellLeft === 'function') {
        console.log("Using scene's castSpellLeft method");
        try {
          await game.scene.castSpellLeft();
        } catch (e) {
          console.error("Error calling scene.castSpellLeft:", e);
        }
      } else {
        await delay(500);
      }
      break;
      
    case "WaveRightHand":
      ui.log("右手を振った！");
      // ステージ3以降で利用する魔法詠唱（右手）の処理
      if (game.scene && typeof game.scene.castSpellRight === 'function') {
        console.log("Using scene's castSpellRight method");
        try {
          await game.scene.castSpellRight();
        } catch (e) {
          console.error("Error calling scene.castSpellRight:", e);
        }
      } else {
        await delay(500);
      }
      break;
      
    case "CompleteIncantation":
      const completeSpellName = parameters.spellName || parameters.spell;
      ui.log(`${completeSpellName}の魔法の詠唱成功！`);
      break;
      
    case "FailIncantation":
      const failSpellName = parameters.spellName || parameters.spell;
      ui.log(`${failSpellName}の魔法の詠唱失敗...正しいパターンではありません`);
      break;
      
    case "CastMagic":
      console.log("CastMagic action called with parameters:", parameters);
      
      // ライデン魔法の特別処理（ステージ7の装甲破壊用）
      if ((parameters.type === "RAIDEN" || parameters.spell === "RAIDEN") && 
          game.scene && game.scene.settings && game.scene.settings.stageNumber === 7) {
        console.log("Casting RAIDEN spell for Stage 7!");
        ui.log("⚡ ライデンを詠唱中...");
        
        if (game.scene.applyRaidenEffect) {
          game.scene.applyRaidenEffect();
        }
      }
      // ステージ8での魔法処理（シールドに弾かれる）
      else if (game.scene && game.scene.settings && game.scene.settings.stageNumber === 8 &&
               typeof game.scene.playerMagicAttack === 'function') {
        const spellType = parameters.type || parameters.spell;
        const spellName = getSpellDisplayName(spellType);
        const damage = getSpellDamage(spellType);
        console.log(`Attempting magic on Stage 8: ${spellName} (damage: ${damage})`);
        await game.scene.playerMagicAttack(spellName, damage);
      }
      // 麻痺魔法の特別処理
      else if (parameters.type === "PARALYZE" || parameters.spell === "PARALYZE") {
        console.log("Casting PARALYZE spell!");
        ui.log("⚡ 麻痺魔法を詠唱中...");
        
        // BattleSceneの麻痺処理を呼び出し（グローバル化済み）
        if (game.scene && game.scene.applyParalyzeEffect) {
          game.scene.applyParalyzeEffect();
        } else {
          ui.log("🔮 麻痺魔法成功！敵を3ターン麻痺させます");
          console.warn('applyParalyzeEffect method not found');
        }
      }
      // 閃光魔法の特別処理
      else if (parameters.type === "FLASH" || parameters.spell === "FLASH") {
        console.log("Casting FLASH spell!");
        ui.log("✨ 閃光魔法を詠唱中...");
        
        // 閃光魔法の効果（回避不可の大ダメージ）
        if (game.scene && game.scene.applyFlashEffect) {
          game.scene.applyFlashEffect();
        } else {
          // デフォルトの閃光魔法効果
          const damage = 25; // 高威力の固定ダメージ
          ui.log(`⚡ 閃光魔法発動！回避不可の${damage}ダメージ！`);
          
          if (game.enemy) {
            game.enemy.hp -= damage;
            if (game.scene && typeof game.scene.updateHP === 'function') {
              game.scene.updateHP(game.player.hp, game.enemy.hp);
            }
            if (game.scene && typeof game.scene.playAnimation === 'function') {
              await game.scene.playAnimation('magic_flash');
            }
          }
        }
      }
      // 解毒薬調合の特別処理
      else if (parameters.type === "ANTIDOTE" || parameters.spell === "ANTIDOTE") {
        console.log("Casting ANTIDOTE spell!");
        ui.log("🧪 解毒薬を調合しています...");
        
        if (game.scene && game.scene.applyAntidoteEffect) {
          game.scene.applyAntidoteEffect();
        } else {
          ui.log("🧪 解毒薬を調合しました！");
        }
      }
      // 解毒薬使用の特別処理
      else if (parameters.type === "CURE_POISON" || parameters.spell === "CURE_POISON") {
        console.log("Casting CURE_POISON spell!");
        ui.log("💙 解毒薬を使用しています...");
        
        if (game.scene && game.scene.applyCurePoisonEffect) {
          game.scene.applyCurePoisonEffect();
        } else {
          ui.log("💙 解毒薬を使用しました！");
        }
      }
      // 通常の魔法処理（FIRE, ICE, THUNDER, WATER, HEALING, RAIDEN）
      else {
        const spellType = parameters.type || parameters.spell;
        const spellDisplay = parameters.spell || parameters.type;
        console.log("Casting spell:", spellDisplay);

        // ステージ固有の魔法処理が定義されていればそちらを優先（例: BattleScene10）
        if (game.scene && typeof game.scene.playerCastSpell === 'function') {
          await game.scene.playerCastSpell(spellType);
        } else {
          // 共通プレイヤー魔法処理
          await game.player.castSpell(spellType);
        }
      }
      break;
        case "BrewAntidote":
      ui.log("解毒薬を調合中...");
      // Use scene's handlePlayerAction if available (for BattleScene6, etc.)
      if (game.scene && typeof game.scene.handlePlayerAction === 'function') {
        console.log("Using scene's handlePlayerAction for BrewAntidote");
        try {
          await game.scene.handlePlayerAction("BrewAntidote", parameters);
        } catch (e) {
          console.error("Error calling scene's handlePlayerAction for BrewAntidote:", e);
          // Fallback
          if (game.scene && typeof game.scene.brewAntidote === 'function') {
            await game.scene.brewAntidote();
          } else {
            ui.log("解毒薬を調合しました！");
            await delay(1000);
          }
        }
      } else if (game.scene && typeof game.scene.brewAntidote === 'function') {
        console.log("Using scene's brewAntidote method");
        try {
          await game.scene.brewAntidote();
        } catch (e) {
          console.error("Error calling scene's brewAntidote method:", e);
          ui.log("解毒薬の調合に失敗しました");
        }
      } else {
        ui.log("解毒薬を調合しました！");
        await delay(1000);
      }
      break;
        case "UsePotion":
      const potionType = parameters.potion_type || "ANTIDOTE";
      ui.log(`${getPotionDisplayName(potionType)}を使用します`);
      // Use scene's handlePlayerAction if available (for BattleScene6, etc.)
      if (game.scene && typeof game.scene.handlePlayerAction === 'function') {
        console.log("Using scene's handlePlayerAction for UsePotion");
        try {
          await game.scene.handlePlayerAction("UsePotion", parameters);
        } catch (e) {
          console.error("Error calling scene's handlePlayerAction for UsePotion:", e);
          // Fallback
          if (game.scene && typeof game.scene.usePotion === 'function') {
            await game.scene.usePotion(potionType);
          } else {
            ui.log(`${getPotionDisplayName(potionType)}の効果が発動しました！`);
            await delay(1000);
          }
        }
      } else if (game.scene && typeof game.scene.usePotion === 'function') {
        console.log("Using scene's usePotion method with type:", potionType);
        try {
          await game.scene.usePotion(potionType);
        } catch (e) {
          console.error("Error calling scene's usePotion method:", e);
          ui.log("薬の使用に失敗しました");
        }
      } else {
        ui.log(`${getPotionDisplayName(potionType)}の効果が発動しました！`);
        await delay(1000);
      }      break;
      
    case "ExecuteFunctionStart":
      console.log(`🎬 Function start: ${parameters.name}`);
      if (game.scene && typeof game.scene.onExecuteSavedFunctionStart === 'function') {
        game.scene.onExecuteSavedFunctionStart(parameters.name);
      }
      break;

    case "ExecuteFunctionEnd":
      console.log(`🏁 Function end: ${parameters.name}`);
      if (game.scene && typeof game.scene.onExecuteSavedFunctionEnd === 'function') {
        game.scene.onExecuteSavedFunctionEnd(parameters.name);
      }
      break;

    case "RepeatStart":
      ui.log("繰り返し処理を開始");
      break;

    case "RepeatEnd":
      ui.log("繰り返し処理を終了");
      break;
      


    case "Number":
      console.log(`Number: ${action.value}`);
      return action.value;

    // カスタム変数・リスト操作
    case "CustomVariableGet":
      const getVarName = action.varName || "custom_var";
      if (!game.customVariables) {
        game.customVariables = {};
      }
      const varValue = game.customVariables[getVarName];
      ui.log(`📌 変数「${getVarName}」: ${varValue}`);
      return varValue;

    case "CustomVariableSet":
      const setVarName = action.varName || "custom_var";
      let setValue = "";
      if (action.value_actions && action.value_actions.length > 0) {
        for (const valueAction of action.value_actions) {
          const result = await executeGameAction(valueAction, game, ui);
          if (result !== undefined) {
            setValue = result;
          }
        }
      } else {
        setValue = action.value;
      }
      if (!game.customVariables) {
        game.customVariables = {};
      }
      game.customVariables[setVarName] = setValue;
      ui.log(`📝 変数「${setVarName}」に「${setValue}」を設定しました`);
      break;

    case "CustomListGet":
      const getListName = action.listName || "custom_list";
      let getIndex = 0;
      if (action.index_actions && action.index_actions.length > 0) {
        for (const indexAction of action.index_actions) {
          const result = await executeGameAction(indexAction, game, ui);
          if (result !== undefined) {
            getIndex = parseInt(result);
          }
        }
      } else {
        getIndex = action.index || 0;
      }
      if (!game.customLists) {
        game.customLists = {};
      }
      if (!game.customLists[getListName]) {
        game.customLists[getListName] = [];
      }
      const listValue = game.customLists[getListName][getIndex];
      ui.log(`📖 リスト「${getListName}」の${getIndex}番目: ${listValue}`);
      return listValue;

    case "CustomListAdd":
      const addListName = action.listName || "custom_list";
      let customAddValue = "";
      if (action.item_actions && action.item_actions.length > 0) {
        for (const itemAction of action.item_actions) {
          const result = await executeGameAction(itemAction, game, ui);
          if (result !== undefined) {
            customAddValue = result;
          }
        }
      } else {
        customAddValue = action.value;
      }
      if (!game.customLists) {
        game.customLists = {};
      }
      if (!game.customLists[addListName]) {
        game.customLists[addListName] = [];
      }
      game.customLists[addListName].push(customAddValue);
      ui.log(`➕ リスト「${addListName}」に「${customAddValue}」を追加しました（長さ: ${game.customLists[addListName].length}）`);
      break;

    case "CustomListLength":
      const lengthListName = action.listName || "custom_list";
      if (!game.customLists) {
        game.customLists = {};
      }
      if (!game.customLists[lengthListName]) {
        game.customLists[lengthListName] = [];
      }
      const customListLength = game.customLists[lengthListName].length;
      ui.log(`📊 リスト「${lengthListName}」の長さ: ${customListLength}`);
      return customListLength;
    
    case "CustomVariableSet":
      ui.log(`変数「${parameters.varName}」に値「${parameters.value}」をセット`);
      // 実際の変数設定はconvertASTToActions内で既に実行済み
      break;
    
    case "CustomListAdd":
      ui.log(`リスト「${parameters.listName}」に値「${parameters.value}」を追加`);
      // 実際のリスト追加はconvertASTToActions内で既に実行済み
      break;
      
    case "Repeat":
      console.log("=== Repeat action executing ===");
      console.log("Repeat count:", parameters.count);
      console.log("Inner actions:", parameters.actions);
      
      if (!parameters.actions || !Array.isArray(parameters.actions)) {
        console.error("No actions to repeat!");
        break;
      }
      
      // 繰り返し回数の上限チェック
      const maxRepeat = 10;
      const actualCount = Math.min(parameters.count, maxRepeat);
      
      if (parameters.count > maxRepeat) {
        ui.log(`⚠️ 繰り返しは最大${maxRepeat}回までです。${maxRepeat}回実行します。`);
      }
      
      for (let i = 0; i < actualCount; i++) {
        ui.log(`🔄 繰り返し ${i + 1}/${actualCount} 回目`);
        console.log(`Executing repeat iteration ${i + 1}/${actualCount}`);
        
        // 繰り返しブロック内の各アクションを実行
        for (const innerAction of parameters.actions) {
          console.log("Executing inner action:", innerAction);
          await executeGameAction(innerAction, game, ui);
          await delay(300); // アクション間の待機
        }
      }
      
      console.log("=== Repeat action completed ===");
      break;

  }
}

// ====================================================================================
// AST変換関数群
// ====================================================================================

// 新しいAST処理関数（ステージ12以降の複雑な構造に対応）
function convertASTToActions(ast, battleScene) {
  const actions = [];
  
  function processNode(node) {
    if (!node) return null;
    
    // プリミティブ値の場合はそのまま返す
    if (typeof node !== 'object') {
      return node;
    }
    
    // 配列の場合は最初の要素を処理（ただしif_conditionの場合は全要素を保持）
    if (Array.isArray(node)) {
      if (node.length === 0) return null;
      // 複数要素がある場合は順次処理
      const results = [];
      for (const item of node) {
        const result = processNode(item);
        if (result !== null && result !== undefined) {
          results.push(result);
        }
      }
      return results.length === 1 ? results[0] : results;
    }
    
    const type = node.type;
    const fields = node.fields || {};
    
    // typeが存在しない場合
    if (!type) {
      console.warn("Node without type:", node);
      return null;
    }
    
    switch (type) {
      case "custom_variable_get": {
        const varName = fields.VAR_NAME;
        console.log(`[custom_variable_get] Field VAR_NAME: "${varName}"`);
        
        if (!varName || varName === "変数名") {
          console.warn("❌ Variable name not set or is template. Available variables:", Object.keys(battleScene.customVariables || {}));
          console.warn("   If you see '変数名', please select a variable from the dropdown in Blockly editor.");
          return null;
        }
        
        const value = battleScene.customVariables[varName];
        console.log(`✅ Get variable "${varName}": ${JSON.stringify(value)}`);
        return value;
      }
      
      case "custom_variable_set": {
        const varName = fields.VAR_NAME;
        if (!varName || varName === "変数名") {
          console.warn("Variable name not set:", node);
          return null;
        }
        // childrenが配列の場合は最初の要素、それ以外はそのまま処理
        const childValue = node.children && node.children.length > 0 ? node.children[0] : node.children;
        const value = processNode(childValue);
        battleScene.customVariables[varName] = value;
        console.log(`Set variable ${varName} = ${value}`);
        actions.push({
          action_type: "CustomVariableSet",
          parameters: { varName, value }
        });
        return value;
      }
      
      case "custom_list_add": {
        const listName = fields.LIST_NAME;
        if (!listName || listName === "リスト名") {
          console.warn("List name not set:", node);
          return null;
        }
        // childrenが配列の場合は最初の要素、それ以外はそのまま処理
        const childValue = node.children && node.children.length > 0 ? node.children[0] : node.children;
        const value = processNode(childValue);
        if (!battleScene.customLists[listName]) {
          battleScene.customLists[listName] = [];
        }
        battleScene.customLists[listName].push(value);
        console.log(`Add to list ${listName}: ${value}`);
        actions.push({
          action_type: "CustomListAdd",
          parameters: { listName, value }
        });
        return null;
      }
      
      case "custom_list_get": {
        const listName = fields.LIST_NAME;
        if (!listName || listName === "リスト名") {
          console.warn("List name not set:", node);
          return null;
        }
        // childrenが配列の場合は最初の要素、それ以外はそのまま処理
        const childValue = node.children && node.children.length > 0 ? node.children[0] : node.children;
        const index = processNode(childValue);
        if (!battleScene.customLists[listName]) {
          console.warn(`List ${listName} does not exist`);
          return null;
        }
        // インデックスは1始まり
        const value = battleScene.customLists[listName][index - 1] || null;
        console.log(`Get from list ${listName}[${index}]: ${value}`);
        return value;
      }
      
      case "custom_list_length": {
        const listName = fields.LIST_NAME;
        if (!listName || listName === "リスト名") {
          console.warn("List name not set:", node);
          return 0;
        }
        const length = battleScene.customLists[listName]?.length || 0;
        console.log(`Length of list ${listName}: ${length}`);
        return length;
      }
      
      case "text_equals": {
        const children = node.children || [];
        console.log(`  🔤 [text_equals] Comparing...`);
        console.log(`    Left node:`, children[0]?.type, children[0]?.fields);
        console.log(`    Right node:`, children[1]?.type, children[1]?.fields);
        
        const left = processNode(children[0]);
        const right = processNode(children[1]);
        
        console.log(`    Left value: "${left}" (${typeof left})`);
        console.log(`    Right value: "${right}" (${typeof right})`);
        
        const result = String(left) === String(right);
        console.log(`    Result: ${result} (${JSON.stringify(left)} === ${JSON.stringify(right)})`);
        return result;
      }
      
      case "text": {
        return fields.TEXT || "";
      }
      
      case "math_number": {
        return parseFloat(fields.NUM || 0);
      }
      
      case "if_condition": {
        // children: [condition1, do1, condition2, do2, ..., else]
        const children = node.children || [];
        console.log(`\n🔀 [if_condition] Processing with ${children.length} children`);
        
        // childrenの内容を詳細ログ
        children.forEach((child, idx) => {
          if (idx % 2 === 0) {
            console.log(`  [${idx}] Condition node:`, child?.type || child);
          } else {
            console.log(`  [${idx}] Do node:`, child?.type || child);
          }
        });
        
        // 条件とアクションをペアで処理
        const numConditions = Math.floor(children.length / 2);
        console.log(`  Number of if/elseif pairs: ${numConditions}`);
        
        for (let i = 0; i < numConditions; i++) {
          const conditionIndex = i * 2;
          const doIndex = i * 2 + 1;
          const conditionNode = children[conditionIndex];
          const doNode = children[doIndex];
          
          console.log(`\n  🔍 Evaluating condition ${i + 1}...`);
          const condition = processNode(conditionNode);
          console.log(`  ➡️ Condition ${i + 1} result: ${JSON.stringify(condition)} (${typeof condition})`);
          
          if (condition === true) {
            // 条件が真の場合、対応するdoブロックを実行
            console.log(`  ✅ Condition ${i + 1} is TRUE, executing do block...`);
            processNode(doNode);
            console.log(`  ✅ Do block ${i + 1} executed, exiting if_condition`);
            return; // 最初に真になった条件のブロックのみ実行
          } else {
            console.log(`  ❌ Condition ${i + 1} is FALSE, skipping do block`);
          }
        }
        
        // すべての条件が偽の場合、elseブロックを実行
        if (children.length % 2 === 1) {
          console.log(`\n  📌 All conditions false, executing else block (index ${children.length - 1})`);
          const elseNode = children[children.length - 1];
          processNode(elseNode);
        } else {
          console.log(`\n  📌 All conditions false, no else block available`);
        }
        return;
      }
      
      case "cast_magic_value": {
        // handWaveSequenceを抽出
        const handWaveSequence = [];
        if (node.children && Array.isArray(node.children) && node.children.length > 0) {
          // ネストした配列を平坦化
          function flattenWaves(arr) {
            if (!arr || !Array.isArray(arr)) return;
            for (const item of arr) {
              if (Array.isArray(item)) {
                flattenWaves(item);
              } else if (item && typeof item === 'object' && item.type) {
                if (item.type === "wave_left_hand") handWaveSequence.push("left");
                if (item.type === "wave_right_hand") handWaveSequence.push("right");
              }
            }
          }
          flattenWaves(node.children);
        }
        
        console.log(`Cast magic value with sequence: ${handWaveSequence.join(', ')}`);
        
        // 既存のconvertNodeToAction関数を呼び出して魔法を実行
        const magicNode = { type: "cast_magic_value", handWaveSequence };
        const magicActions = convertNodeToAction(magicNode, {});
        if (magicActions && Array.isArray(magicActions)) {
          actions.push(...magicActions);
        } else if (magicActions) {
          actions.push(magicActions);
        }
        return;
      }
      
      case "custom_function_placeholder": {
        const functionName = fields.FUNCTION_NAME;
        console.log(`[custom_function_placeholder] Function name: "${functionName}"`);
        
        if (!functionName || functionName === "関数") {
          console.warn("❌ Function name not set or is template.");
          return null;
        }
        
        // window.variableEditor から関数のASTを取得
        const functionAst = window.variableEditor ? window.variableEditor.getFunctionAst(functionName) : null;
        if (!functionAst) {
          console.warn(`⚠️ Function "${functionName}" not found or has no saved logic.`);
          return null;
        }
        
        console.log(`🚀 Preparing to execute saved function: ${functionName}`);
        
        // 実行開始アクションを追加
        actions.push({
          action_type: "ExecuteFunctionStart",
          parameters: { name: functionName }
        });
        
        // 関数のASTを展開してアクションに追加
        processNode(functionAst);
        
        // 実行終了アクションを追加
        actions.push({
          action_type: "ExecuteFunctionEnd",
          parameters: { name: functionName }
        });
        
        return null;
      }
      
      default:
        // その他のブロックは従来のconvertNodeToAction関数で処理
        try {
          const defaultActions = convertNodeToAction(node, fields);
          if (defaultActions && Array.isArray(defaultActions)) {
            actions.push(...defaultActions);
          } else if (defaultActions) {
            actions.push(defaultActions);
          }
        } catch (e) {
          console.warn("Unknown or unsupported node type:", type, node);
        }
        return null;
    }
  }
  
  // ルートノードから処理開始
  console.log("=== Starting AST processing ===");
  if (Array.isArray(ast)) {
    ast.forEach((node, index) => {
      console.log(`Processing root node ${index}:`, node);
      processNode(node);
    });
  } else {
    console.log("Processing single root node:", ast);
    processNode(ast);
  }
  console.log("=== AST processing complete ===");
  console.log("Generated actions:", actions);
  
  return actions;
}

function convertNodeToAction(node, fields) {
  const action_type = node.type;
  const actions = [];
  
  switch (action_type) {
    case "robust_attack":
      actions.push({
        action_type: "RobustAttack",
        parameters: {}
      });
      break;

    case "adaptive_heal":
      actions.push({
        action_type: "AdaptiveHeal",
        parameters: {}
      });
      break;

    case "check_code_disruption":
      const blockType = fields.BLOCK_TYPE;
      actions.push({
        action_type: "CheckCodeDisruption",
        parameters: { blockType: blockType }
      });
      break;

    case "backup_strategy":
      const strategyType = fields.STRATEGY_TYPE;
      actions.push({
        action_type: "BackupStrategy",
        parameters: { strategyType: strategyType }
      });
      break;

    case "check_robustness":
      actions.push({
        action_type: "CheckRobustness",
        parameters: {}
      });
      break;

    case "try_catch_block":
      const tryStatements = node.children.filter(child => child.parent_type === "TRY_STATEMENT");
      const catchStatements = node.children.filter(child => child.parent_type === "CATCH_STATEMENT");
      actions.push({
        action_type: "TryCatchBlock",
        parameters: { 
          tryActions: tryStatements.map(stmt => convertNodeToAction(stmt)).flat(),
          catchActions: catchStatements.map(stmt => convertNodeToAction(stmt)).flat()
        }
      });
      break;

    case "redundancy_check":
      const redundantActions = node.children.filter(child => child.parent_type === "ACTION");
      actions.push({
        action_type: "RedundancyCheck",
        parameters: { 
          actions: redundantActions.map(action => convertNodeToAction(action)).flat()
        }
      });
      break;

    case "cast_magic_value":
      console.log("🎯 convertNodeToAction: Processing cast_magic_value");
      const handWaveSequence = node.handWaveSequence || [];
      console.log("  Wave sequence:", handWaveSequence);
      
      // パターンから魔法を検出
      const detectedSpell = detectSpellFromPattern(handWaveSequence);
      const spellDisplayName = detectedSpell ? getSpellDisplayName(detectedSpell) : null;
      console.log("  Detected spell:", detectedSpell, "Display name:", spellDisplayName);
      
      actions.push({
        action_type: "StartIncantation",
        parameters: { 
          handWaveSequence: handWaveSequence,
          spellName: spellDisplayName
        }
      });
      break;

    default:
      console.warn("Unknown action type:", action_type);
  }
  
  return actions;
}

// ====================================================================================
// AST評価・変換関数群 - 全ステージで使用
// ====================================================================================

// JavaScript AST評価関数（フォールバック実装）
// 使用ステージ: 全ステージ（1-20）
// 機能: ブロックリーで生成されたASTをゲームアクションに変換
function evaluateAstJs(parsedAst) {
  // Handle different AST structures
  const nodes = parsedAst.nodes || parsedAst || [];
  const actions = [];
  let currentIncantation = [];
  let currentSpell = null;
  
  console.log("=== evaluateAstJs called ===");
  console.log("Parsed AST:", JSON.stringify(parsedAst, null, 2));
  
  // Ensure nodes is iterable
  if (!Array.isArray(nodes)) {
    console.error("Invalid AST structure - nodes is not an array:", parsedAst);
    return [];
  }
  
  console.log(`Processing ${nodes.length} nodes`);
  
  for (const node of nodes) {
    // Safety check for node structure
    if (!node || typeof node !== 'object') {
      console.warn("Invalid node structure:", node);
      continue;
    }
    
    const { node_type, fields, type } = node;
    // Use node_type or type for compatibility with different AST formats
    const nodeType = node_type || type;
    
    if (!nodeType) {
      console.warn("Node missing type information:", node);
      continue;
    }
    
    console.log(`Processing node type: ${nodeType}`);
    
    switch (nodeType) {
      case "attack":
      case "attack_basic":
        console.log("Attack block detected");
        actions.push({
          action_type: "Attack",
          parameters: {}
        });
        break;
        
        
        
      case "cast_magic":
      case "cast_magic_value":
        // パターンベース魔法詠唱システム（通常型と値型を統合）
        currentIncantation = node.handWaveSequence || [];
        console.log("Cast magic with hand wave sequence:", currentIncantation);
        
        // パターンから魔法タイプを判定
        const detectedSpell = detectSpellFromPattern(currentIncantation);
        currentSpell = detectedSpell;
        
        actions.push({
          action_type: "StartIncantation",
          parameters: { 
            spell: getSpellDisplayName(detectedSpell),
            pattern: currentIncantation.join("→")
          }
        });
        break;

      case "wave_left_hand":
        // 単独の手振りブロックは記録のみ（魔法ブロック内で処理される）
        actions.push({
          action_type: "WaveLeftHand",
          parameters: {}
        });
        break;
        
      case "wave_right_hand":
        // 単独の手振りブロックは記録のみ（魔法ブロック内で処理される）
        actions.push({
          action_type: "WaveRightHand",
          parameters: {}
        });
        break;
        
      case "brew_antidote":
        actions.push({
          action_type: "BrewAntidote",
          parameters: {}
        });
        break;
        
      case "use_potion":
        const potionType = fields.POTION_TYPE || "ANTIDOTE";        actions.push({
          action_type: "UsePotion",
          parameters: { potion_type: potionType }
        });
        break;
      
      case "convert_attack":
        const convertInput = node.inputs?.INPUT;
        let convertValue = "";
        let convertUseVariable = false;
        
        if (convertInput) {
          if (convertInput.type === "variable_reference") {
            // 変数ブロックを使用
            convertValue = convertInput.fields?.VAR_NAME || "";
            convertUseVariable = true;
          } else if (convertInput.type === "enemy_attack_name") {
            // 手入力ブロックを使用
            convertValue = convertInput.fields?.ATTACK_NAME || "";
            convertUseVariable = false;
          }
        }
        
        actions.push({
          action_type: "ConvertAttack",
          parameters: { 
            input: convertValue,
            useVariable: convertUseVariable
          }
        });
        break;

      case "enhance_attack":
        const enhanceInput = node.inputs?.INPUT;
        let enhanceValue = "";
        let enhanceUseVariable = false;
        
        if (enhanceInput) {
          if (enhanceInput.type === "variable_reference") {
            // 変数ブロックを使用
            enhanceValue = enhanceInput.fields?.VAR_NAME || "";
            enhanceUseVariable = true;
          } else if (enhanceInput.type === "enemy_attack_name") {
            // 手入力ブロックを使用
            enhanceValue = enhanceInput.fields?.ATTACK_NAME || "";
            enhanceUseVariable = false;
          }
        }
        
        actions.push({
          action_type: "EnhanceAttack",
          parameters: { 
            input: enhanceValue,
            useVariable: enhanceUseVariable
          }
        });
        break;

      case "enemy_attack_name":
        // 値ブロック（手入力）
        const attackName = fields.ATTACK_NAME || "";
        actions.push({
          action_type: "EnemyAttackName",
          parameters: { 
            attackName: attackName,
            value: attackName
          }
        });
        break;

      case "variable_reference":
        // 変数参照ブロック
        const varRefName = fields.VAR_NAME || "attack_var";
        actions.push({
          action_type: "VariableReference",
          parameters: { 
            varName: varRefName,
            value: varRefName
          }
        });
        break;


      // カスタム変数・リスト操作ブロック
      case "custom_variable_get":
        const customGetVarName = fields.VAR_NAME || "custom_var";
        actions.push({
          action_type: "CustomVariableGet",
          varName: customGetVarName
        });
        break;

      case "custom_variable_set":
        const customSetVarName = fields.VAR_NAME || "custom_var";
        const customSetValue = node.inputs?.VALUE;
        const customSetValueActions = [];
        if (customSetValue) {
          customSetValueActions.push(...convertNodeToAction(customSetValue));
        }
        actions.push({
          action_type: "CustomVariableSet",
          varName: customSetVarName,
          value_actions: customSetValueActions
        });
        break;

      case "custom_list_get":
        const customGetListName = fields.LIST_NAME || "custom_list";
        const customGetIndex = node.inputs?.INDEX;
        const customGetIndexActions = [];
        if (customGetIndex) {
          customGetIndexActions.push(...convertNodeToAction(customGetIndex));
        }
        actions.push({
          action_type: "CustomListGet",
          listName: customGetListName,
          index_actions: customGetIndexActions
        });
        break;

      case "custom_list_add":
        const customAddListName = fields.LIST_NAME || "custom_list";
        const customAddItem = node.inputs?.ITEM;
        const customAddItemActions = [];
        if (customAddItem) {
          customAddItemActions.push(...convertNodeToAction(customAddItem));
        }
        actions.push({
          action_type: "CustomListAdd",
          listName: customAddListName,
          item_actions: customAddItemActions
        });
        break;

      case "custom_list_length":
        const customLengthListName = fields.LIST_NAME || "custom_list";
        actions.push({
          action_type: "CustomListLength",
          listName: customLengthListName
        });
        break;
        
      // 繰り返しブロック処理
      case "repeat_2x":
      case "repeat_3x":
      case "repeat_4x":
        console.log("=== Repeat block detected ===");
        console.log("Block type:", nodeType);
        console.log("Full node:", JSON.stringify(node, null, 2));
        
        const repeatCount = parseInt(nodeType.match(/\d+/)[0]);
        console.log(`Repeat count: ${repeatCount}`);
        
        const innerActions = [];
        
        // node.children, node.do, node.inputs.DO などをチェック
        const doContent = node.children || node.do || node.inputs?.DO;
        console.log("Do content:", doContent);
        
        if (doContent && Array.isArray(doContent)) {
          console.log(`Processing ${doContent.length} child nodes`);
          for (const childNode of doContent) {
            console.log("Child node type:", childNode.type || childNode.node_type);
            const childResult = evaluateAstJs({ nodes: [childNode] });
            console.log("Child result:", childResult);
            innerActions.push(...childResult);
          }
        } else {
          console.warn("node.do/children is missing or not an array!");
        }
        
        console.log("Final innerActions:", innerActions);
        
        actions.push({
          action_type: "Repeat",
          parameters: {
            count: repeatCount,
            actions: innerActions
          }
        });
        break;
 
    }
  }
  
  console.log("=== evaluateAstJs completed ===");
  console.log("Generated actions:", JSON.stringify(actions, null, 2));
  
  // 詠唱が完了したら魔法を実行
  if (currentSpell && currentIncantation.length > 0) {
    const expectedPattern = MAGIC_PATTERNS[currentSpell];
    const isCorrect = 
      JSON.stringify(currentIncantation) === JSON.stringify(expectedPattern);
    
    if (isCorrect) {
      actions.push({
        action_type: "CompleteIncantation",
        parameters: { 
          spell: getSpellDisplayName(currentSpell),
          pattern: currentIncantation.join(",")
        }
      });
      
      actions.push({
        action_type: "CastMagic",
        parameters: { 
          spell: getSpellDisplayName(currentSpell),
          type: currentSpell  // typeプロパティは英語のまま（内部処理用）
        }
      });
    } else {
      actions.push({
        action_type: "FailIncantation",
        parameters: { 
          spell: getSpellDisplayName(currentSpell),
          pattern: currentIncantation.join(","),
          expected: expectedPattern.join(",")
        }
      });
    }
  }
  
  return actions;
}

// グローバルに公開（BattleScene12のカウンターシステムで使用）
if (typeof window !== 'undefined') {
  window.convertASTToActions = convertASTToActions;
  window.executeGameAction = executeGameAction;
}
