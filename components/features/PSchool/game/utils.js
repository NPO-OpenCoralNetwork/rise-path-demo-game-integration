export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ステージ情報の定義
export const BATTLE_STAGES = [
  {
    key: 'Stage1WBattle',
    name: 'ステージ1: はじめての戦い',
    difficulty: 'Easy',
    params: {
      background: 'forest',
      enemy: 'goblin',
      stageNumber: 1,
      scratchMode: true
    }
  },
  {
    key: 'Stage2Battle',  // 'BattleScene2'から'Stage2Battle'に変更
    name: 'ステージ2: 回復の魔法',
    difficulty: 'Easy',
    params: {
      background: 'swamp',
      enemy: 'poisonmoth',
      stageNumber: 2,
      scratchMode: true
    }
  },
  {
    key: 'Stage3Battle',  // 'BattleScene3'のキー
    name: 'ステージ3: 魔法の詠唱',
    difficulty: 'Easy',
    params: {
      background: 'volcano',
      enemy: 'firegoblin',
      stageNumber: 3,
      scratchMode: true
    }
  },
  {
    key: 'Stage4Battle',  // 'BattleScene4'のキー
    name: 'ステージ4: 氷の壁',
    difficulty: 'Easy',
    params: {
      background: 'snow',
      enemy: 'flamewolf',
      stageNumber: 4,
      scratchMode: true
    }
  },
  {
    key: 'Stage5Battle',  // 'BattleScene5'のキー
    name: 'ステージ5: 時間との勝負',
    difficulty: 'Easy',
    params: {
      background: 'clock',
      enemy: 'timeeater',
      stageNumber: 5,
      scratchMode: true
    }
  },
  {
    key: 'Stage6Battle',  // 'BattleScene6'のキー
    name: 'ステージ6: 薬の調合',
    difficulty: 'Normal',
    params: {
      background: 'laboratory',
      enemy: 'poisonkong',
      stageNumber: 6,
      scratchMode: true
    }
  },
  {
    key: 'Stage7Battle',  // 'BattleScene7'のキー
    name: 'ステージ7: 雷の力',
    difficulty: 'Normal',
    params: {
      background: 'metalcavern',
      enemy: 'metalslime',
      stageNumber: 7,
      scratchMode: true
    }
  },
  {
    key: 'Stage8Battle',  // 'BattleScene8'のキー
    name: 'ステージ8: 行動の繰り返し',
    difficulty: 'Normal',
    params: {
      background: 'camp',
      enemy: 'goblins',
      stageNumber: 8,
      scratchMode: true
    }
  },
  {
    key: 'Stage9Battle',
    name: 'ステージ9: 魔法の連携',
    difficulty: 'Hard',
    params: {
      background: 'cave',
      enemy: 'shadowbat',
      stageNumber: 9,
      scratchMode: true
    }
  },
  {
    key: 'Stage10Battle',
    name: 'ステージ10: 初級ボス戦',
    difficulty: 'Boss',
    params: {
      background: 'darkfortress',
      enemy: 'darkknight',
      stageNumber: 10,
      scratchMode: true
    }
  },  {
    key: 'Stage11Battle',
    name: 'ステージ11: 初めての変数',
    difficulty: 'Beginner',
    params: {
      background: 'mysticalforest',
      enemy: 'miragewizard',
      stageNumber: 11,
      scratchMode: true
    }
  },  {
    key: 'Stage12Battle',
    name: 'ステージ12: HP管理',
    difficulty: 'Beginner',
    params: {
      background: 'wildforest',
      enemy: 'beastmaster',
      stageNumber: 12,
      scratchMode: true
    }
  },  {
    key: 'Stage13Battle',
    name: 'ステージ13: 攻撃パターン分析',
    difficulty: 'Hard',
    params: {
      background: 'ancientruins',
      enemy: 'patterngolem',
      stageNumber: 13,
      scratchMode: true
    }
  },  {
    key: 'Stage14Battle',
    name: 'ステージ14: 初めての条件分岐',
    difficulty: 'Hard',
    params: {
      background: 'enchantedforest',
      enemy: 'forestguardian',
      stageNumber: 14,
      scratchMode: true
    }
  },  {
    key: 'Stage15Battle',
    name: 'ステージ15: 属性の有効活用',
    difficulty: 'Hard',
    params: {
      background: 'mysticalcavern',
      enemy: 'elementalshifter',
      stageNumber: 15,
      scratchMode: true
    }
  },  {
    key: 'Stage16Battle',
    name: 'ステージ16: カウンターアタック',
    difficulty: 'Hard',
    params: {
      background: 'shadowrealm',
      enemy: 'mirrorknight',
      stageNumber: 16,
      scratchMode: true
    }
  },  {
    key: 'Stage17Battle',
    name: 'ステージ17: 初めての関数',
    difficulty: 'Hard',
    params: {
      background: 'graveyard',
      enemy: 'skeletonarmy',
      stageNumber: 17,
      scratchMode: true
    }
  },  {
    key: 'Stage18Battle',
    name: 'ステージ18: 薬の合成レシピ',
    difficulty: 'Hard',
    params: {
      background: 'laboratory',
      enemy: 'plaguedoctor',
      stageNumber: 18,
      scratchMode: true
    }  },
  {
    key: 'Stage19Battle',
    name: 'ステージ19: 武器の強化',
    difficulty: 'Hard',
    params: {
      background: 'armory',
      enemy: 'armsmaster',
      stageNumber: 19,
      scratchMode: true
    }
  },
  {
    key: 'Stage20Battle',
    name: 'ステージ20: 初級最終ボス',
    difficulty: 'Boss',
    params: {
      background: 'digital_void',
      enemy: 'codeeater',
      stageNumber: 20,
      scratchMode: true
    }
  }
];
