import { BattleScene } from './battle.js';

// ステージ12「条件分岐と攻撃対応」用のバトルシーン
export class BattleScene12 extends BattleScene {
  constructor() {
    super({ key: 'Stage12Battle' });
    this.settings = {
      background: 'wildforest',
      enemy: '野獣使い',
      stageNumber: 12
    };
    
    // ビーストマスターの状態管理
    this.beastState = {
      lastAttackType: null,
      consecutiveSameAttack: 0
    };
  }

  create() {
    super.create();
    
    // カスタム変数とリストの初期化（ステージ12用）
    this.customVariables = {
      '敵の技名': ''
    };
    this.customLists = {};
    
    console.log('🎮 BattleScene12: カスタム変数/リスト初期化完了');
    console.log('   customVariables:', this.customVariables);
    console.log('   customLists:', this.customLists);
    
    // 敵の名前を設定
    if (this.enemy) {
      this.enemy.setName('ビーストマスター');
    }
    
    // ステージ12の設定
    this.setupStageCommon({
      backgroundColor: 0x006400, // 野生の森の深緑色背景
      enemyTint: 0x8B4513, // ビーストマスターの茶色
      enemyHp: 80,
      startMessage: `ステージ12「条件分岐とカウンター」が始まりました！ビーストマスターと対決します！`,
      availableBlocks: ['attack_basic', 'heal_magic', 'cast_magic', 'set_attack_name', 'attack_name', 'if_condition', 'text_equals', 'number', 'wave_left_hand', 'wave_right_hand', 'wait', 'cast_magic_value', 'custom_variable_get']
    });
    
    this.createWildEffect();
  }

