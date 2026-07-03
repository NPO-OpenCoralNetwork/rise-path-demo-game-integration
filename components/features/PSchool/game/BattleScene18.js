import { BattleScene } from './battle.js';

// ステージ18「薬の合成レシピ」用のバトルシーン
export class BattleScene18 extends BattleScene {
  constructor() {
    super({ key: 'Stage18Battle' });
    this.settings = {
      background: 'laboratory',
      enemy: 'plaguedoctor',
      stageNumber: 18
    };
    
    // 関数管理システム
    this.userFunctions = new Map();
    this.functionUsageCount = new Map();
    
    // 薬の合成システム
    this.potionRecipes = {
      'antidote': ['herb', 'water', 'salt'],
      'healing_potion': ['herb', 'crystal', 'water'],
      'resist_potion': ['crystal', 'salt', 'essence'],
      'cure_all': ['herb', 'crystal', 'salt', 'essence', 'water']
    };
    
    // プレーグドクターの状態異常システム
    this.statusEffects = {
      poison: { active: false, duration: 0, damage: 5 },
      weakness: { active: false, duration: 0, effect: 0.5 },
      confusion: { active: false, duration: 0, effect: true },
      plague: { active: false, duration: 0, damage: 8 }
    };
    
    // 薬の材料在庫
    this.materials = {
      herb: 3,
      crystal: 2,
      water: 4,
      salt: 2,
      essence: 1
    };
    
    // 合成した薬の在庫
    this.potions = {
      antidote: 0,
      healing_potion: 0,
      resist_potion: 0,
      cure_all: 0
    };

    // 変数管理システム
    this.variables = {
      poison_active: false,
      weakness_active: false,
      materials_count: 12,
      potions_made: 0,
      function_efficiency: 0
    };
  }

