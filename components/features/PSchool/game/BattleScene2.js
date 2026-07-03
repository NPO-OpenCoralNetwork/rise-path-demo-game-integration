import Phaser from 'phaser';
import { BattleScene } from './battle';

// ステージ2「回復の魔法」用のバトルシーン
export class BattleScene2 extends BattleScene {
  constructor() {
    super({ key: 'Stage2Battle' });
    this.settings = {
      background: 'labo',
      enemy: 'ケミカルゴリラ',
      stageNumber: 2
    };
  }

  create() {
    super.create();
    
    // ステージ2の設定
    this.setupStageCommon({
      backgroundColor: 0x1a3300, // 沼地っぽい暗い緑色
      enemyTint: 0x99ff66, // 毒蛾の緑色
      enemyHp: 15,
      startMessage: `ステージ2「回復の魔法」が始まりました！毒を持つ${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'wait']
    });
    this.createPoisonEffect();
  }

  createPoisonEffect() {
    // 毒霧のエフェクト
    const poisonFog = this.add.graphics();
    poisonFog.fillStyle(0x99ff66, 0.2);
    poisonFog.fillRect(0, 0, this.scale.width, this.scale.height * 0.33);
    
    this.tweens.add({
      targets: poisonFog,
      alpha: { from: 0.2, to: 0.4 },
      duration: 2000,
      yoyo: true,
      repeat: -1
    });
  }
}
