import Phaser from "phaser";
import { BattleScene } from "./battle";

// ステージ6「薬の調合」用のバトルシーン
export class BattleScene6 extends BattleScene {
  constructor() {
    super({ key: "Stage6Battle" });
    this.settings = {
      background: 'numa',
      enemy: 'ポイズンモス',
      stageNumber: 6
    };
    
    // プレイヤーの毒状態管理
    this.playerPoisoned = false;
    this.poisonDamage = 20;
    this.antidotes = 0;
  }

  create() {
    super.create();
    
    // ステージ6の設定
    this.setupStageCommon({
      backgroundColor: 0x2d4a2d, // 研究室の緑色背景
      enemyTint: 0x4d0080, // ポイズンコングの紫色
      enemyHp: 35,
      startMessage: `ステージ6「薬の調合」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'wave_left_hand', 'wave_right_hand', 'cast_magic', 'wait']
    });
    
    this.createLabEffect();
    this.setupPoisonSystem();
  }

  createLabEffect() {
    // 研究室のエフェクト
    const bubbles = this.add.graphics();
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * this.scale.width;
      const y = this.scale.height * 0.8 + Math.random() * 100;
      bubbles.fillStyle(0x00ff00, 0.5);
      bubbles.fillCircle(x, y, 8);
      
      this.tweens.add({
        targets: bubbles,
        y: y - 200,
        alpha: 0,
        duration: 3000,
        repeat: -1,
        delay: i * 500
      });
    }
  }

  setupPoisonSystem() {
    // 毒システムの初期化
    this.statusText = this.add.text(10, 150, 'ステータス: 正常', {
      fontSize: '16px',
      fill: '#00ff00'
    });
  }

  // 敵のターン処理をオーバーライド
  async enemyTurn() {
    await this.playAnimation('enemyAttack_poison');
    
    const damage = 8;
    this.addLog(`${this.enemy.name}の毒攻撃！${damage}ダメージ！`);
    
    this.player.hp -= damage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    // 50%の確率で毒を付与
    if (Math.random() < 0.5) {
      this.applyPoison();
    }
    
    // 毒状態なら追加ダメージ
    if (this.playerPoisoned) {
      this.applyPoisonDamage();
    }
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }

  applyPoison() {
    if (!this.playerPoisoned) {
      this.playerPoisoned = true;
      this.addLog('💚 毒状態になりました！プレイヤーターン後に30ダメージを受けます！');
      this.statusText.setText('ステータス: 毒');
      this.statusText.setFill('#ff0000');
    }
  }

  applyPoisonDamage() {
    this.addLog(`💀 毒のダメージ！${this.poisonDamage}ダメージ！`);
    this.player.hp -= this.poisonDamage;
    this.updateHP(this.player.hp, this.enemy.hp);
    
    if (this.player.hp <= 0) {
      this.gameOver(false);
    }
  }

  // 魔法詠唱システムで解毒薬を調合
  applyAntidoteEffect() {
    this.antidotes++;
    this.addLog('🧪 解毒薬を調合しました！在庫: ' + this.antidotes);
  }

  // 魔法詠唱システムで解毒薬を使用
  applyCurePoisonEffect() {
    if (this.playerPoisoned && this.antidotes > 0) {
      this.playerPoisoned = false;
      this.antidotes--;
      this.addLog('💙 解毒薬を使用！毒が治りました！残り在庫: ' + this.antidotes);
      this.statusText.setText('ステータス: 正常');
      this.statusText.setFill('#00ff00');
    } else if (!this.playerPoisoned) {
      this.addLog('⚠️ 毒状態ではありません');
    } else if (this.antidotes <= 0) {
      this.addLog('⚠️ 解毒薬がありません！先に調合してください');
    }
  }
}
