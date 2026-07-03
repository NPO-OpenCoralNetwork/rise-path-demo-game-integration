import { BattleScene as BaseBattleScene } from './battle';

// ステージ1「基本の攻撃」用のバトルシーン
export class BattleScene extends BaseBattleScene {
    constructor() {
        super({ key: 'Stage1Battle' });
        this.settings = {
            background: 'grass',
            enemy: '森の精霊',
            enemyTexturePath: '/p_school/assets/serirei01.png',
            backgroundTexturePath: '/p_school/assets/battle-seen01.jpeg',
            scratchMode: true,
            stageNumber: 1
        };
    }

    async create() {
        super.create();
        
        // ステージ1の設定
        await this.setupStageCommon({
            backgroundColor: 0x228B22, // 森の緑色背景
            enemyHp: 25,
            startMessage: `ステージ1「基本の攻撃」が始まりました！${this.settings.enemy}と対決します！`,
            availableBlocks: ['attack_basic', 'wait']
        });
    }
}
