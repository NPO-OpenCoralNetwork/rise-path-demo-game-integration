import Phaser from "phaser";
import { BattleScene } from "./battle";
import { settled } from "./characterMotion";

// ステージ7「雷の力」用のバトルシーン
export class BattleScene7 extends BattleScene {
  constructor() {
    super({ key: "Stage7Battle" });
    this.settings = {
      background: 'metal',
      enemy: 'アーマードキメラ',
      stageNumber: 7
    };
    
    // アーマードキメラの装甲状態管理
    this.armorMode = true; // 装甲が有効か
    this.armorHealth = 1; // 装甲HP（ライデン1回で破壊）
  }

  create() {
    // 装甲は戦いごとに元に戻す（もう一度戦う・再入場でも同じインスタンスが使われるので、前の戦いで壊した装甲を引き継がない）
    this.armorMode = true;
    this.armorHealth = 1;

    super.create();
    
    // ステージ7の設定
    this.setupStageCommon({
      backgroundColor: 0x404040, // 金属洞窟の灰色
      enemyTint: 0xc0c0c0, // 旧画像（ドット絵）用の銀色。新しい画像のステージでは塗らない
      enemyHp: 40,
      startMessage: `ステージ7「雷の力」が始まりました！\n⚡ ${this.settings.enemy}の装甲を破壊せよ！`,
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
  async applyRaidenEffect() {
    // 水と雷の演出（装甲があってもなくても同じ魔法が当たる）
    await this.playAnimation('magic_raiden');
    if (this.isBattleOver()) return;

    if (this.armorMode) {
      this.armorHealth--;
      
      if (this.armorHealth <= 0) {
        this.armorMode = false;
        this.addLog('⚡💥 ライデンが装甲を破壊した！');
        this.addLog(`✅ ${this.settings.enemy}に通常ダメージが通るようになった！`);
        // this.updateArmorDisplay();
        
        // のけぞりが終わってから砕く（のけぞりの最後に元の色へ戻り、灰色が消えるため）
        await settled(this.enemySprite);
        if (this.isBattleOver()) return;

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
      // 装甲破壊後は通常のライデンダメージ
      const damage = 35;
      this.addLog(`⚡ ライデン！${damage}ダメージ！`);
      
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      if (this.enemy.hp <= 0) {
        this.gameOver(true);
      }
    }
  }

  // プレイヤーの攻撃を処理（装甲中は無効化）
  async playerAttack(damage) {
    if (this.armorMode) {
      // 斬撃が装甲に弾かれて火花が散る（敵はびくともしない）
      await this.playAnimation('playerAttack_blocked');
      if (this.isBattleOver()) return 0;

      this.addLog('🛡️ 装甲に弾かれた！ダメージなし！');
      
      return 0; // ダメージなし
    } else {
      // 装甲破壊後は通常ダメージ（斬撃が当たってから HP を減らす）
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

  // 敵のターン処理
  async enemyTurn() {
    // 麻痺している間は動けない（麻痺魔法の残りターンを1減らす）
    if (this.skipTurnIfParalyzed(`${this.enemy.name}は麻痺して動けない！`)) {
      return;
    }

    // 体当たり：大きく踏み込んでぶつかる
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
