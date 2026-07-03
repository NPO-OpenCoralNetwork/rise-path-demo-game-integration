import { BattleScene } from './battle.js';

// ステージ17「初めての関数」用のバトルシーン
export class BattleScene17 extends BattleScene {
  constructor() {
    super({ key: 'Stage17Battle' });
    this.settings = {
      background: 'graveyard',
      enemy: 'skeletonarmy',
      stageNumber: 17
    };
    
    // スケルトンアーミー専用の状態管理
    this.armyState = {
      totalSkeletons: 6,
      activeSkeletons: [],
      defeatedCount: 0,
      waveNumber: 1,
      maxWaves: 3,
      skeletonsPerWave: 2,
      spawnDelay: 2000,
      lastSpawnTime: 0,
      needsFunction: true,
      functionUsageCount: 0,
      efficiency: 0
    };

    // 変数管理システム
    this.variables = {
      skeleton_count: 6,
      wave_number: 1,
      defeated_count: 0,
      health_low: false,
      function_calls: 0,
      battle_efficiency: 0
    };

    // カスタム関数定義
    this.customFunctions = {};
  }

  create() {
    super.create();
    
    // ステージ17の設定
    this.setupStageCommon({
      backgroundColor: 0x2F2F2F, // 墓地の暗いグレー背景
      enemyTint: 0xFFFFFF, // スケルトンの骨色
      enemyHp: 90, // 総合HP（6体×15HP）
      startMessage: `ステージ17「初めての関数」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'define_function', 'call_function', 'attack_and_heal', 'check_health', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createGraveyardEffect();
    this.setupArmySystem();
    this.initializeSkeletons();
  }

  createGraveyardEffect() {
    // 墓地のエフェクト（墓石と霧）
    const fog = this.add.graphics();
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * this.scale.width;
      const y = this.scale.height * 0.8 + Math.random() * 80;
      fog.fillStyle(0x888888, 0.3);
      fog.fillCircle(x, y, 15);
      
      this.tweens.add({
        targets: fog,
        x: x + 50,
        alpha: 0.1,
        duration: 4000,
        repeat: -1,
        yoyo: true,
        delay: i * 400
      });
    }
  }

  setupArmySystem() {
    // アーミーシステムの初期化
    this.armyTexts = {
      count: this.add.text(10, 150, `スケルトン: ${this.armyState.totalSkeletons}体`, {
        fontSize: '16px',
        fill: '#FFFFff'
      }),
      wave: this.add.text(10, 170, `ウェーブ: ${this.armyState.waveNumber}/${this.armyState.maxWaves}`, {
        fontSize: '16px',
        fill: '#ffff00'
      }),
      efficiency: this.add.text(10, 190, '効率: 0%', {
        fontSize: '16px',
        fill: '#00ff00'
      })
    };
    
    this.createVariableDisplay();
  }

  createVariableDisplay() {
    // 変数表示UIの作成
    this.variableTexts = {};
    let yOffset = 210;
    
    Object.keys(this.variables).forEach((varName, index) => {
      this.variableTexts[varName] = this.add.text(10, yOffset + index * 20, 
        `${varName}: ${this.variables[varName]}`, {
        fontSize: '14px',
        fill: '#9370DB'
      });
    });
  }

  initializeSkeletons() {
    // 最初の波のスケルトンを生成
    for (let i = 0; i < this.armyState.skeletonsPerWave; i++) {
      this.spawnSkeleton();
    }
  }

  spawnSkeleton() {
    if (this.armyState.activeSkeletons.length < this.armyState.totalSkeletons) {
      const skeleton = {
        id: this.armyState.activeSkeletons.length + 1,
        hp: 15,
        maxHp: 15,
        active: true
      };
      
      this.armyState.activeSkeletons.push(skeleton);
      this.addLog(`💀 スケルトン${skeleton.id}が現れました！`);
      this.updateArmyDisplay();
    }
  }

  updateArmyDisplay() {
    const remaining = this.armyState.totalSkeletons - this.armyState.defeatedCount;
    this.armyTexts.count.setText(`スケルトン: ${remaining}体`);
    this.armyTexts.wave.setText(`ウェーブ: ${this.armyState.waveNumber}/${this.armyState.maxWaves}`);
    
    this.variables.skeleton_count = remaining;
    this.variables.wave_number = this.armyState.waveNumber;
    this.variables.defeated_count = this.armyState.defeatedCount;
    this.updateVariableDisplay();
  }

  updateVariableDisplay() {
    Object.keys(this.variables).forEach(varName => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  defineFunction(functionName, actions) {
    this.customFunctions[functionName] = actions;
    this.addLog(`📝 関数「${functionName}」を定義しました！`);
    
    if (functionName === 'attackAndHeal') {
      this.armyState.needsFunction = false;
      this.addLog('✅ 攻撃と回復の組み合わせ関数が完成！');
    }
  }

  callFunction(functionName) {
    if (this.customFunctions[functionName]) {
      this.armyState.functionUsageCount++;
      this.variables.function_calls++;
      
      this.addLog(`🔧 関数「${functionName}」を実行！`);
      
      // 関数の実行（ここでは攻撃と回復のセット）
      if (functionName === 'attackAndHeal') {
        this.executeAttackAndHeal();
      }
      
      this.updateVariableDisplay();
      this.calculateEfficiency();
    } else {
      this.addLog(`❌ 関数「${functionName}」が定義されていません！`);
    }
  }

  executeAttackAndHeal() {
    // 攻撃フェーズ
    const damage = 20;
    let target = this.armyState.activeSkeletons.find(s => s.active);
    
    if (target) {
      target.hp -= damage;
      this.addLog(`⚔️ スケルトン${target.id}に ${damage} のダメージ！`);
      
      if (target.hp <= 0) {
        target.active = false;
        this.armyState.defeatedCount++;
        this.addLog(`💀 スケルトン${target.id}を倒しました！`);
        
        // 次の波のスケルトンをスポーン
        if (this.armyState.defeatedCount % this.armyState.skeletonsPerWave === 0 && 
            this.armyState.waveNumber < this.armyState.maxWaves) {
          this.armyState.waveNumber++;
          this.spawnSkeleton();
          this.spawnSkeleton();
        }
      }
    }
    
    // 回復フェーズ
    if (this.player.getHP() < 60) {
      const healAmount = 15;
      const newHP = Math.min(80, this.player.getHP() + healAmount);
      this.player.setHP(newHP);
      this.addLog(`💚 HPを ${healAmount} 回復！`);
      this.variables.health_low = false;
    }
    
    this.updateArmyDisplay();
    this.updateHP(this.player.getHP(), this.calculateTotalEnemyHP());
    
    // 全滅チェック
    if (this.armyState.defeatedCount >= this.armyState.totalSkeletons) {
      this.playerWin();
      return;
    }
    
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  calculateTotalEnemyHP() {
    return this.armyState.activeSkeletons
      .filter(s => s.active)
      .reduce((total, s) => total + s.hp, 0);
  }

  attackAndHeal() {
    // 関数の直接実行版
    this.addLog('🔄 攻撃＆回復コンボを実行！');
    this.executeAttackAndHeal();
  }

  checkHealth() {
    const currentHP = this.player.getHP();
    this.variables.health_low = currentHP < 30;
    
    if (this.variables.health_low) {
      this.addLog('⚠️ HP低下！回復が必要です！');
    } else {
      this.addLog('💚 HP状態良好！');
    }
    
    this.updateVariableDisplay();
  }

  calculateEfficiency() {
    // 戦闘効率の計算
    const functionUsage = this.armyState.functionUsageCount;
    const totalActions = functionUsage + this.armyState.defeatedCount;
    this.armyState.efficiency = totalActions > 0 ? Math.floor((functionUsage / totalActions) * 100) : 0;
    
    this.variables.battle_efficiency = this.armyState.efficiency;
    this.armyTexts.efficiency.setText(`効率: ${this.armyState.efficiency}%`);
    
    if (this.armyState.efficiency > 70) {
      this.armyTexts.efficiency.setFill('#00ff00');
    } else if (this.armyState.efficiency > 40) {
      this.armyTexts.efficiency.setFill('#ffff00');
    } else {
      this.armyTexts.efficiency.setFill('#ff0000');
    }
    
    this.updateVariableDisplay();
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    // アクティブなスケルトンが攻撃
    const activeSkeletons = this.armyState.activeSkeletons.filter(s => s.active);
    const damage = activeSkeletons.length * 3; // スケルトン数×3ダメージ
    
    const attacks = ['骨の剣撃', 'アンデッドラッシュ', '集団突撃'];
    const attackName = attacks[Math.floor(Math.random() * attacks.length)];
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName(`スケルトンアーミー（${activeSkeletons.length}体）`);
    this.enemy.displayAttack(attackName, damage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    
    if (newPlayerHP < 30) {
      this.variables.health_low = true;
    }
    
    this.updateHP(this.player.getHP(), this.calculateTotalEnemyHP());
    this.updateVariableDisplay();
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }
}
