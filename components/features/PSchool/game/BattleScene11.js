import { BattleScene } from './battle.js';

// ステージ11「初めての変数」用のバトルシーン
export class BattleScene11 extends BattleScene {
  constructor() {
    super({ key: 'Stage11Battle' });
    this.settings = {
      background: 'mysticalforest',
      enemy: '幻影魔術師',
      stageNumber: 11
    };
    
    
    // 攻撃反射システム
    this.attackReflectionSystem = {
      lastEnemyAttack: '',
      convertedAttack: null,
      enhancedAttack: null,
      variablesUsed: {
        remember: false,
        convert: false,
        enhance: false
      }
    };
    
    // ミラージュウィザード専用の状態（簡略化）
    this.mirageState = {
      realTargetPosition: null,
      miragePositions: [],
      miragesRemaining: 3,
      isCheckingMirage: false,
      foundReal: false
    };
  }

  create() {
    super.create();
    
    // 敵の名前を設定
    if (this.enemy) {
      this.enemy.setName('ミラージュウィザード');
    }
    
    // ステージ11の設定
    this.setupStageCommon({
      backgroundColor: 0x228B22, // 神秘の森の緑色背景
      enemyTint: 0x9370DB, // ミラージュウィザードの紫色
      enemyHp: 80,
      availableBlocks: ['attack_basic', 'heal_magic', 'cast_magic', 'remember_enemy_attack', 'convert_attack', 'enhance_attack', 'enemy_attack_name', 'variable_reference', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createMirageEffects();
  }

  createMirageEffects() {
    // 神秘の森エフェクト
    const sparkles = this.add.graphics();
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * this.scale.width;
      const y = Math.random() * this.scale.height;
      sparkles.fillStyle(0x9370DB, 0.4);
      sparkles.fillCircle(x, y, 3);
      
      this.tweens.add({
        targets: sparkles,
        alpha: 0,
        duration: 2500,
        repeat: -1,
        yoyo: true,
        delay: i * 200
      });
    }
  }


  enemyAction() {
    if (this.battleEnded) return;
    
    const actions = ['幻影の矢', '魔力の奔流', '神秘の衝撃'];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const damage = 12 + Math.floor(Math.random() * 8);
    
    // 敵の攻撃名を記録
    this.attackReflectionSystem.lastEnemyAttack = action;
    
    // enemy.jsのperformAttackメソッドを使用
    this.enemy.performAttack(action, damage);
  }

  // ===============================
  // 攻撃反射システム（ステージ11新機能）
  // ===============================

  // 敵の攻撃名を記憶する
  async rememberEnemyAttack(attackName, varName) {
    this.variables[varName] = attackName;
    this.attackReflectionSystem.lastEnemyAttack = attackName;
    this.attackReflectionSystem.variablesUsed.remember = true;
    
    this.addLog(`💾 攻撃「${attackName}」を変数「${varName}」に記憶しました！`);
    this.updateVariableDisplay();
    
    await this.delay(500);
  }

  // 攻撃を変換する
  async convertAttack(input, useVariable) {
    let attackName = input;
    let expBonus = 1.0;
    
    // 変数を使っているかチェック
    if (useVariable) {
      // 変数ブロックを使用した場合
      attackName = this.variables[input] || input;
      expBonus = 2.0; // 2倍の経験値
      this.attackReflectionSystem.variablesUsed.convert = true;
      this.addLog(`✨ 変数を使用して変換！経験値ボーナス×${expBonus}！`);
    } else {
      // 手入力の場合
      expBonus = 0.3; // 30%の経験値
      this.addLog(`⚠️ 手入力での変換...経験値が減少します（×${expBonus}）`);
    }
    
    // 攻撃名が正しいかチェック
    if (attackName === this.attackReflectionSystem.lastEnemyAttack) {
      this.attackReflectionSystem.convertedAttack = {
        name: attackName,
        expBonus: expBonus
      };
      this.addLog(`🔄 攻撃「${attackName}」を正しく変換しました！`);
      return { success: true, expBonus };
    } else {
      this.addLog(`❌ 変換失敗！敵の攻撃名「${this.attackReflectionSystem.lastEnemyAttack}」と一致しません`);
      return { success: false, expBonus: 0 };
    }
  }

  // 攻撃を強化する
  async enhanceAttack(input, useVariable) {
    if (!this.attackReflectionSystem.convertedAttack) {
      this.addLog(`❌ まず攻撃を変換してください！`);
      return { success: false, damage: 0, expBonus: 0 };
    }
    
    let attackName = input;
    let expMultiplier = this.attackReflectionSystem.convertedAttack.expBonus;
    
    // 変数を使っているかチェック
    if (useVariable) {
      attackName = this.variables[input] || input;
      expMultiplier *= 2.0; // さらに2倍
      this.attackReflectionSystem.variablesUsed.enhance = true;
      this.addLog(`✨ 変数を使用して強化！経験値ボーナス×${expMultiplier}！`);
    } else {
      expMultiplier *= 0.3; // さらに減少
      this.addLog(`⚠️ 手入力での強化...経験値がさらに減少（×${expMultiplier}）`);
    }
    
    // 攻撃名が正しいかチェック
    if (attackName === this.attackReflectionSystem.lastEnemyAttack) {
      const damage = 35; // 強力な反射ダメージ
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      this.addLog(`⚡ 攻撃反射成功！${damage}ダメージ！`);
      this.addLog(`🎓 獲得経験値倍率: ×${expMultiplier.toFixed(1)}`);
      
      // 経験値ボーナスの記録（後で経験値システムに適用）
      this.attackReflectionSystem.enhancedAttack = {
        name: attackName,
        damage: damage,
        expBonus: expMultiplier
      };
      
      // 変数を正しく使った場合のボーナスメッセージ
      if (this.attackReflectionSystem.variablesUsed.remember && 
          this.attackReflectionSystem.variablesUsed.convert && 
          this.attackReflectionSystem.variablesUsed.enhance) {
        this.addLog(`🏆 完璧！すべて変数を使用しました！最大経験値！`);
      }
      
      // システムリセット
      this.attackReflectionSystem.convertedAttack = null;
      this.attackReflectionSystem.enhancedAttack = null;
      this.attackReflectionSystem.variablesUsed = {
        remember: false,
        convert: false,
        enhance: false
      };
      
      if (this.enemy.hp <= 0) {
        this.addLog("ミラージュウィザードを倒した！変数と攻撃反射をマスター！");
        this.gameOver(true);
        return { success: true, damage, expBonus: expMultiplier };
      }
      
      return { success: true, damage, expBonus: expMultiplier };
    } else {
      this.addLog(`❌ 強化失敗！攻撃名が一致しません`);
      return { success: false, damage: 0, expBonus: 0 };
    }
  }

  // 変数表示を更新
  updateVariableDisplay() {
    Object.keys(this.variables).forEach((varName) => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
