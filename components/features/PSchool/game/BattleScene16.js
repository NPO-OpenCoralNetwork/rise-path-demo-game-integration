import { BattleScene } from './battle.js';

// ステージ16「カウンターアタック」用のバトルシーン
export class BattleScene16 extends BattleScene {
  constructor() {
    super({ key: 'Stage16Battle' });
    this.settings = {
      background: 'crystalcavern',
      enemy: 'mirrorknight',
      stageNumber: 16
    };
    
    // ミラーナイト専用の状態管理
    this.mirrorState = {
      isCounterActive: false,
      counterDuration: 0,
      counterCooldown: 0,
      maxCounterDuration: 3000,
      minCooldown: 2000,
      maxCooldown: 5000,
      reflectedDamage: 0,
      totalReflections: 0,
      vulnerablePhase: false,
      stance: 'DEFENSIVE'
    };

    // 変数管理システム
    this.variables = {
      counter_state: false,
      safe_to_attack: true,
      reflection_count: 0,
      patience_counter: 0,
      timing_score: 0,
      enemy_stance: 'DEFENSIVE'
    };
  }

  create() {
    super.create();
    
    // ステージ16の設定
    this.setupStageCommon({
      backgroundColor: 0x4169E1, // クリスタル洞窟の青色背景
      enemyTint: 0xC0C0C0, // ミラーナイトの銀色
      enemyHp: 90,
      startMessage: `ステージ16「カウンターアタック」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'check_counter', 'wait_for_opening', 'timing_attack', 'if_condition', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createMirrorEffect();
    this.setupCounterSystem();
    this.startCounterCycle();
  }

  createMirrorEffect() {
    // 鏡の反射エフェクト
    const mirrors = this.add.graphics();
    for (let i = 0; i < 8; i++) {
      const x = this.scale.width * 0.7 + Math.cos(i * Math.PI / 4) * 50;
      const y = this.scale.height * 0.4 + Math.sin(i * Math.PI / 4) * 50;
      mirrors.lineStyle(2, 0xFFFFFF, 0.8);
      mirrors.strokeRect(x - 10, y - 10, 20, 20);
      
      this.tweens.add({
        targets: mirrors,
        alpha: 0.3,
        duration: 1500,
        repeat: -1,
        yoyo: true,
        delay: i * 200
      });
    }
  }

  setupCounterSystem() {
    // カウンターシステムの初期化
    this.counterTexts = {
      status: this.add.text(10, 150, 'カウンター: 非活性', {
        fontSize: '16px',
        fill: '#00ff00'
      }),
      stance: this.add.text(10, 170, '構え: 防御', {
        fontSize: '16px',
        fill: '#C0C0C0'
      }),
      timing: this.add.text(10, 190, 'タイミング: 安全', {
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
        fill: '#4169E1'
      });
    });
  }

  startCounterCycle() {
    // カウンターサイクルを開始
    this.scheduleNextCounter();
  }

  scheduleNextCounter() {
    const cooldown = this.mirrorState.minCooldown + 
      Math.random() * (this.mirrorState.maxCooldown - this.mirrorState.minCooldown);
    
    this.time.delayedCall(cooldown, () => {
      this.activateCounter();
    });
  }

  activateCounter() {
    this.mirrorState.isCounterActive = true;
    this.mirrorState.stance = 'COUNTER';
    this.variables.counter_state = true;
    this.variables.safe_to_attack = false;
    this.variables.enemy_stance = 'COUNTER';
    
    this.counterTexts.status.setText('カウンター: 活性');
    this.counterTexts.status.setFill('#ff0000');
    this.counterTexts.stance.setText('構え: カウンター');
    this.counterTexts.stance.setFill('#ff4500');
    this.counterTexts.timing.setText('タイミング: 危険');
    this.counterTexts.timing.setFill('#ff0000');
    
    this.addLog('⚡ ミラーナイトがカウンター状態になりました！攻撃は危険です！');
    this.updateVariableDisplay();
    
    // カウンター状態を一定時間後に解除
    this.time.delayedCall(this.mirrorState.maxCounterDuration, () => {
      this.deactivateCounter();
    });
  }

  deactivateCounter() {
    this.mirrorState.isCounterActive = false;
    this.mirrorState.vulnerablePhase = true;
    this.mirrorState.stance = 'VULNERABLE';
    this.variables.counter_state = false;
    this.variables.safe_to_attack = true;
    this.variables.enemy_stance = 'VULNERABLE';
    
    this.counterTexts.status.setText('カウンター: 非活性');
    this.counterTexts.status.setFill('#00ff00');
    this.counterTexts.stance.setText('構え: 隙あり');
    this.counterTexts.stance.setFill('#ffff00');
    this.counterTexts.timing.setText('タイミング: 絶好機');
    this.counterTexts.timing.setFill('#00ff00');
    
    this.addLog('✨ ミラーナイトに隙ができました！今が攻撃のチャンスです！');
    this.updateVariableDisplay();
    
    // 隙のある状態を短時間で終了
    this.time.delayedCall(2000, () => {
      this.returnToDefensive();
    });
  }

  returnToDefensive() {
    this.mirrorState.vulnerablePhase = false;
    this.mirrorState.stance = 'DEFENSIVE';
    this.variables.enemy_stance = 'DEFENSIVE';
    
    this.counterTexts.stance.setText('構え: 防御');
    this.counterTexts.stance.setFill('#C0C0C0');
    this.counterTexts.timing.setText('タイミング: 安全');
    
    this.updateVariableDisplay();
    this.scheduleNextCounter(); // 次のカウンターをスケジュール
  }

  updateVariableDisplay() {
    Object.keys(this.variables).forEach(varName => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  checkCounter() {
    this.addLog(`🔍 カウンター状態チェック: ${this.mirrorState.isCounterActive ? '活性' : '非活性'}`);
    this.addLog(`🎯 現在の構え: ${this.mirrorState.stance}`);
    
    this.variables.counter_state = this.mirrorState.isCounterActive;
    this.variables.enemy_stance = this.mirrorState.stance;
    this.updateVariableDisplay();
  }

  waitForOpening() {
    this.variables.patience_counter++;
    this.addLog(`⏳ 攻撃機会を待機中... (忍耐: ${this.variables.patience_counter})`);
    
    if (this.mirrorState.vulnerablePhase) {
      this.addLog('✨ 絶好の機会です！今すぐ攻撃しましょう！');
      this.variables.timing_score += 10;
    }
    
    this.updateVariableDisplay();
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  timingAttack() {
    if (this.mirrorState.isCounterActive) {
      // カウンター中に攻撃 - 跳ね返される
      const reflectedDamage = 25;
      this.mirrorState.reflectedDamage += reflectedDamage;
      this.mirrorState.totalReflections++;
      this.variables.reflection_count++;
      
      this.addLog('❌ カウンター中に攻撃！跳ね返されました！');
      this.addLog(`💥 反射ダメージ: ${reflectedDamage}`);
      
      const newPlayerHP = Math.max(0, this.player.getHP() - reflectedDamage);
      this.player.setHP(newPlayerHP);
      this.updateHP(this.player.getHP(), this.enemy.getHP());
      
      if (this.player.getHP() <= 0) {
        this.playerLose();
        return;
      }
    } else {
      // 安全な時に攻撃
      let damage = 20;
      if (this.mirrorState.vulnerablePhase) {
        damage = 35; // 隙がある時は大ダメージ
        this.variables.timing_score += 20;
        this.addLog('🎯 完璧なタイミング攻撃！大ダメージ！');
      } else {
        this.addLog('⚔️ 通常攻撃！');
      }
      
      const newHP = Math.max(0, this.enemy.getHP() - damage);
      this.enemy.setHP(newHP);
      this.addLog(`攻撃！ミラーナイトに ${damage} のダメージ！`);
      
      this.updateHP(this.player.getHP(), this.enemy.getHP());
      
      if (this.enemy.getHP() <= 0) {
        this.playerWin();
        return;
      }
    }
    
    this.updateVariableDisplay();
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    const attacks = ['ミラーブレード', '鏡像斬り', 'リフレクションスラッシュ'];
    const attackName = attacks[Math.floor(Math.random() * attacks.length)];
    const damage = 12 + Math.floor(Math.random() * 8);
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName('ミラーナイト');
    this.enemy.displayAttack(attackName, damage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }
}
