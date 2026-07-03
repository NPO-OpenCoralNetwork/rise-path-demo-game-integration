import Phaser from 'phaser';
import { BattleScene } from './battle';

// ステージ3「魔法の詠唱」用のバトルシーン
export class BattleScene3 extends BattleScene {
  constructor() {
    super({ key: 'Stage3Battle' });
    this.settings = {
      background: 'snow',
      enemy: 'アイスゴーレム',
      stageNumber: 3
    };
    
    // 魔法詠唱の状態を追跡
    this.spellCastState = {
      sequence: [],
      isActive: false,
      requiredPattern: ['right', 'right', 'left'] // 炎の魔法のパターン
    };
  }

  create() {
    super.create();
    
    // ステージ3の設定
    this.setupStageCommon({
      enemyHp: 20,
      startMessage: `ステージ3「魔法の詠唱」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: ['attack_basic', 'wave_left_hand', 'wave_right_hand', 'cast_magic', 'wait']
    });
    
  }

}
