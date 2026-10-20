import Phaser from "phaser";
import { BattleScene } from "./battle";
import { spellAnimation } from "./battleAnimations";

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
    this.shieldMaxHP = 8; // 盾の耐久（物理攻撃1回で1減り、8回で壊れる。2回繰り返す×3段 = 8回）
    this.shieldHP = this.shieldMaxHP;
  }

  create() {
    // 盾は戦いごとに元に戻す（もう一度戦う・再入場でも同じインスタンスが使われるので、前の戦いで壊した盾を引き継がない）
    this.shieldActive = true;
    this.shieldHP = this.shieldMaxHP;

    super.create();

    // ステージ8の設定
    this.setupStageCommon({
      backgroundColor: 0x4a3728, // ゴブリン要塞の茶色
      enemyTint: 0x228b22, // ゴブリンの緑色
      enemyHp: 30,
      startMessage: `ステージ8「行動の繰り返し」が始まりました！\n🛡️ シールドゴブリンの盾は魔法を弾く！（麻痺魔法は効く）\n⚔️ 物理攻撃を8回繰り返して盾を破壊せよ！`,
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
      // 斬撃が盾に弾かれて火花が散る（敵はびくともしない）
      await this.playAnimation('playerAttack_blocked');
      if (this.isBattleOver()) return 0;

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
      // 盾破壊後は通常ダメージ（斬撃が当たってから HP を減らす）
      await this.playAnimation('playerAttack');
      if (this.isBattleOver()) return 0;

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
    if (this.shieldActive) {
      this.addLog(`🛡️ ${spellName}は盾に弾かれた！盾がある間は効かない！`);
      
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
      
      // 魔法エフェクトを再生（魔法名から選ぶ。氷の盾は主人公の前に氷の壁を出す）
      // 回復魔法と麻痺魔法はここに来ない（engine.js が主人公の回復と敵の麻痺にする）
      const animationType = spellName === '氷の盾' ? 'ice_shield' : spellAnimation(spellName, 'magic_fire');
      await this.playAnimation(animationType);
      if (this.isBattleOver()) return 0;

      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      if (this.enemy.hp <= 0) {
        this.gameOver(true);
      }
      
      return damage;
    }
  }

  // 盾へのヒットエフェクト（火花と画面の揺れは playerAttack_blocked が出す）
  playShieldHitEffect() {
    // 盾の揺れ
    this.tweens.add({
      targets: this.shieldSprite,
      x: this.shieldSprite.x - 5,
      duration: 50,
      yoyo: true,
      repeat: 2
    });
  }

  // 敵のターン処理
  async enemyTurn() {
    // 麻痺している間は動けない（麻痺魔法の残りターンを1減らす）
    if (this.skipTurnIfParalyzed(`${this.enemy.name}は麻痺して動けない！`)) {
      return;
    }

    // 棍棒を振り下ろす
    await this.playAnimation('enemyAttack_sword');
    
    const damage = 40;
    this.addLog(`${this.enemy.name}の攻撃！${damage}ダメージ！`);
    
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }
}

