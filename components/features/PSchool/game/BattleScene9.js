import Phaser from "phaser";
import { BattleScene } from "./battle";

// ステージ9「閃光魔法の習得」用のバトルシーン
export class BattleScene9 extends BattleScene {
  constructor() {
    super({ key: "Stage9Battle" });
    this.settings = {
      background: 'shadow',
      enemy: 'シャドウゴースト',
      stageNumber: 9
    };
    
    // 影の獣の回避能力
    this.shadowBeastEvades = true;  // 通常攻撃・既存魔法を回避する
  }

  create() {
    super.create();
    
    // ステージ9の設定
    this.setupStageCommon({
      backgroundColor: 0x1a0d2e, // 神秘的な紫色背景
      enemyTint: 0x4a0e4e, // 影の獣の暗い紫色
      enemyHp: 60, // より強力な敵
      startMessage: `ステージ9「閃光魔法の習得」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'repeat_2x', 'wave_left_hand', 'wave_right_hand', 'wait', 'cast_magic']
    });
    
    this.createMysticalEffect();
  }

  createMysticalEffect() {
    // 神秘的な背景エフェクト
    const particles = [];
    for (let i = 0; i < 12; i++) {
      const particle = this.add.graphics();
      particle.fillStyle(0x9966ff, 0.6);
      particle.fillCircle(0, 0, 3);
      
      particle.x = Math.random() * this.scale.width;
      particle.y = Math.random() * this.scale.height;
      
      this.tweens.add({
        targets: particle,
        y: particle.y - 150,
        alpha: { from: 0.6, to: 0 },
        duration: 3000 + Math.random() * 2000,
        repeat: -1,
        onComplete: () => {
          particle.y = this.scale.height + 50;
          particle.x = Math.random() * this.scale.width;
        }
      });
      
      particles.push(particle);
    }

    // 神秘的な光のオーラ
    const aura = this.add.graphics();
    aura.fillStyle(0x6a0dad, 0.3);
    aura.fillCircle(this.scale.width / 2, this.scale.height / 2, 200);
    
    this.tweens.add({
      targets: aura,
      scale: { from: 1, to: 1.2 },
      alpha: { from: 0.3, to: 0.1 },
      duration: 2000,
      yoyo: true,
      repeat: -1
    });
  }

  // 敵へのダメージ処理をオーバーライド（回避システム）
  dealDamageToEnemy(damage, attackType = 'normal') {
    // 閃光魔法以外は回避される
    if (this.shadowBeastEvades && attackType !== 'flash') {
      // 回避エフェクト
      this.playEvasionEffect();
      this.addLog('👻 影の獣が攻撃を回避しました！普通の攻撃は効きません！');
      return true; // 戦闘続行
    }
    
    // 閃光魔法の場合は基底クラスの処理を呼び出し
    return super.dealDamageToEnemy(damage);
  }

  // 回避エフェクトを表示
  playEvasionEffect() {
    if (this.enemySprite) {
      // 敵が一瞬消える演出
      this.tweens.add({
        targets: this.enemySprite,
        alpha: 0,
        duration: 150,
        yoyo: true,
        repeat: 1,
        ease: 'Power2'
      });
      
      // 影のエフェクト
      const shadowClone = this.add.graphics();
      shadowClone.fillStyle(0x000000, 0.5);
      shadowClone.fillCircle(this.enemySprite.x + 20, this.enemySprite.y, 50);
      
      this.tweens.add({
        targets: shadowClone,
        alpha: 0,
        x: this.enemySprite.x + 100,
        duration: 500,
        onComplete: () => shadowClone.destroy()
      });
    }
  }

  // 閃光魔法効果をオーバーライド（回避不可を確実に）
  async applyFlashEffect() {
    console.log('BattleScene9: Applying flash effect (evasion ignored)');
    
    const damage = 25;
    
    this.addLog('✨ 閃光魔法発動！影の獣の回避を無視して命中！');
    
    // 閃光エフェクト
    await this.playFlashAnimation();
    
    // ダメージ処理（回避無効）
    if (this.enemy) {
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      this.addLog(`⚡ 敵に${damage}ダメージ！（回避不可）`);
      
      // 敵のHPが0になったかチェック
      if (this.enemy.hp <= 0) {
        this.addLog("影の獣を倒した！閃光魔法をマスターしました！");
        this.gameOver(true);
      }
    }
  }
  
  // ステージ9専用の敵ターン処理（50ダメージ）
  async enemyTurn() {
    // 麻痺状態チェック
    if (this.paralyzeTurns > 0) {
      this.addLog("敵は麻痺で動けない！");
      this.decreaseParalyzeEffect();
      return;
    }

    // 影の獣の特別攻撃（50ダメージ）
    this.addLog("影の獣が闇の波動を放った！");
    
    await this.playAnimation('enemyAttack_shadow');
    
    // 50ダメージを与える
    const damage = 50;
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    this.addLog(`プレイヤーは${damage}ダメージを受けた！`);

    // ゲームオーバーチェック
    if (this.player.hp <= 0) {
      this.addLog("プレイヤーは倒れた...");
      this.gameOver(false);
    }
  }
}
