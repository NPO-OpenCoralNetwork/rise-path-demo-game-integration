import { BattleScene } from './battle';

// Stage 13 "First Functions" battle scene
export class BattleScene13 extends BattleScene {
  constructor() {
    super({ key: 'Stage13Battle' });
    this.settings = {
      background: 'armory',
      enemy: 'mirrorknight',
      stageNumber: 13
    };

    this.guardActive = true;
    this.functionUsed = false;
    this.executingFunctionName = null;
    this.currentFunctionHits = 0;
    this.comboGoal = 3;
    this.justBrokeGuard = false;
  }

  create() {
    super.create();

    this.guardActive = true;
    this.functionUsed = false;
    this.executingFunctionName = null;
    this.currentFunctionHits = 0;
    this.comboGoal = 3;
    this.justBrokeGuard = false;

    this.setupStageCommon({
      backgroundColor: 0x2d1b15,
      enemyTint: 0xcbd6ff,
      enemyHp: 140,
      startMessage: 'Stage 13 "First Functions" has begun! The Twinblade Knights will counter anything predictable.',
      availableBlocks: ['custom_function_placeholder', 'attack_basic', 'heal_magic', 'wait']
    });

    if (this.enemy) {
      this.enemy.setName('Twinblade Knights');
    }

    this.guardText = this.add.text(10, 150, '', {
      fontSize: '16px',
      fill: '#fdd835'
    });
    this.statusText = this.add.text(10, 172, '', {
      fontSize: '14px',
      fill: '#f0f0f0'
    });

    this.addLog('Twinblade Knights fight in perfect sync. Break their guard with a saved combo function.');
    this.addLog('Open the function tab in the editor, save attack → attack → attack, then run it in the main program.');
    this.resetDualGuard();
  }

  resetDualGuard() {
    this.guardActive = true;
    this.comboHitsThisTurn = 0;
    if (this.guardText) {
      this.guardText.setText('Guard: Linked');
      this.guardText.setColor('#fdd835');
    }
    if (this.statusText) {
      this.statusText.setText('Land 3 hits inside one function run to break the guard.');
    }
    if (this.enemy && typeof this.enemy.setTint === 'function') {
      this.enemy.setTint(0xcbd6ff);
    }
  }

  breakDualGuard() {
    if (!this.guardActive) {
      return;
    }
    this.guardActive = false;
    this.justBrokeGuard = true;
    if (this.guardText) {
      this.guardText.setText('Guard: Broken');
      this.guardText.setColor('#ff7043');
    }
    if (this.statusText) {
      this.statusText.setText('Great! Follow up before they recover.');
    }
    this.addLog('The linked guard is broken! Follow up while it is open.');
    const burstDamage = 35;
    const stillFighting = this.dealDamageToEnemy(burstDamage, 'critical');
    if (stillFighting === false) {
      return;
    }
  }

  onExecuteSavedFunctionStart(name) {
    this.functionUsed = true;
    this.executingFunctionName = name;
    this.currentFunctionHits = 0;
    this.addLog(`Function "${name}" started.`);
  }

  onExecuteSavedFunctionEnd(name) {
    if (this.executingFunctionName === name) {
      if (this.guardActive && this.currentFunctionHits < this.comboGoal) {
        this.addLog(`The guard held firm. You only landed ${this.currentFunctionHits} hit(s).`);
      }
    }
    this.executingFunctionName = null;
    this.currentFunctionHits = 0;
  }

  onExecuteSavedFunctionAction(name) {
    this.functionUsed = true;
  }

  async handlePlayerAction(actionType) {
    if (actionType === 'Attack') {
      await this.performTwinStrike();
      return true;
    }
    return false;
  }

  async performTwinStrike() {
    if (this.battleEnded) {
      return;
    }

    // 結果に合った斬撃を選ぶ（判定は演出のあとでこれまでどおり行う）
    // ガードが残る一撃は弾かれ、ガードを砕く一撃と関数の中の連続攻撃は十字斬り
    const breaksGuard = this.guardActive && Boolean(this.executingFunctionName) && this.currentFunctionHits + 1 >= this.comboGoal;
    let animationType = 'playerAttack';
    if (this.guardActive && !breaksGuard) {
      animationType = 'playerAttack_blocked';
    } else if (breaksGuard || this.executingFunctionName) {
      animationType = 'playerAttack_combo';
    }

    if (typeof this.playAnimation === 'function') {
      await this.playAnimation(animationType);
      if (this.isBattleOver()) {
        return;
      }
    }

    if (this.guardActive) {
      if (this.executingFunctionName) {
        this.currentFunctionHits += 1;
        this.addLog(`Combo hit count: ${this.currentFunctionHits}`);
        if (this.currentFunctionHits >= this.comboGoal) {
          this.breakDualGuard();
        } else {
          const remaining = this.comboGoal - this.currentFunctionHits;
          this.addLog(`Need ${remaining} more hit(s) to break the guard.`);
        }
      } else {
        this.addLog('Single attacks bounce off the linked guard. Use your saved function to chain hits.');
      }
    }

    if (!this.guardActive) {
      if (this.justBrokeGuard) {
        this.justBrokeGuard = false;
      } else {
        const baseDamage = this.executingFunctionName ? 22 : 10;
        this.addLog(`Twinblade Knights take ${baseDamage} damage.`);
        const stillAlive = this.dealDamageToEnemy(baseDamage, 'normal');
        if (stillAlive === false) {
          return;
        }
      }
    }

    if (!this.battleEnded) {
      this.time.delayedCall(900, () => this.enemyAction());
    }
  }

  async enemyAction() {
    if (this.battleEnded) {
      return;
    }

    this.resetDualGuard();

    // 技ごとの演出（双剣は斜めの斬撃、十字の反撃は大技、回転突進は風の刃）
    const patterns = [
      { name: 'Twin Slash', damage: 18, animation: 'enemyAttack_sword' },
      { name: 'Cross Guard Counter', damage: 22, animation: 'enemyAttack_boss' },
      { name: 'Spiral Dash', damage: 20, animation: 'enemyAttack_wind' }
    ];
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];

    let attack;
    if (this.enemy && typeof this.enemy.performAttack === 'function') {
      // 演出が当たってから HP が減る。下の HP 確認はこれまでどおり待たずに行い、Promise は呼び出し元へ返す
      attack = this.enemy.performAttack(pattern.name, pattern.damage, pattern.animation);
    } else {
      await this.playAnimation(pattern.animation);
      if (this.isBattleOver()) {
        return;
      }
      const newHP = Math.max(0, this.player.hp - pattern.damage);
      this.player.setHP(newHP);
      this.updateHP(this.player.hp, this.enemy.hp);
      if (newHP <= 0) {
        this.gameOver(false);
      }
      return;
    }

    if (this.player.getHP() <= 0) {
      this.gameOver(false);
    }
    return attack;
  }
}
