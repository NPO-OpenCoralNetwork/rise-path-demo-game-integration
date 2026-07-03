import { BattleScene } from './battle';

// ステージ14「ループ処理」用のバトルシーン
export class BattleScene14 extends BattleScene {
  constructor() {
    super({ key: 'Stage14Battle' });
    this.settings = {
      background: 'crystal_cave',
      enemy: 'crystalgolem',
      stageNumber: 14
    };
    
    // クリスタルゴーレム専用の状態
    this.golemState = {
      crystalShards: 5,
      reflection: false,
      prismMode: false,
      shardRegeneration: 0
    };
    
    // ループ処理用変数
    this.loopVars = {
      attackLoop: 0,
      maxLoop: 3,
      shardDestroyed: 0,
      comboCount: 0
    };
  }

  create() {
    super.create();
    
    // ステージ14の設定
    this.setupStageCommon({
      backgroundColor: 0x191970, // 水晶洞窟の深い青色背景
      enemyTint: 0x87CEEB, // クリスタルゴーレムの水晶色
      enemyHp: 90,
      startMessage: `ステージ14「ループ処理」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'for_loop', 'while_loop', 'break_crystal', 'combo_attack', 'wave_left_hand', 'wave_right_hand', 'wait']
    });
    
    this.createCrystalEffect();
    this.setupLoopSystem();
  }

  createCrystalEffect() {
    // 水晶の輝きエフェクト
    const crystals = this.add.graphics();
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * this.scale.width;
      const y = Math.random() * this.scale.height;
      crystals.fillStyle(0x87CEEB, 0.7);
      crystals.fillCircle(x, y, 4);
      
      this.tweens.add({
        targets: crystals,
        scale: 1.5,
        alpha: 0.3,
        duration: 2000,
        repeat: -1,
        yoyo: true,
        delay: i * 150
      });
    }
  }

  setupLoopSystem() {
    // ループシステムの初期化
    this.loopTexts = {
      crystalShards: this.add.text(10, 150, `水晶: ${this.golemState.crystalShards}`, {
        fontSize: '16px',
        fill: '#87CEEB'
      }),
      loopCounter: this.add.text(10, 170, 'ループ: 0/3', {
        fontSize: '16px',
        fill: '#00ffff'
      }),
      comboCounter: this.add.text(10, 190, 'コンボ: 0', {
        fontSize: '16px',
        fill: '#ffff00'
      })
    };
  }

  forLoop(iterations) {
    this.addLog(`🔄 Forループ開始！${iterations}回攻撃を実行！`);
    this.loopVars.attackLoop = 0;
    this.executeLoopAttack(iterations);
  }

  executeLoopAttack(maxIterations) {
    if (this.loopVars.attackLoop < maxIterations && !this.battleEnded) {
      this.loopVars.attackLoop++;
      this.loopTexts.loopCounter.setText(`ループ: ${this.loopVars.attackLoop}/${maxIterations}`);
      
      this.performLoopAttack();
      
      // 次のループを300ms後に実行
      this.time.delayedCall(300, () => {
        this.executeLoopAttack(maxIterations);
      });
    } else {
      this.addLog(`✅ ループ完了！${maxIterations}回の攻撃を実行しました！`);
      this.loopVars.attackLoop = 0;
      this.loopTexts.loopCounter.setText('ループ: 完了');
      
      // 敵のターン
      this.time.delayedCall(1000, () => this.enemyAction());
    }
  }

  performLoopAttack() {
    let damage = 8; // ループ攻撃は個別ダメージが小さい
    
    // 水晶シャードがある場合、ダメージ軽減
    if (this.golemState.crystalShards > 0) {
      damage = Math.floor(damage * 0.6);
      this.addLog(`💎 水晶シャードに阻まれた！（残り: ${this.golemState.crystalShards}）`);
    }
    
    const newHP = Math.max(0, this.enemy.getHP() - damage);
    this.enemy.setHP(newHP);
    
    // コンボカウンター増加
    this.loopVars.comboCount++;
    this.loopTexts.comboCounter.setText(`コンボ: ${this.loopVars.comboCount}`);
    
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.enemy.getHP() <= 0) {
      this.playerWin();
    }
  }

  breakCrystal() {
    if (this.golemState.crystalShards > 0) {
      this.golemState.crystalShards--;
      this.loopVars.shardDestroyed++;
      this.loopTexts.crystalShards.setText(`水晶: ${this.golemState.crystalShards}`);
      this.addLog(`💎 水晶シャードを破壊！（残り: ${this.golemState.crystalShards}）`);
      
      if (this.golemState.crystalShards === 0) {
        this.addLog('✨ 全ての水晶シャードを破壊！防御力が大幅に低下！');
        this.loopTexts.crystalShards.setText('水晶: 破壊完了');
        this.loopTexts.crystalShards.setFill('#ff0000');
      }
    } else {
      this.addLog('💎 破壊する水晶シャードがありません');
    }
    
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  comboAttack() {
    const comboMultiplier = Math.min(3, this.loopVars.comboCount / 5); // 5回につき1倍率増加、最大3倍
    const baseDamage = 25;
    const damage = Math.floor(baseDamage * (1 + comboMultiplier));
    
    this.addLog(`🔥 コンボ攻撃！倍率: x${(1 + comboMultiplier).toFixed(1)}`);
    
    let finalDamage = damage;
    if (this.golemState.crystalShards > 0) {
      finalDamage = Math.floor(damage * 0.4);
      this.addLog(`💎 水晶シャードに大幅軽減された！`);
    }
    
    const newHP = Math.max(0, this.enemy.getHP() - finalDamage);
    this.enemy.setHP(newHP);
    this.addLog(`コンボ攻撃！クリスタルゴーレムに ${finalDamage} のダメージ！`);
    
    // コンボリセット
    this.loopVars.comboCount = 0;
    this.loopTexts.comboCounter.setText('コンボ: 0');
    
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.enemy.getHP() <= 0) {
      this.playerWin();
      return;
    }
    
    this.time.delayedCall(1000, () => this.enemyAction());
  }

  whileLoop() {
    this.addLog('🔄 Whileループ開始！水晶がある間、攻撃を続けます！');
    this.executeWhileLoop();
  }

  executeWhileLoop() {
    if (this.golemState.crystalShards > 0 && !this.battleEnded) {
      this.breakCrystal();
      
      // 次のループを500ms後に実行
      this.time.delayedCall(500, () => {
        this.executeWhileLoop();
      });
    } else {
      this.addLog('✅ Whileループ完了！全ての水晶を破壊しました！');
    }
  }

  enemyAction() {
    if (this.battleEnded) return;
    
    // 水晶再生の判定
    if (this.golemState.crystalShards < 3 && Math.random() < 0.3) {
      this.golemState.crystalShards++;
      this.loopTexts.crystalShards.setText(`水晶: ${this.golemState.crystalShards}`);
      this.loopTexts.crystalShards.setFill('#87CEEB');
      this.addLog('💎 クリスタルゴーレムが水晶シャードを再生！');
      return;
    }
    
    const attacks = [
      { id: 'crystal_beam', name: 'クリスタルビーム' },
      { id: 'prism_attack', name: 'プリズム攻撃' },
      { id: 'reflection_strike', name: 'リフレクションストライク' }
    ];
    const attack = attacks[Math.floor(Math.random() * attacks.length)];
    const baseDamage = 18;
    const damage = baseDamage + this.golemState.crystalShards * 2; // 水晶数でダメージ増加
    
    // enemy.jsのdisplayAttackメソッドを使用
    this.enemy.setName('クリスタルゴーレム');
    this.enemy.displayAttack(attack.name, damage);
    
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    if (this.player.getHP() <= 0) {
      this.playerLose();
    }
  }
}
