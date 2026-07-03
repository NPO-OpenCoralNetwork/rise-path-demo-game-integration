import Phaser from "phaser";
import { BattleScene } from "./battle";

// ステージ7「雷の力」用のバトルシーン
export class BattleScene7 extends BattleScene {
  constructor() {
    super({ key: "Stage7Battle" });
    this.settings = {
      background: 'metal',
      enemy: 'アーマードキメラ',
      stageNumber: 7
    };
    
    // メタルスライムの装甲状態管理
    this.armorMode = true; // 装甲が有効か
    this.armorHealth = 1; // 装甲HP（ライデン1回で破壊）
  }

  create() {
    super.create();
    
    // ステージ7の設定
    this.setupStageCommon({
      backgroundColor: 0x404040, // 金属洞窟の灰色
      enemyTint: 0xc0c0c0, // メタルスライムの銀色
      enemyHp: 40,
      startMessage: `ステージ7「雷の力」が始まりました！\n⚡ メタルスライムの装甲を破壊せよ！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'wave_left_hand', 'wave_right_hand', 'cast_magic', 'wait']
    });
    
    this.createMetalEffect();
    this.setupArmorSystem();
  }

  createMetalEffect() {
    // 金属の輝きエフェクト
    const shine = this.add.graphics();
    shine.lineStyle(3, 0xffffff, 0.8);
    
    for (let i = 0; i < 3; i++) {
      const x = this.enemySprite.x - 30 + i * 30;
      const y = this.enemySprite.y - 40;
      
      shine.beginPath();
      shine.moveTo(x, y);
      shine.lineTo(x + 20, y + 20);
      shine.strokePath();
      
      this.tweens.add({
        targets: shine,
        alpha: 0.3,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        delay: i * 300
      });
    }
  }

  setupArmorSystem() {
    // // 装甲状態表示（魔法の書ボタンの下に配置）
    // this.armorText = this.add.text(10, 110, '', {
    //   fontSize: '16px',
    //   fill: '#00ffff',
    //   fontStyle: 'bold',
    //   backgroundColor: '#000000',
    //   padding: { x: 10, y: 8 }
    // });
    // 
    // this.updateArmorDisplay();
  }

  updateArmorDisplay() {
    // if (this.armorMode) {
    //   this.armorText.setText('🛡️ 装甲: 有効\n⚡ ライデンで破壊可能');
    //   this.armorText.setFill('#00ffff');
    // } else {
    //   this.armorText.setText('💥 装甲: 破壊済み\n✅ 通常ダメージ有効');
    //   this.armorText.setFill('#ff0000');
    // }
  }

  // ライデン魔法で装甲を破壊
  applyRaidenEffect() {
    if (this.armorMode) {
      this.armorHealth--;
      
      if (this.armorHealth <= 0) {
        this.armorMode = false;
        this.addLog('⚡💥 ライデンが装甲を破壊した！');
        this.addLog('✅ メタルスライムに通常ダメージが通るようになった！');
        // this.updateArmorDisplay();
        
        // 装甲破壊エフェクト
        this.cameras.main.flash(300, 255, 255, 0);
        this.cameras.main.shake(400, 0.02);
        
        // 敵の色を変更（装甲なし状態）
        this.enemySprite.setTint(0x808080);
      } else {
        this.addLog('⚡ ライデンで装甲にダメージ！残り耐久: ' + this.armorHealth);
        // this.updateArmorDisplay();
      }
    } else {
      // 装甲破壊後は通常のライデンダメージ＋エフェクト
      const damage = 35;
      this.addLog(`⚡ ライデン！${damage}ダメージ！`);
      
      // ライデンエフェクト
      this.playRaidenEffect();
      
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      if (this.enemy.hp <= 0) {
        this.gameOver(true);
      }
    }
  }

  // ライデン専用エフェクト
  playRaidenEffect() {
    // 水色の波動エフェクト（水魔法の要素）
    const waterWave = this.add.graphics();
    waterWave.fillStyle(0x00bfff, 0.7);
    waterWave.fillCircle(this.playerSprite.x, this.playerSprite.y, 40);
    
    this.tweens.add({
      targets: waterWave,
      scale: 2,
      alpha: 0,
      duration: 400,
      onComplete: () => waterWave.destroy()
    });
    
    // 雷の稲妻エフェクト
    setTimeout(() => {
      for (let i = 0; i < 5; i++) {
        const lightning = this.add.graphics();
        lightning.lineStyle(3, 0xffff00, 1);
        
        const startX = this.playerSprite.x + (Math.random() * 60 - 30);
        const startY = this.playerSprite.y - 50;
        const endX = this.enemySprite.x + (Math.random() * 40 - 20);
        const endY = this.enemySprite.y;
        
        // ジグザグの雷
        lightning.beginPath();
        lightning.moveTo(startX, startY);
        const segments = 4;
        for (let s = 1; s <= segments; s++) {
          const x = startX + (endX - startX) * (s / segments) + (Math.random() * 20 - 10);
          const y = startY + (endY - startY) * (s / segments);
          lightning.lineTo(x, y);
        }
        lightning.strokePath();
        
        this.tweens.add({
          targets: lightning,
          alpha: 0,
          duration: 200,
          delay: i * 50,
          onComplete: () => lightning.destroy()
        });
      }
      
      // 敵への着弾エフェクト
      const impact = this.add.graphics();
      impact.fillStyle(0xffff00, 0.9);
      impact.fillCircle(this.enemySprite.x, this.enemySprite.y, 50);
      impact.fillStyle(0x00bfff, 0.7);
      impact.fillCircle(this.enemySprite.x, this.enemySprite.y, 30);
      
      this.tweens.add({
        targets: impact,
        scale: 1.5,
        alpha: 0,
        duration: 500,
        onComplete: () => impact.destroy()
      });
      
      // 敵のティント
      this.enemySprite.setTint(0xffff00);
      setTimeout(() => this.enemySprite.setTint(0x808080), 300);
      
      // カメラエフェクト
      this.cameras.main.shake(300, 0.015);
      this.cameras.main.flash(100, 255, 255, 0);
    }, 300);
  }

  // プレイヤーの攻撃を処理（装甲中は無効化）
  async playerAttack(damage) {
    if (this.armorMode) {
      this.addLog('🛡️ 装甲に弾かれた！ダメージなし！');
      
      // 弾かれるエフェクト
      const spark = this.add.graphics();
      spark.fillStyle(0xffff00, 1);
      spark.fillCircle(this.enemySprite.x, this.enemySprite.y, 20);
      
      this.tweens.add({
        targets: spark,
        alpha: 0,
        scale: 2,
        duration: 300,
        onComplete: () => spark.destroy()
      });
      
      return 0; // ダメージなし
    } else {
      // 装甲破壊後は通常ダメージ
      this.addLog(`⚔️ 攻撃！${damage}ダメージ！`);
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      if (this.enemy.hp <= 0) {
        this.gameOver(true);
      }
      
      return damage;
    }
  }

  // 敵のターン処理
  async enemyTurn() {
    await this.playAnimation('enemyAttack');
    
    const damage = 10;
    this.addLog(`${this.enemy.name}の体当たり！${damage}ダメージ！`);
    
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }
}
