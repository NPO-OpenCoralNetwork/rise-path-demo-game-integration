import { BattleScene } from './battle.js';

// ステージ19「武器の強化」用のバトルシーン
export class BattleScene19 extends BattleScene {
  constructor() {
    super({ key: 'Stage19Battle' });
    this.settings = {
      background: 'armory',
      enemy: 'armsmaster',
      stageNumber: 19
    };
    
    // 武器強化システム
    this.weaponSystem = {
      currentWeapon: 'sword',
      weaponLevel: 1,
      maxLevel: 5,
      materials: {
        iron: 5,
        crystal: 3,
        essence: 2
      },
      weapons: {
        sword: { level: 1, damage: 20, cost: { iron: 2, crystal: 1 } },
        axe: { level: 1, damage: 25, cost: { iron: 3, crystal: 1 } },
        staff: { level: 1, damage: 15, cost: { crystal: 2, essence: 1 } }
      }
    };
    
    // アームズマスター専用の状態
    this.masterState = {
      currentWeapon: 'sword',
      weaponCycle: ['sword', 'axe', 'staff'],
      swapCooldown: 0,
      multiStrike: false,
      weaponThrow: false
    };

    // 変数管理システム
    this.variables = {
      weapon_level: 1,
      damage_output: 20,
      materials_total: 10,
      upgrades_made: 0,
      combat_effectiveness: 0
    };

    // 関数システム
    this.weaponFunctions = new Map();
  }

