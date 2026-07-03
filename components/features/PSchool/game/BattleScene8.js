import Phaser from "phaser";
import { BattleScene } from "./battle";

// ステージ8「行動の繰り返し」用のバトルシーン
export class BattleScene8 extends BattleScene {
  constructor() {
    super({ key: "Stage8Battle" });
    this.settings = {
      background: 'goblin',
      enemy: 'シールドゴブリン',
      stageNumber: 8
    };
    
    // シールドゴブリンの盾状態管理
    this.shieldActive = true; // 盾が有効か
    this.shieldHP = 9; // 盾HP（物理攻撃3ダメージ × 3回で破壊）
    this.shieldMaxHP = 9;
  }

  create() {
    super.create();
    
    // ステージ8の設定
    this.setupStageCommon({
      backgroundColor: 0x4a3728, // ゴブリン要塞の茶色
      enemyTint: 0x228b22, // ゴブリンの緑色
      enemyHp: 30,
      startMessage: `ステージ8「行動の繰り返し」が始まりました！\n🛡️ シールドゴブリンの盾は魔法が効かない！\n⚔️ 物理攻撃を8回繰り返して盾を破壊せよ！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'repeat_2x', 'repeat_3x', 'wave_left_hand', 'wave_right_hand', 'cast_magic', 'wait']
    });
    
    this.createFortressEffect();
    this.setupShieldSystem();
  }

  createFortressEffect() {
    // 要塞の雰囲気エフェクト（松明の光）
    for (let i = 0; i < 2; i++) {
      const torchX = i === 0 ? 100 : this.scale.width - 100;
      const torchY = this.scale.height * 0.4;
      
      const flame = this.add.graphics();
      flame.fillStyle(0xff6600, 0.8);
      flame.fillCircle(torchX, torchY, 15);
      flame.fillStyle(0xffcc00, 0.9);
      flame.fillCircle(torchX, torchY - 5, 8);
      
      this.tweens.add({
        targets: flame,
        alpha: 0.5,
        scaleX: 0.9,
        scaleY: 1.1,
        duration: 300,
        yoyo: true,
        repeat: -1
      });
    }
  }

  setupShieldSystem() {
    // 盾のビジュアル表示
    this.shieldSprite = this.add.graphics();
    this.updateShieldDisplay();
  }

  updateShieldDisplay() {
    if (this.shieldActive) {
      // 盾のビジュアル
      this.shieldSprite.clear();
      this.shieldSprite.fillStyle(0x4169e1, 0.6);
      this.shieldSprite.fillEllipse(this.enemySprite.x - 40, this.enemySprite.y, 30, 50);
      this.shieldSprite.lineStyle(3, 0x87ceeb, 1);
      this.shieldSprite.strokeEllipse(this.enemySprite.x - 40, this.enemySprite.y, 30, 50);
    } else {
      // 盾を非表示
      this.shieldSprite.clear();
    }
  }

  // プレイヤーの物理攻撃を処理
  async playerAttack(damage) {
    if (this.shieldActive) {
      // 盾にダメージ
      this.shieldHP--;
      this.addLog(`⚔️ 盾に攻撃！残り耐久: ${this.shieldHP}/${this.shieldMaxHP}`);
      
      // 盾へのダメージエフェクト
      this.playShieldHitEffect();
      
      if (this.shieldHP <= 0) {
        this.shieldActive = false;
        this.addLog('💥 盾を破壊した！');
        this.addLog('✅ シールドゴブリンに通常ダメージが通るようになった！');
        
        // 盾破壊エフェクト
        this.cameras.main.flash(300, 100, 100, 255);
        this.cameras.main.shake(400, 0.02);
        
        // 敵の色を変更（盾なし状態）
        this.enemySprite.setTint(0x32cd32);
      }
      
      this.updateShieldDisplay();
      return 0; // 盾があるためダメージなし
    } else {
      // 盾破壊後は通常ダメージ
      this.addLog(`⚔️ 攻撃！${damage}ダメージ！`);
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      if (this.enemy.hp <= 0) {
        this.gameOver(true);
      }
      
      return damage;
    }
  }

  // 魔法攻撃を処理（盾に無効）
  async playerMagicAttack(spellName, damage) {
    // 魔法名からアニメーションタイプを取得
    const getAnimationType = (name) => {
      const animationMap = {
        '炎の魔法': 'magic_fire',
        '氷の盾': 'magic_ice',
        '雷の魔法': 'magic_thunder',
        '水の魔法': 'magic_water',
        'ライデン': 'magic_thunder'
      };
      return animationMap[name] || 'magic_fire';
    };
    
    if (this.shieldActive) {
      this.addLog(`🛡️ ${spellName}は盾に弾かれた！魔法は効かない！`);
      
      // 弾かれるエフェクト
      const spark = this.add.graphics();
      spark.fillStyle(0x4169e1, 1);
      spark.fillCircle(this.enemySprite.x - 40, this.enemySprite.y, 25);
      
      this.tweens.add({
        targets: spark,
        alpha: 0,
        scale: 2,
        duration: 300,
        onComplete: () => spark.destroy()
      });
      
      return 0;
    } else {
      // 盾破壊後は通常の魔法ダメージ
      this.addLog(`🔮 ${spellName}発動！${damage}ダメージ！`);
      
      // 魔法エフェクトを再生
      const animationType = getAnimationType(spellName);
      if (typeof this.playAnimation === 'function') {
        await this.playAnimation(animationType);
      }
      
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      if (this.enemy.hp <= 0) {
        this.gameOver(true);
      }
      
      return damage;
    }
  }

  // 盾へのヒットエフェクト
  playShieldHitEffect() {
    const impact = this.add.graphics();
    impact.fillStyle(0xffffff, 0.8);
    impact.fillCircle(this.enemySprite.x - 40, this.enemySprite.y, 15);
    
    this.tweens.add({
      targets: impact,
      alpha: 0,
      scale: 2,
      duration: 200,
      onComplete: () => impact.destroy()
    });
    
    // 盾の揺れ
    this.tweens.add({
      targets: this.shieldSprite,
      x: this.shieldSprite.x - 5,
      duration: 50,
      yoyo: true,
      repeat: 2
    });
    
    this.cameras.main.shake(100, 0.005);
  }

  // 敵のターン処理
  async enemyTurn() {
    await this.playAnimation('enemyAttack');
    
    const damage = 40;
    this.addLog(`${this.enemy.name}の攻撃！${damage}ダメージ！`);
    
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }
}