  create() {
    super.create();
    
    // ステージ18の設定
    this.setupStageCommon({
      backgroundColor: 0x2F4F2F, // 研究室の暗い緑色背景
      enemyTint: 0x4B0082, // プレーグドクターの紫色
      enemyHp: 100,
      startMessage: `ステージ18「薬の合成レシピ」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'craft_potion', 'use_potion', 'check_materials', 'define_recipe', 'call_recipe', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createLabEffect();
    this.setupPotionSystem();
  }

  createLabEffect() {
    // 研究室のエフェクト（試験管の泡）
    const bubbles = this.add.graphics();
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * this.scale.width;
      const y = this.scale.height * 0.8 + Math.random() * 100;
      bubbles.fillStyle(0x00FF00, 0.6);
      bubbles.fillCircle(x, y, 6);
      
      this.tweens.add({
        targets: bubbles,
        y: y - 200,
        alpha: 0,
        duration: 3000,
        repeat: -1,
        delay: i * 250
      });
    }
  }

  setupPotionSystem() {
    // 薬システムの初期化
    this.materialsText = this.add.text(10, 150, this.getMaterialsDisplay(), {
      fontSize: '14px',
      fill: '#00ff00'
    });
    
    this.potionsText = this.add.text(10, 180, this.getPotionsDisplay(), {
      fontSize: '14px',
      fill: '#ffff00'
    });
    
    this.statusText = this.add.text(10, 210, 'ステータス: 正常', {
      fontSize: '16px',
      fill: '#00ff00'
    });
    
    this.createVariableDisplay();
  }

  createVariableDisplay() {
    // 変数表示UIの作成
    this.variableTexts = {};
    let yOffset = 230;
    
    Object.keys(this.variables).forEach((varName, index) => {
      this.variableTexts[varName] = this.add.text(10, yOffset + index * 20, 
        `${varName}: ${this.variables[varName]}`, {
        fontSize: '14px',
        fill: '#9370DB'
      });
    });
  }

  getMaterialsDisplay() {
    return `材料: ハーブ${this.materials.herb} 水晶${this.materials.crystal} 水${this.materials.water} 塩${this.materials.salt} エッセンス${this.materials.essence}`;
  }

  getPotionsDisplay() {
    return `薬: 解毒${this.potions.antidote} 回復${this.potions.healing_potion} 耐性${this.potions.resist_potion} 万能${this.potions.cure_all}`;
  }

  updateVariableDisplay() {
    Object.keys(this.variables).forEach(varName => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  checkMaterials() {
    this.addLog('🧪 材料在庫をチェック中...');
    this.addLog(this.getMaterialsDisplay());
    
    const totalMaterials = Object.values(this.materials).reduce((sum, count) => sum + count, 0);
    this.variables.materials_count = totalMaterials;
    this.updateVariableDisplay();
  }

  defineRecipe(recipeName) {
    if (this.potionRecipes[recipeName]) {
      const recipe = this.potionRecipes[recipeName];
      this.userFunctions.set(`craft_${recipeName}`, recipe);
      this.addLog(`📝 ${recipeName}のレシピ関数を定義しました！`);
      this.addLog(`材料: ${recipe.join(', ')}`);
    } else {
      this.addLog(`❌ 不明なレシピ: ${recipeName}`);
    }
  }

  callRecipe(recipeName) {
    const functionName = `craft_${recipeName}`;
    if (this.userFunctions.has(functionName)) {
      this.addLog(`🔧 ${recipeName}レシピ関数を実行！`);
      this.craftPotion(recipeName);
      
      // 関数使用回数をカウント
      const currentCount = this.functionUsageCount.get(functionName) || 0;
      this.functionUsageCount.set(functionName, currentCount + 1);
      this.calculateEfficiency();
    } else {
      this.addLog(`❌ ${recipeName}のレシピ関数が定義されていません！`);
    }
  }

  craftPotion(potionType) {
    if (!this.potionRecipes[potionType]) {
      this.addLog(`❌ 不明な薬: ${potionType}`);
      return;
    }
    
    const recipe = this.potionRecipes[potionType];
    
    // 材料チェック
    for (const material of recipe) {
      if (this.materials[material] < 1) {
        this.addLog(`❌ ${material}が不足しています！`);
        return;
      }
    }
    
    // 材料消費
    for (const material of recipe) {
      this.materials[material]--;
    }
    
    // 薬作成
    this.potions[potionType]++;
    this.variables.potions_made++;
    
    this.addLog(`✅ ${potionType}を合成しました！`);
    this.materialsText.setText(this.getMaterialsDisplay());
    this.potionsText.setText(this.getPotionsDisplay());
    this.updateVariableDisplay();
  }

  usePotion(potionType) {
    if (this.potions[potionType] < 1) {
      this.addLog(`❌ ${potionType}がありません！`);
      return;
    }
    
    this.potions[potionType]--;
    
    switch (potionType) {
      case 'antidote':
        this.statusEffects.poison.active = false;
        this.statusEffects.poison.duration = 0;
        this.addLog('💚 解毒薬使用！毒が治りました！');
        break;
      case 'healing_potion':
        const healAmount = 25;
        const newHP = Math.min(80, this.player.getHP() + healAmount);
        this.player.setHP(newHP);
        this.addLog(`💚 回復薬使用！HP ${healAmount} 回復！`);
        break;
      case 'resist_potion':
        this.statusEffects.weakness.active = false;
        this.statusEffects.confusion.active = false;
        this.addLog('🛡️ 耐性薬使用！状態異常に耐性獲得！');
        break;
      case 'cure_all':
        Object.keys(this.statusEffects).forEach(effect => {
          this.statusEffects[effect].active = false;
          this.statusEffects[effect].duration = 0;
        });
        const fullHeal = 40;
        const fullHP = Math.min(80, this.player.getHP() + fullHeal);
        this.player.setHP(fullHP);
        this.addLog('✨ 万能薬使用！全状態異常治癒＆大回復！');
        break;
    }
    
    this.potionsText.setText(this.getPotionsDisplay());
    this.updateStatusDisplay();
    this.updateHP(this.player.getHP(), this.enemy.getHP());
  }

  calculateEfficiency() {
    const totalCalls = Array.from(this.functionUsageCount.values()).reduce((sum, count) => sum + count, 0);
    const totalPotions = this.variables.potions_made;
    
    this.variables.function_efficiency = totalPotions > 0 ? Math.floor((totalCalls / totalPotions) * 100) : 0;
    this.updateVariableDisplay();
  }

  updateStatusDisplay() {
    const activeEffects = Object.keys(this.statusEffects).filter(effect => this.statusEffects[effect].active);
    
    if (activeEffects.length === 0) {
      this.statusText.setText('ステータス: 正常');
      this.statusText.setFill('#00ff00');
    } else {
      this.statusText.setText(`ステータス: ${activeEffects.join(', ')}`);
      this.statusText.setFill('#ff0000');
    }
    
    this.variables.poison_active = this.statusEffects.poison.active;
    this.variables.weakness_active = this.statusEffects.weakness.active;
    this.updateVariableDisplay();
  }

  applyStatusEffect(effectType) {
    this.statusEffects[effectType].active = true;
    this.statusEffects[effectType].duration = 3;
    
    this.addLog(`💀 ${effectType}状態になりました！`);
    this.updateStatusDisplay();
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    // 状態異常ダメージの処理
    let statusDamage = 0;
    if (this.statusEffects.poison.active) {
      statusDamage += this.statusEffects.poison.damage;
    }
    if (this.statusEffects.plague.active) {
      statusDamage += this.statusEffects.plague.damage;
    }
    
    // 通常攻撃
    let damage = 15;
    if (this.statusEffects.weakness.active) {
      damage = Math.floor(damage * this.statusEffects.weakness.effect);
    }
    
    const attacks = ['疫病の瘴気', '感染の針', '病魔の一撃'];
    const attackName = attacks[Math.floor(Math.random() * attacks.length)];
    
    // 新しい状態異常付与の判定
    if (Math.random() < 0.3) {
      const effects = ['poison', 'weakness', 'confusion'];
      const randomEffect = effects[Math.floor(Math.random() * effects.length)];
      this.applyStatusEffect(randomEffect);
    }
    
    const totalDamage = damage + statusDamage;
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName('プレーグドクター');
    this.enemy.displayAttack(attackName, totalDamage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - totalDamage);
    this.player.setHP(newPlayerHP);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }
}
