import { GenericBattleScene } from './GenericBattleScene';

export function createStageScene(stageNumber) {
  // クラス名を動的に定義するために、無名クラスを拡張して返す
  return class extends GenericBattleScene {
    constructor() {
      super(stageNumber);
    }
  };
}