  create() {
    super.create();
    
    // ステージ19の設定
    this.setupStageCommon({
      backgroundColor: 0x4A4A4A, // 武器庫の灰色背景
      enemyTint: 0x8B4513, // アームズマスターの茶色
      enemyHp: 120,
      startMessage: `ステージ19「武器の強化」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'upgrade_weapon', 'switch_weapon', 'craft_function', 'use_materials', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createArmoryEffect();
    this.setupWeaponUI();
  }

  createArmoryEffect() {
    // 武器庫のエフェクト（武器の光）
    const weapons = this.add.graphics();
    for (let i = 0; i < 6; i++) {
      const x = 100 + i * 120;
      const y = 150;
      weapons.lineStyle(3, 0xFFD700, 0.8);
      weapons.strokeRect(x - 15, y - 30, 30, 60);
      
      this.tweens.add({
        targets: weapons,
        alpha: 0.3,
        duration: 2000,
        repeat: -1,
        yoyo: true,
        delay: i * 300
      });
    }
  }

  setupWeaponUI() {
    // 武器システムの初期化
    this.weaponTexts = {
      current: this.add.text(10, 150, `現在武器: ${this.weaponSystem.currentWeapon} Lv.${this.weaponSystem.weaponLevel}`, {
        fontSize: '16px',
        fill: '#FFD700'
      }),
      damage: this.add.text(10, 170, `攻撃力: ${this.getCurrentDamage()}`, {
        fontSize: '16px',
        fill: '#FF4500'
      }),
      materials: this.add.text(10, 190, this.getMaterialsDisplay(), {
        fontSize: '14px',
        fill: '#8B4513'
      })
    };
    
    this.createVariableDisplay();
  }

  createVariableDisplay() {
    // 変数表示UIの作成
    this.variableTexts = {};
    let yOffset = 220;
    
    Object.keys(this.variables).forEach((varName, index) => {
      this.variableTexts[varName] = this.add.text(10, yOffset + index * 20, 
        `${varName}: ${this.variables[varName]}`, {
        fontSize: '14px',
        fill: '#9370DB'
      });
    });
  }

  getCurrentDamage() {
    const weapon = this.weaponSystem.weapons[this.weaponSystem.currentWeapon];
    return weapon.damage + (weapon.level - 1) * 5;
  }

  getMaterialsDisplay() {
    return `材料: 鉄${this.weaponSystem.materials.iron} 水晶${this.weaponSystem.materials.crystal} エッセンス${this.weaponSystem.materials.essence}`;
  }

  updateVariableDisplay() {
    Object.keys(this.variables).forEach(varName => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  upgradeWeapon() {
    const weapon = this.weaponSystem.weapons[this.weaponSystem.currentWeapon];
    const cost = weapon.cost;
    
    if (weapon.level >= this.weaponSystem.maxLevel) {
      this.addLog('⚡ 武器は最大レベルです！');
      return;
    }
    
    // 材料チェック
    for (const [material, amount] of Object.entries(cost)) {
      if (this.weaponSystem.materials[material] < amount) {
        this.addLog(`❌ ${material}が不足しています！（必要: ${amount}）`);
        return;
      }
    }
    
    // 材料消費
    for (const [material, amount] of Object.entries(cost)) {
      this.weaponSystem.materials[material] -= amount;
    }
    
    // 武器レベルアップ
    weapon.level++;
    this.variables.upgrades_made++;
    this.variables.weapon_level = weapon.level;
    this.variables.damage_output = this.getCurrentDamage();
    
    this.addLog(`⚡ ${this.weaponSystem.currentWeapon}をLv.${weapon.level}に強化しました！`);
    this.updateWeaponDisplay();
  }

  switchWeapon(weaponType) {
    if (this.weaponSystem.weapons[weaponType]) {
      this.weaponSystem.currentWeapon = weaponType;
      this.variables.weapon_level = this.weaponSystem.weapons[weaponType].level;
      this.variables.damage_output = this.getCurrentDamage();
      
      this.addLog(`🔄 武器を${weaponType}に切り替えました！`);
      this.updateWeaponDisplay();
    } else {
      this.addLog(`❌ 不明な武器: ${weaponType}`);
    }
  }

  craftFunction(functionName, actions) {
    this.weaponFunctions.set(functionName, actions);
    this.addLog(`🔧 武器強化関数「${functionName}」を定義しました！`);
    
    if (functionName === 'fullUpgrade') {
      this.addLog('✅ 完全強化関数が完成！全武器を効率的に強化できます！');
    }
  }

  useMaterials(operation) {
    switch (operation) {
      case 'gather':
        this.weaponSystem.materials.iron += 2;
        this.weaponSystem.materials.crystal += 1;
        this.addLog('⛏️ 材料を採集しました！');
        break;
      case 'refine':
        if (this.weaponSystem.materials.iron >= 3) {
          this.weaponSystem.materials.iron -= 3;
          this.weaponSystem.materials.crystal += 2;
          this.addLog('🔥 鉄を精製して水晶を作成！');
        } else {
          this.addLog('❌ 鉄が不足しています！');
        }
        break;
      case 'synthesize':
        if (this.weaponSystem.materials.crystal >= 2) {
          this.weaponSystem.materials.crystal -= 2;
          this.weaponSystem.materials.essence += 1;
          this.addLog('✨ 水晶を合成してエッセンスを作成！');
        } else {
          this.addLog('❌ 水晶が不足しています！');
        }
        break;
    }
    
    const total = Object.values(this.weaponSystem.materials).reduce((sum, amount) => sum + amount, 0);
    this.variables.materials_total = total;
    this.updateWeaponDisplay();
  }

  updateWeaponDisplay() {
    this.weaponTexts.current.setText(`現在武器: ${this.weaponSystem.currentWeapon} Lv.${this.weaponSystem.weapons[this.weaponSystem.currentWeapon].level}`);
    this.weaponTexts.damage.setText(`攻撃力: ${this.getCurrentDamage()}`);
    this.weaponTexts.materials.setText(this.getMaterialsDisplay());
    
    this.calculateEffectiveness();
    this.updateVariableDisplay();
  }

  calculateEffectiveness() {
    const totalLevels = Object.values(this.weaponSystem.weapons).reduce((sum, weapon) => sum + weapon.level, 0);
    this.variables.combat_effectiveness = Math.floor((totalLevels / 15) * 100); // 最大15レベル(3武器×5レベル)
  }

  playerAttack() {
    const damage = this.getCurrentDamage();
    const weapon = this.weaponSystem.currentWeapon;
    
    // 武器タイプ別の特殊効果
    let finalDamage = damage;
    let effectMessage = '';
    
    switch (weapon) {
      case 'sword':
        if (Math.random() < 0.2) {
          finalDamage = Math.floor(damage * 1.5);
          effectMessage = ' (クリティカル！)';
        }
        break;
      case 'axe':
        finalDamage = Math.floor(damage * 1.2); // 常に高ダメージ
        effectMessage = ' (重撃！)';
        break;
      case 'staff':
        // 魔法ダメージは防御無視
        effectMessage = ' (魔法攻撃！)';
        break;
    }
    
    const newHP = Math.max(0, this.enemy.getHP() - finalDamage);
    this.enemy.setHP(newHP);
    
    this.addLog(`⚔️ ${weapon}で攻撃！${finalDamage}ダメージ！${effectMessage}`);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.enemy.getHP() <= 0) {
      this.playerWin();
      return;
    }
    
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    // アームズマスターの武器切り替え
    if (Math.random() < 0.3) {
      const weapons = this.masterState.weaponCycle;
      const currentIndex = weapons.indexOf(this.masterState.currentWeapon);
      const nextIndex = (currentIndex + 1) % weapons.length;
      this.masterState.currentWeapon = weapons[nextIndex];
      this.addLog(`🔄 アームズマスターが${this.masterState.currentWeapon}に切り替えました！`);
    }
    
    // 武器別攻撃
    let damage = 18;
    let actionName = '';
    
    switch (this.masterState.currentWeapon) {
      case 'sword':
        damage = 15;
        actionName = '剣術';
        break;
      case 'axe':
        damage = 22;
        actionName = '重斧撃';
        break;
      case 'staff':
        damage = 20;
        actionName = '魔法攻撃';
        break;
    }
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName('アームズマスター');
    this.enemy.displayAttack(actionName, damage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }
}
