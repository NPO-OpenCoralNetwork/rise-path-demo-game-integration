import { BattleScene } from './battle.js';

// ステージ15「属性の有効活用」用のバトルシーン
export class BattleScene15 extends BattleScene {
  constructor() {
    super({ key: 'Stage15Battle' });
    this.settings = {
      background: 'mysticalcavern',
      enemy: 'elementalshifter',
      stageNumber: 15
    };
    
    // エレメンタルシフター専用の状態管理
    this.shifterState = {
      currentElement: 'FIRE',
      elementCycle: ['FIRE', 'WATER', 'THUNDER'],
      shiftCooldown: 0,
      shiftInterval: 8000,
      vulnerabilities: {
        'FIRE': 'WATER',
        'WATER': 'THUNDER',
        'THUNDER': 'FIRE'
      },
      resistances: {
        'FIRE': ['FIRE', 'THUNDER'],
        'WATER': ['WATER', 'FIRE'],
        'THUNDER': ['THUNDER', 'WATER']
      },
      elementColors: {
        'FIRE': 0xFF4500,
        'WATER': 0x0080FF,
        'THUNDER': 0xFFFF00
      }
    };

    // 変数管理システム
    this.variables = {
      current_element: 'FIRE',
      effective_spell: 'WATER',
      spell_effectiveness: 1.0,
      shift_counter: 0
    };
  }