  createWildEffect() {
    // 野生の森エフェクト
    const leaves = this.add.graphics();
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * this.scale.width;
      const y = Math.random() * 200;
      leaves.fillStyle(0x228B22, 0.7);
      leaves.fillEllipse(x, y, 8, 4);
      
      this.tweens.add({
        targets: leaves,
        x: x + 100,
        y: y + this.scale.height,
        rotation: Math.PI * 2,
        duration: 4000 + i * 500,
        repeat: -1,
        delay: i * 400
      });
    }
  }

  async enemyAction() {
    if (this.battleEnded) return;
    
    const attacks = ['獣の咆哮', 'ペット連携攻撃', '野生の本能'];
    const attackName = attacks[Math.floor(Math.random() * attacks.length)];
    
    // 同じ攻撃の連続使用をカウント
    if (attackName === this.beastState.lastAttackType) {
      this.beastState.consecutiveSameAttack++;
    } else {
      this.beastState.consecutiveSameAttack = 1;
    }
    this.beastState.lastAttackType = attackName;
    
    // 攻撃名に応じてダメージ変化
    let damage = 15;
    if (attackName === '獣の咆哮') {
      damage = 18; // 高威力
    } else if (attackName === 'ペット連携攻撃') {
      damage = 12; // 中威力・連続攻撃
    } else if (attackName === '野生の本能') {
      damage = 80; // 超高威力！必ず氷の盾で防御が必要
    }
    
    // 連続同一攻撃でダメージ増加
    if (this.beastState.consecutiveSameAttack >= 2) {
      damage += 5;
      this.ui.log(`⚠️ ${attackName}が強化されています！（${this.beastState.consecutiveSameAttack}連続）`);
    }
    
    // ⭐ 重要：攻撃実行前にシステム変数を設定
    this.customVariables['敵の技名'] = attackName;
    console.log('🎯 Enemy selected attack:', attackName);
    console.log('🎯 System variable set:', this.customVariables);
    
    // ⭐ プレイヤーの条件分岐コマンドを評価（カウンターチェック）
    const counterResult = await this.checkPlayerCounter(attackName);
    
    if (counterResult.success) {
      this.ui.log(`✨ プレイヤーが${attackName}に対応しました！`);
      
      // 各魔法の効果を適用
      if (counterResult.usedSpell === '氷の盾') {
        this.ui.log(`🛡️ 氷の盾が展開され、攻撃を完全に防ぎました！`);
      } else if (counterResult.usedSpell === '炎の魔法') {
        this.ui.log(`🔥 炎の魔法で反撃！敵に15ダメージ！`);
        this.enemy.hp -= 15;
        this.updateHP(this.player.hp, this.enemy.hp);
      } else if (counterResult.usedSpell === '雷の魔法') {
        this.ui.log(`⚡ 雷の魔法で反撃！敵に12ダメージ！`);
        this.enemy.hp -= 12;
        this.updateHP(this.player.hp, this.enemy.hp);
      } else if (counterResult.usedSpell === '水の魔法') {
        this.ui.log(`💧 水の魔法で反撃！敵に10ダメージ！`);
        this.enemy.hp -= 10;
        this.updateHP(this.player.hp, this.enemy.hp);
      } else if (counterResult.usedSpell) {
        // その他の魔法でもカウンター成功
        this.ui.log(`✨ ${counterResult.usedSpell}で対応し、攻撃を防ぎました！`);
      }
      
      // カウンター成功時は敵の攻撃をキャンセル
      return;
    } else if (counterResult.attempted) {
      // カウンターを試みたが間違った魔法を使用（野生の本能の場合のみ）
      this.ui.log(`❌ ${counterResult.usedSpell}では${attackName}を防げません！`);
      this.ui.log(`💡 ヒント: ${attackName}には氷の盾が必要です！`);
    }
    
    // カウンター不成立の場合、通常通り攻撃を実行
    // enemy.jsのperformAttackメソッドを使用
    this.enemy.performAttack(attackName, damage);
  }
  
  async checkPlayerCounter(attackName) {
    // プレイヤーのBlocklyコマンドを取得して評価
    if (!window.blocklyWorkspace) {
      console.log('⚠️ No Blockly workspace found');
      return { success: false, attempted: false };
    }
    
    const topBlocks = window.blocklyWorkspace.getTopBlocks(true);
    if (topBlocks.length === 0) {
      console.log('⚠️ No blocks in workspace');
      return { success: false, attempted: false };
    }
    
    console.log('🔍 Checking player counter commands...');
    
    // ASTを生成
    const blockToAST = window.blockToAST || function(block) {
      const ast = { type: block.type, fields: {}, children: [] };
      const inputList = block.inputList;
      for (const input of inputList) {
        for (const field of input.fieldRow) {
          if (field.name) {
            ast.fields[field.name] = field.getValue();
          }
        }
      }
      for (const input of inputList) {
        if (input.connection && input.connection.targetBlock()) {
          const childBlock = input.connection.targetBlock();
          ast.children.push(blockToAST(childBlock));
        }
      }
      if (block.nextConnection && block.nextConnection.targetBlock()) {
        const nextBlock = block.nextConnection.targetBlock();
        return [ast, blockToAST(nextBlock)];
      }
      return ast;
    };
    
    const ast = topBlocks.map(block => blockToAST(block));
    console.log('🔍 Player AST:', JSON.stringify(ast, null, 2));
    
    // convertASTToActionsを使用してアクションを生成
    if (typeof window.convertASTToActions === 'function') {
      const actions = window.convertASTToActions(ast, this);
      console.log('🔍 Generated counter actions:', actions);
      
      if (actions && actions.length > 0) {
        console.log('✅ Counter conditions matched! Executing player actions...');
        
        // 使用された魔法を特定
        let usedSpell = null;
        for (const action of actions) {
          if (action.action_type === 'StartIncantation' && action.parameters.spellName) {
            usedSpell = action.parameters.spellName;
            console.log('🔍 Player used spell:', usedSpell);
            break;
          }
        }
        
        // 野生の本能だけは氷の盾が必須、他の攻撃はどの魔法でもOK
        if (attackName === '野生の本能' && usedSpell !== '氷の盾') {
          console.log(`❌ Wrong spell for ${attackName}! Need 氷の盾, but used:`, usedSpell);
          
          // プレイヤーのアクションを実行（間違った魔法でも詠唱は実行される）
          const ui = this.ui;
          const game = { scene: this, player: this.player, enemy: this.enemy };
          
          for (const action of actions) {
            if (typeof window.executeGameAction === 'function') {
              await window.executeGameAction(action, game, ui);
            }
          }
          
          // 警告メッセージを表示
          this.ui.log(`❌ ${usedSpell}では${attackName}を防げません！`);
          this.ui.log(`💡 ヒント: ${attackName}には氷の盾が必要です！`);
          
          return { success: false, attempted: true, usedSpell: usedSpell };
        }
        
        // プレイヤーのアクションを実行
        const ui = this.ui;
        const game = { scene: this, player: this.player, enemy: this.enemy };
        
        for (const action of actions) {
          if (typeof window.executeGameAction === 'function') {
            await window.executeGameAction(action, game, ui);
          }
        }
        
        return { success: true, attempted: true, usedSpell: usedSpell }; // カウンター成功
      }
    }
    
    console.log('❌ No matching counter conditions');
    return { success: false, attempted: false }; // カウンター不成立
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
