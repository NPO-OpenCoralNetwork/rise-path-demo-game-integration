import Phaser from "phaser";
import { BattleScene } from "./battle";

// ステージ5「時間との勝負」用のバトルシーン
export class BattleScene5 extends BattleScene {
  constructor() {
    super({ key: "Stage5Battle" });
    this.settings = {
      background: 'clock',
      enemy: 'タイムイーター',
      stageNumber: 5
    };
  }

  create() {
    super.create();
    
    // ターン数カウンター初期化
    this.turnCount = 0;
    this.maxTurns = 5; // 5ターン制限
    
    // ステージ5の設定
    this.setupStageCommon({
      backgroundColor: 0x2a1a3d, // 時計の紫色背景
      enemyTint: 0x8a2be2, // タイムイーターの紫色
      enemyHp: 150,
      startMessage: `ステージ5「時間との勝負」が始まりました！\n⏰ ${this.maxTurns}ターン以内に倒せ！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'wave_left_hand', 'wave_right_hand', 'cast_magic', 'wait']
    });
    
    this.createTimeEffect();
    this.createTurnCounter();
  }

  createTimeEffect() {
    // 時計のエフェクト
    const clockGlow = this.add.graphics();
    clockGlow.fillStyle(0x8a2be2, 0.3);
    clockGlow.fillCircle(this.scale.width * 0.1, this.scale.height * 0.1, 30);
    
    this.tweens.add({
      targets: clockGlow,
      alpha: { from: 0.3, to: 0.7 },
      duration: 1000,
      yoyo: true,
      repeat: -1
    });
  }

  createTurnCounter() {
    // ターンカウンター表示
    this.turnText = this.add.text(this.scale.width / 2, 50, 
      `残りターン: ${this.maxTurns - this.turnCount}`, {
      fontSize: '28px',
      fill: '#ffd700',
      stroke: '#000',
      strokeThickness: 4
    }).setOrigin(0.5);
    
    // 時計アイコン
    const clockIcon = this.add.text(this.scale.width / 2 - 120, 50, '⏰', {
      fontSize: '32px'
    }).setOrigin(0.5);
  }

  // 敵のターン処理をオーバーライド
  async enemyTurn() {
    // 敵が麻痺状態かチェック
    if (this.enemy.isParalyzed) {
      this.addLog(`${this.enemy.name}は麻痺して動けない！`);
      this.enemy.isParalyzed = false;
      
      // ターンカウントは増やす（麻痺でもターンは消費）
      this.turnCount++;
      this.updateTurnCounter();
      
      // ターン数超過チェック
      if (this.turnCount >= this.maxTurns) {
        this.timeOver();
        return;
      }
      return;
    }

    // ターンカウント増加
    this.turnCount++;
    this.updateTurnCounter();
    
    // ターン数超過で強制敗北
    if (this.turnCount >= this.maxTurns) {
      this.timeOver();
      return;
    }
    
    // 攻撃実行
    await this.playAnimation('enemyAttack');
    
    const damage = 12;
    this.addLog(`${this.enemy.name}の攻撃！${damage}ダメージ！`);
    
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }

  updateTurnCounter() {
    const remaining = Math.max(0, this.maxTurns - this.turnCount);
    this.turnText.setText(`残りターン: ${remaining}`);
    
    // 残り2ターン以下で警告色
    if (remaining <= 2 && remaining > 0) {
      this.turnText.setColor('#ff6600');
      this.addLog(`⚠️ あと${remaining}ターンしかありません！`);
      
      this.tweens.add({
        targets: this.turnText,
        scale: { from: 1, to: 1.2, to: 1 },
        duration: 500,
        ease: 'Bounce.Out'
      });
    } else if (remaining === 0) {
      this.turnText.setColor('#ff0000');
      this.turnText.setText('⚠️ 時間切れ！');
    }
  }

  timeOver() {
    // 時間切れ演出
    this.addLog('💀💀💀 時間切れ！タイムイーターに時間を奪われた！ 💀💀💀');
    this.addLog('⏰ 5ターン以内に倒せませんでした...');
    
    // プレイヤーのHPをゼロにする
    this.player.hp = 0;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    // 画面揺れエフェクト
    this.cameras.main.shake(800, 0.02);
    
    // 画面を暗転
    const darkOverlay = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0
    );
    
    this.tweens.add({
      targets: darkOverlay,
      alpha: 0.7,
      duration: 1000,
      onComplete: () => {
        // 強制敗北
        this.time.delayedCall(1000, () => {
          this.gameOver(false);
        });
      }
    });
  }
}
