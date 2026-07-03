import { BattleScene } from './battle.js';

// ステージ20「初級最終ボス」用のバトルシーン
export class BattleScene20 extends BattleScene {
  constructor() {
    super({ key: 'Stage20Battle' });
    this.settings = {
      background: 'digital_void',
      enemy: 'codeeater',
      stageNumber: 20
    };
    
    // コードイーター専用の状態管理
    this.bossState = {
      phase: 1,
      maxPhase: 3,
      codeDisruptionLevel: 0,
      disabledBlocks: [],
      corruptedFunctions: [],
      syntaxErrors: 0,
      adaptiveDefense: false
    };

    // プログラミング概念システム
    this.programmingConcepts = {
      variables: { mastered: false, usage: 0 },
      loops: { mastered: false, usage: 0 },
      conditions: { mastered: false, usage: 0 },
      functions: { mastered: false, usage: 0 }
    };

    // 変数管理システム
    this.variables = {
      boss_phase: 1,
      disruption_level: 0,
      concepts_mastered: 0,
      survival_score: 100,
      final_challenge: false
    };

    // 最終ボス専用関数
    this.bossDefeatFunctions = new Map();
  }

  create() {
    super.create();
    
    // ステージ20の設定
    this.setupStageCommon({
      backgroundColor: 0x0A0A2E, // デジタル空間の深い青色背景
      enemyTint: 0xFF0040, // コードイーターの赤色
      enemyHp: 200,
      startMessage: `ステージ20「初級最終ボス」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'debug_code', 'restore_function', 'adaptive_strategy', 'master_concept', 'final_strike', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createDigitalEffect();
    this.setupBossSystem();
    this.startPhaseSystem();
  }

  createDigitalEffect() {
    // デジタル空間のエフェクト（データストリーム）
    const dataStream = this.add.graphics();
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * this.scale.width;
      const y = Math.random() * this.scale.height;
      dataStream.fillStyle(0x00FF41, 0.6);
      dataStream.fillRect(x, y, 2, 20);
      
      this.tweens.add({
        targets: dataStream,
        y: y + this.scale.height,
        alpha: 0,
        duration: 3000 + i * 200,
        repeat: -1,
        delay: i * 200
      });
    }
  }

  setupBossSystem() {
    // ボスシステムの初期化
    this.bossTexts = {
      phase: this.add.text(10, 150, `フェーズ: ${this.bossState.phase}/${this.bossState.maxPhase}`, {
        fontSize: '16px',
        fill: '#FF0040'
      }),
      disruption: this.add.text(10, 170, `無効化レベル: ${this.bossState.codeDisruptionLevel}`, {
        fontSize: '16px',
        fill: '#ffff00'
      }),
      concepts: this.add.text(10, 190, this.getConceptsDisplay(), {
        fontSize: '14px',
        fill: '#00FF41'
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

  getConceptsDisplay() {
    const mastered = Object.values(this.programmingConcepts).filter(concept => concept.mastered).length;
    return `習得概念: ${mastered}/4`;
  }

  updateVariableDisplay() {
    Object.keys(this.variables).forEach(varName => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  startPhaseSystem() {
    // フェーズシステムの開始
    this.addLog(`🔥 フェーズ${this.bossState.phase}開始！コードイーターが本気を出します！`);
  }

  masterConcept(conceptType) {
    if (this.programmingConcepts[conceptType]) {
      this.programmingConcepts[conceptType].mastered = true;
      this.programmingConcepts[conceptType].usage++;
      
      const masteredCount = Object.values(this.programmingConcepts).filter(c => c.mastered).length;
      this.variables.concepts_mastered = masteredCount;
      
      this.addLog(`🧠 ${conceptType}の概念をマスターしました！`);
      this.bossTexts.concepts.setText(this.getConceptsDisplay());
      
      if (masteredCount >= 4) {
        this.addLog('🌟 全ての概念をマスター！最終攻撃が使用可能になりました！');
        this.variables.final_challenge = true;
      }
      
      this.updateVariableDisplay();
    }
  }

  debugCode() {
    if (this.bossState.codeDisruptionLevel > 0) {
      this.bossState.codeDisruptionLevel--;
      this.bossState.disabledBlocks.pop();
      this.addLog('🔧 コードをデバッグしました！無効化を一部解除！');
      this.bossTexts.disruption.setText(`無効化レベル: ${this.bossState.codeDisruptionLevel}`);
    } else {
      this.addLog('✅ コードに問題はありません！');
    }
  }

  restoreFunction() {
    if (this.bossState.corruptedFunctions.length > 0) {
      const restored = this.bossState.corruptedFunctions.pop();
      this.addLog(`🔄 関数「${restored}」を復旧しました！`);
    } else {
      this.addLog('✅ 全ての関数が正常に動作しています！');
    }
  }

  adaptiveStrategy() {
    // 適応戦略 - ボスの状態に応じて最適な行動を選択
    const strategy = this.calculateOptimalStrategy();
    this.addLog(`🎯 適応戦略を実行！戦略: ${strategy}`);
    
    switch (strategy) {
      case 'aggressive':
        this.executeAggressiveStrategy();
        break;
      case 'defensive':
        this.executeDefensiveStrategy();
        break;
      case 'balanced':
        this.executeBalancedStrategy();
        break;
    }
  }

  calculateOptimalStrategy() {
    const playerHP = this.player.getHP();
    const bossHP = this.enemy.getHP();
    const disruptionLevel = this.bossState.codeDisruptionLevel;
    
    if (playerHP < 30 || disruptionLevel > 3) {
      return 'defensive';
    } else if (bossHP < 50 && this.variables.concepts_mastered >= 3) {
      return 'aggressive';
    } else {
      return 'balanced';
    }
  }

  executeAggressiveStrategy() {
    const damage = 35;
    const newHP = Math.max(0, this.enemy.getHP() - damage);
    this.enemy.setHP(newHP);
    this.addLog(`⚔️ 攻撃的戦略！大ダメージ: ${damage}！`);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
  }

  executeDefensiveStrategy() {
    const healAmount = 25;
    const newHP = Math.min(100, this.player.getHP() + healAmount);
    this.player.setHP(newHP);
    this.addLog(`🛡️ 防御的戦略！回復: ${healAmount}！`);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
  }

  executeBalancedStrategy() {
    const damage = 20;
    const healAmount = 10;
    const newEnemyHP = Math.max(0, this.enemy.getHP() - damage);
    const newPlayerHP = Math.min(100, this.player.getHP() + healAmount);
    
    this.enemy.setHP(newEnemyHP);
    this.player.setHP(newPlayerHP);
    this.addLog(`⚖️ バランス戦略！攻撃: ${damage} & 回復: ${healAmount}！`);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
  }

  finalStrike() {
    if (this.variables.concepts_mastered >= 4) {
      const finalDamage = 80;
      const newHP = Math.max(0, this.enemy.getHP() - finalDamage);
      this.enemy.setHP(newHP);
      
      this.addLog('🌟 ファイナルストライク！全概念の力を結集した必殺技！');
      this.addLog(`💥 超絶大ダメージ: ${finalDamage}！`);
      
      this.updateHP(this.player.getHP(), this.enemy.getHP());
      
      if (this.enemy.getHP() <= 0) {
        this.playerWin();
        return;
      }
    } else {
      this.addLog('❌ ファイナルストライクには全概念の習得が必要です！');
    }
    
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  checkPhaseTransition() {
    const currentHP = this.enemy.getHP();
    const maxHP = 200;
    
    if (currentHP <= maxHP * 0.66 && this.bossState.phase === 1) {
      this.transitionToPhase(2);
    } else if (currentHP <= maxHP * 0.33 && this.bossState.phase === 2) {
      this.transitionToPhase(3);
    }
  }

  transitionToPhase(newPhase) {
    this.bossState.phase = newPhase;
    this.variables.boss_phase = newPhase;
    this.bossTexts.phase.setText(`フェーズ: ${newPhase}/${this.bossState.maxPhase}`);
    
    this.cameras.main.flash(1000, 100, 0, 50);
    
    switch (newPhase) {
      case 2:
        this.addLog('🔥 フェーズ2移行！コードイーターが本気を出します！');
        this.bossState.codeDisruptionLevel += 2;
        break;
      case 3:
        this.addLog('⚡ 最終フェーズ！コードイーターが狂乱状態になりました！');
        this.bossState.codeDisruptionLevel += 3;
        this.bossState.adaptiveDefense = true;
        break;
    }
    
    this.bossTexts.disruption.setText(`無効化レベル: ${this.bossState.codeDisruptionLevel}`);
    this.updateVariableDisplay();
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    this.checkPhaseTransition();
    
    // フェーズ別攻撃パターン
    let damage = 15;
    let actionName = 'コード攻撃';
    
    switch (this.bossState.phase) {
      case 1:
        damage = 12;
        actionName = 'シンタックスエラー';
        break;
      case 2:
        damage = 18;
        actionName = 'ロジック破壊';
        this.disableRandomBlock();
        break;
      case 3:
        damage = 25;
        actionName = 'コード無効化';
        this.corruptRandomFunction();
        break;
    }
    
    // コード無効化攻撃
    if (Math.random() < 0.3) {
      this.bossState.codeDisruptionLevel++;
      this.variables.disruption_level = this.bossState.codeDisruptionLevel;
      this.bossTexts.disruption.setText(`無効化レベル: ${this.bossState.codeDisruptionLevel}`);
      this.addLog('💀 コードイーターがプログラムを無効化しました！');
    }
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName('コードイーター');
    this.enemy.displayAttack(actionName, damage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    this.variables.survival_score = Math.floor((this.player.getHP() / 100) * 100);
    
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    this.updateVariableDisplay();
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }

  disableRandomBlock() {
    const blocks = ['attack', 'heal', 'loop', 'condition'];
    const randomBlock = blocks[Math.floor(Math.random() * blocks.length)];
    
    if (!this.bossState.disabledBlocks.includes(randomBlock)) {
      this.bossState.disabledBlocks.push(randomBlock);
      this.addLog(`🚫 ${randomBlock}ブロックが無効化されました！`);
    }
  }

  corruptRandomFunction() {
    const functions = ['attack_function', 'heal_function', 'combo_function'];
    const randomFunction = functions[Math.floor(Math.random() * functions.length)];
    
    if (!this.bossState.corruptedFunctions.includes(randomFunction)) {
      this.bossState.corruptedFunctions.push(randomFunction);
      this.addLog(`💥 ${randomFunction}が破損しました！`);
    }
  }

  playerWin() {
    super.playerWin();
    this.addLog('🎉 初級編クリア！おめでとうございます！');
    this.addLog('🌟 中級編への道が開かれました！');
  }
}
