import { BattleScene } from './battle';
import stageData from './stages.json';

export class GenericBattleScene extends BattleScene {
  constructor(stageNumber) {
    // ユニークなキーを生成 (例: 'Stage1Battle')
    super({ key: `Stage${stageNumber}Battle` });
    this.stageNumber = stageNumber.toString();
    this.stageConfig = stageData.stages[this.stageNumber];
    
    if (!this.stageConfig) {
      console.error(`Stage ${stageNumber} configuration not found!`);
      // フォールバック設定
      this.stageConfig = stageData.stages["1"];
    }

    this.settings = {
      background: this.stageConfig.background,
      enemy: this.stageConfig.enemy.name,
      stageNumber: parseInt(stageNumber),
      // テクスチャのパスを直接指定
      enemyTexturePath: this.stageConfig.enemy.texture,
      backgroundTexturePath: this.stageConfig.backgroundImage,
      scratchMode: true
    };
  }

  async create() {
    // 親クラスのcreateを呼ぶ前に、特殊な設定があれば適用
    super.create();

    const config = this.stageConfig;

    // 共通セットアップ
    await this.setupStageCommon({
      backgroundColor: config.backgroundColor, // JSONになければundefined（デフォルト使用）
      enemyTint: config.enemy.tint,
      enemyHp: config.enemy.hp,
      startMessage: config.startMessage,
      availableBlocks: config.availableBlocks
    });

    // 特殊ギミックの初期化 (ステージ13など)
    if (config.specialMechanics) {
      this.setupSpecialMechanics(config.specialMechanics);
    }
  }

  setupSpecialMechanics(mechanics) {
    if (mechanics.type === 'twin_guard') {
      this.guardActive = true;
      this.comboGoal = mechanics.comboGoal || 3;
      this.currentFunctionHits = 0;
      this.addLog('敵は連携ガードを使っています。関数で連続攻撃して崩しましょう！');
      
      // イベントリスナーの設定など（必要に応じて）
    }
  }

  // ステージ固有のロジック（オーバーライドが必要な場合）
  // 以前の BattleScene13.js にあったような onExecuteSavedFunctionStart などをここで汎用的に処理するか、
  // あるいは mixin パターンで注入する必要があります。
  // 今回は簡易的に実装します。

  onExecuteSavedFunctionStart(name) {
    if (this.stageConfig.specialMechanics?.type === 'twin_guard') {
      this.currentFunctionHits = 0;
      this.addLog(`関数「${name}」による連携攻撃開始！`);
    }
  }

  onExecuteSavedFunctionEnd(name) {
    if (this.stageConfig.specialMechanics?.type === 'twin_guard') {
        if (this.currentFunctionHits < this.comboGoal) {
            this.addLog(`ガードを崩せませんでした（ヒット数: ${this.currentFunctionHits}/${this.comboGoal}）`);
        } else {
            this.addLog('ガード崩し成功！大ダメージのチャンス！');
            // ここでボーナスダメージなどを入れるロジック
        }
    }
  }
}