  create() {
    super.create();
    
    // ステージ15の設定
    this.setupStageCommon({
      backgroundColor: 0x2F4F4F, // 神秘洞窟の暗い青緑色背景
      enemyTint: 0xFF4500, // エレメンタルシフターの初期火属性色
      enemyHp: 70,
      startMessage: `ステージ15「属性の有効活用」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'cast_fire', 'cast_water', 'cast_thunder', 'detect_element', 'if_condition', 'set_variable', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createElementalEffect();
    this.setupElementalSystem();
    this.startElementShiftTimer();
  }

  createElementalEffect() {
    // 属性エフェクト
    this.elementalAura = this.add.graphics();
    this.updateElementalAura();
    
    // 浮遊する属性オーブ
    for (let i = 0; i < 6; i++) {
      const orb = this.add.graphics();
      const x = this.scale.width * 0.7 + Math.cos(i * Math.PI / 3) * 60;
      const y = this.scale.height * 0.4 + Math.sin(i * Math.PI / 3) * 60;
      
      orb.fillStyle(this.shifterState.elementColors[this.shifterState.currentElement], 0.6);
      orb.fillCircle(x, y, 8);
      
      this.tweens.add({
        targets: orb,
        rotation: Math.PI * 2,
        duration: 3000,
        repeat: -1
      });
    }
  }

  setupElementalSystem() {
    // 属性システムの初期化
    this.elementTexts = {
      current: this.add.text(10, 150, `現在属性: ${this.shifterState.currentElement}`, {
        fontSize: '16px',
        fill: '#FF4500'
      }),
      weakness: this.add.text(10, 170, `弱点: ${this.shifterState.vulnerabilities[this.shifterState.currentElement]}`, {
        fontSize: '16px',
        fill: '#0080FF'
      }),
      timer: this.add.text(10, 190, '変化まで: 8秒', {
        fontSize: '16px',
        fill: '#FFFF00'
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

  startElementShiftTimer() {
    // 属性変化タイマー
    this.shiftTimer = this.time.addEvent({
      delay: this.shifterState.shiftInterval,
      callback: this.shiftElement,
      callbackScope: this,
      loop: true
    });
    
    // カウントダウン表示
    this.countdownTimer = this.time.addEvent({
      delay: 1000,
      callback: this.updateCountdown,
      callbackScope: this,
      loop: true
    });
  }

  updateCountdown() {
    const remaining = Math.ceil((this.shifterState.shiftInterval - this.shiftTimer.getElapsed()) / 1000);
    this.elementTexts.timer.setText(`変化まで: ${remaining}秒`);
  }

  shiftElement() {
    // 次の属性に変化
    const currentIndex = this.shifterState.elementCycle.indexOf(this.shifterState.currentElement);
    const nextIndex = (currentIndex + 1) % this.shifterState.elementCycle.length;
    this.shifterState.currentElement = this.shifterState.elementCycle[nextIndex];
    
    this.variables.shift_counter++;
    this.variables.current_element = this.shifterState.currentElement;
    this.variables.effective_spell = this.shifterState.vulnerabilities[this.shifterState.currentElement];
    
    this.updateElementalDisplay();
    this.updateElementalAura();
    
    this.addLog(`🔄 属性変化！エレメンタルシフターが${this.shifterState.currentElement}属性になりました！`);
    this.addLog(`💡 弱点: ${this.shifterState.vulnerabilities[this.shifterState.currentElement]}属性`);
  }

  updateElementalDisplay() {
    const currentElement = this.shifterState.currentElement;
    const weakness = this.shifterState.vulnerabilities[currentElement];
    const color = this.shifterState.elementColors[currentElement];
    
    this.elementTexts.current.setText(`現在属性: ${currentElement}`);
    this.elementTexts.current.setFill(`#${color.toString(16).padStart(6, '0')}`);
    
    this.elementTexts.weakness.setText(`弱点: ${weakness}`);
    
    // 敵スプライトの色も変更
    this.enemySprite.setTint(color);
    
    // 変数表示を更新
    this.updateVariableDisplay();
  }

  updateElementalAura() {
    if (this.elementalAura) {
      this.elementalAura.clear();
      const color = this.shifterState.elementColors[this.shifterState.currentElement];
      this.elementalAura.lineStyle(5, color, 0.8);
      this.elementalAura.strokeCircle(this.scale.width * 0.7, this.scale.height * 0.4, 70);
    }
  }

  updateVariableDisplay() {
    Object.keys(this.variables).forEach(varName => {
      if (this.variableTexts[varName]) {
        this.variableTexts[varName].setText(`${varName}: ${this.variables[varName]}`);
      }
    });
  }

  detectElement() {
    this.addLog(`🔍 属性検知：現在の属性は${this.shifterState.currentElement}です！`);
    this.addLog(`💡 効果的な魔法：${this.shifterState.vulnerabilities[this.shifterState.currentElement]}属性`);
    
    this.variables.current_element = this.shifterState.currentElement;
    this.variables.effective_spell = this.shifterState.vulnerabilities[this.shifterState.currentElement];
    this.updateVariableDisplay();
  }

  playerCastSpell(spellElement) {
    let damage = 20;
    let effectiveness = 1.0;
    const currentElement = this.shifterState.currentElement;
    
    // 弱点判定
    if (spellElement === this.shifterState.vulnerabilities[currentElement]) {
      effectiveness = 2.0;
      this.addLog(`🎯 弱点を突いた！${spellElement}魔法が超効果的！`);
    }
    // 耐性判定
    else if (this.shifterState.resistances[currentElement].includes(spellElement)) {
      effectiveness = 0.5;
      this.addLog(`🛡️ ${spellElement}魔法は${currentElement}属性に耐性されています！`);
    }
    
    const finalDamage = Math.floor(damage * effectiveness);
    this.variables.spell_effectiveness = effectiveness;
    
    const newHP = Math.max(0, this.enemy.getHP() - finalDamage);
    this.enemy.setHP(newHP);
    
    this.addLog(`${spellElement}の魔法！エレメンタルシフターに ${finalDamage} のダメージ！`);
    this.updateVariableDisplay();
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.enemy.getHP() <= 0) {
      this.playerWin();
      return;
    }
    
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    const currentElement = this.shifterState.currentElement;
    const damage = 15 + Math.floor(Math.random() * 10);
    
    const elementAttacks = {
      '火': 'フレイムバースト',
      '水': 'アクアジェット',
      '風': 'ゲイルスラッシュ',
      '地': 'アースクエイク'
    };
    
    const attackName = elementAttacks[currentElement] || `${currentElement}属性攻撃`;
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName('エレメンタルシフター');
    this.enemy.displayAttack(attackName, damage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }
}
