import Phaser from 'phaser';
import { BattleScene } from './battle';

// ステージ4「氷の壁」用のバトルシーン
export class BattleScene4 extends BattleScene {
  constructor() {
    super({ key: 'Stage4Battle' });
    this.settings = {
      background: 'valcano',
      enemy: 'フレイムウルフ',
      stageNumber: 4
    };
    
    // 魔法詠唱の状態を追跡
    this.spellCastState = {
      sequence: [],
      isActive: false,
      requiredPattern: ['left', 'left'] // 氷の魔法のパターン
    };
  }

  create() {
    super.create();
    
    // 氷の盾フラグを初期化
    this.iceShieldActive = false;
    
    // 攻撃カウンターを初期化（0から開始 = 最初は強攻撃）
    this.attackCounter = 0;
    
    // ステージ4の設定
    this.setupStageCommon({
      backgroundColor: 0x4d79a4, // 雪原の青い背景
      enemyTint: 0xff6600, // フレイムウルフのオレンジ色
      enemyHp: 25,
      startMessage: `ステージ4「氷の壁」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'wave_left_hand', 'wave_right_hand', 'cast_magic', 'ice_shield', 'wait']
    });
    
    this.createSnowEffect();
  }

  createSnowEffect() {
    // 雪のエフェクト
    for (let i = 0; i < 20; i++) {
      const snowflake = this.add.graphics();
      snowflake.fillStyle(0xffffff, 0.8);
      snowflake.fillCircle(Math.random() * this.scale.width, Math.random() * this.scale.height, 2);
      
      this.tweens.add({
        targets: snowflake,
        y: `+=${this.scale.height + 50}`,
        x: `+=${(Math.random() - 0.5) * 100}`,
        duration: 3000 + Math.random() * 2000,
        repeat: -1
      });
    }
  }

  // 敵のターン処理をオーバーライド（氷の盾チェックを追加）
  async enemyTurn() {
    // 敵が麻痺状態かチェック
    if (this.enemy.isParalyzed) {
      this.addLog(`${this.enemy.name}は麻痺して動けない！`);
      this.enemy.isParalyzed = false;
      return;
    }

    // 攻撃パターン: 0回目と3の倍数回目は80ダメージ、それ以外は20ダメージ
    let damage;
    let isStrongAttack = false;
    
    if (this.attackCounter === 0 || this.attackCounter % 3 === 0) {
      damage = 80;
      isStrongAttack = true;
    } else {
      damage = 20;
    }
    
    // 氷の盾チェック
    if (this.iceShieldActive) {
      if (isStrongAttack) {
        this.addLog('🛡️ 氷の盾が強力な攻撃を無効化した！');
      } else {
        this.addLog('🛡️ 氷の盾が攻撃を無効化した！');
      }
      this.iceShieldActive = false; // 盾を消費
      
      // 盾エフェクト
      if (typeof this.playAnimation === 'function') {
        await this.playAnimation('shield_block');
      }
      
      // 攻撃カウンターを増加
      this.attackCounter++;
      return;
    }
    
    // 攻撃実行
    await this.playAnimation('enemyAttack_fire');
    
    if (isStrongAttack) {
      this.addLog(`🔥 ${this.enemy.name}の強力な炎の攻撃！${damage}ダメージ！`);
    } else {
      this.addLog(`${this.enemy.name}の攻撃！${damage}ダメージ！`);
    }
    
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    // 攻撃カウンターを増加
    this.attackCounter++;
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }
}
