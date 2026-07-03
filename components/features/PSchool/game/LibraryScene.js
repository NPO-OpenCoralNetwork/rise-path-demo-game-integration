// LibraryScene.js - コマンド図鑑画面
export class LibraryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LibraryScene' });
    this.selectedCategory = 'basic';
    this.selectedBlock = null;
  }

  create() {
    console.log('LibraryScene initialized');
    
    // 実行ボタンを非表示にする
    this.hideRunButton();
    
    // 背景設定
    this.createBackground();
    
    // タイトル
    this.createTitle();
    
    // カテゴリーメニュー
    this.createCategoryMenu();
    
    // ブロック一覧
    this.createBlockList();
    
    // 詳細表示パネル
    this.createDetailPanel();
    
    // 検索機能
    this.createSearchBar();
    
    console.log('LibraryScene setup complete');
  }

  createBackground() {
    // 図書館のような背景
    const bg = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x2c1810);
    
    // 本棚の装飾
    this.createLibraryDecorations();
  }

  createLibraryDecorations() {
    // 本棚
    for (let i = 0; i < 5; i++) {
      const shelf = this.add.rectangle(this.scale.width * 0.06 + i * (this.scale.width * 0.19), this.scale.height * 0.67, this.scale.width * 0.15, this.scale.height * 0.33, 0x8b4513);
      
      // 本の装飾
      for (let j = 0; j < 8; j++) {
        const bookColors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xf0932b];
        const book = this.add.rectangle(
          this.scale.width * 0.025 + i * (this.scale.width * 0.19) + j * (this.scale.width * 0.019), 
          this.scale.height * 0.53 + Math.random() * 20, 
          12, 
          60 + Math.random() * 40, 
          bookColors[Math.floor(Math.random() * bookColors.length)]
        );
      }
    }
  }

  createTitle() {
    this.add.text(this.scale.width / 2, this.scale.height * 0.08, 'コマンド図鑑', {
      fontSize: '32px',
      fontFamily: 'Arial Black',
      fill: '#f39c12',
      stroke: '#2c3e50',
      strokeThickness: 3
    }).setOrigin(0.5);

    // 戻るボタン
    const backButton = this.add.text(50, this.scale.height * 0.08, '← ホームへ', {
      fontSize: '18px',
      fontFamily: 'Arial',
      fill: '#3498db',
      stroke: '#2c3e50',
      strokeThickness: 1
    }).setOrigin(0, 0.5);

    backButton.setInteractive();
    backButton.on('pointerdown', () => {
      this.scene.start('HomeScene');
    });
  }

  createCategoryMenu() {
    const categories = [
      { key: 'basic', name: '基本アクション', color: 0x4C97FF },
      { key: 'magic', name: '魔法詠唱', color: 0xffffe0 },
      { key: 'healing', name: '回復魔法', color: 0x008b8b },
      { key: 'control', name: '制御', color: 0x3c9966 },
      { key: 'variables', name: '変数', color: 0xa055d4 },
      { key: 'functions', name: '関数', color: 0xff6680 },
      { key: 'weapons', name: '武器強化', color: 0x8b4513 },
      { key: 'robustness', name: '堅牢性', color: 0x4a4a4a }
    ];

    this.categoryButtons = [];

    categories.forEach((category, index) => {
      const x = this.scale.width * 0.125;
      const y = this.scale.height * 0.2 + index * (this.scale.height * 0.067);
      
      const button = this.createCategoryButton(x, y, category.name, category.key, category.color);
      this.categoryButtons.push(button);
    });

    // 初期選択
    this.selectCategory('basic');
  }

  createCategoryButton(x, y, name, key, color) {
    const button = this.add.rectangle(x, y, 180, 35, 0x34495e, 0.8);
    button.setStrokeStyle(2, color);

    const text = this.add.text(x, y, name, {
      fontSize: '14px',
      fontFamily: 'Arial',
      fill: '#ecf0f1'
    }).setOrigin(0.5);

    button.setInteractive();

    button.on('pointerover', () => {
      button.setFillStyle(color, 0.3);
    });

    button.on('pointerout', () => {
      if (this.selectedCategory !== key) {
        button.setFillStyle(0x34495e, 0.8);
      }
    });

    button.on('pointerdown', () => {
      this.selectCategory(key);
    });

    return { button, text, key, color };
  }

  selectCategory(categoryKey) {
    this.selectedCategory = categoryKey;
    
    // ボタンの見た目を更新
    this.categoryButtons.forEach(item => {
      if (item.key === categoryKey) {
        item.button.setFillStyle(item.color, 0.6);
      } else {
        item.button.setFillStyle(0x34495e, 0.8);
      }
    });

    // ブロック一覧を更新
    this.updateBlockList();
  }

  createBlockList() {
    this.blockListContainer = this.add.container(0, 0);
    this.updateBlockList();
  }

  updateBlockList() {
    // 既存のブロック一覧をクリア
    this.blockListContainer.removeAll(true);

    const blocks = this.getBlocksForCategory(this.selectedCategory);
    
    blocks.forEach((block, index) => {
      const x = 350;
      const y = 150 + index * 60;
      
      this.createBlockItem(x, y, block);
    });
  }

  createBlockItem(x, y, blockData) {
    const container = this.add.container(x, y);

    // ブロックアイコン
    const icon = this.add.rectangle(0, 0, 200, 50, blockData.color, 0.8);
    icon.setStrokeStyle(2, 0xffffff);

    // ブロック名
    const name = this.add.text(0, -10, blockData.name, {
      fontSize: '16px',
      fontFamily: 'Arial Bold',
      fill: '#ffffff'
    }).setOrigin(0.5);

    // 簡単な説明
    const description = this.add.text(0, 10, blockData.shortDescription, {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#bdc3c7',
      wordWrap: { width: 180 }
    }).setOrigin(0.5);

    container.add([icon, name, description]);

    // インタラクティブ設定
    icon.setInteractive();
    icon.on('pointerover', () => {
      icon.setFillStyle(blockData.color, 1);
      container.setScale(1.05);
    });

    icon.on('pointerout', () => {
      icon.setFillStyle(blockData.color, 0.8);
      container.setScale(1);
    });

    icon.on('pointerdown', () => {
      this.selectBlock(blockData);
    });

    this.blockListContainer.add(container);
  }

  getBlocksForCategory(category) {
    const blockDatabase = {
      basic: [
        {
          name: '攻撃する',
          shortDescription: '敵に攻撃を行う基本アクション',
          color: 0x4C97FF,
          usage: 'attack()',
          parameters: 'なし',
          description: '敵に対して基本的な物理攻撃を行います。最も基本的なアクションブロックです。',
          example: '敵のHPを20減らします。'
        },
        {
          name: '左手を振る',
          shortDescription: '魔法詠唱で左手を振る',
          color: 0x4C97FF,
          usage: 'wave_left_hand()',
          parameters: 'なし',
          description: '魔法詠唱の際に左手を振るアクションです。詠唱パターンの一部として使用します。',
          example: '詠唱パターン: 左→右→左'
        },
        {
          name: '右手を振る',
          shortDescription: '魔法詠唱で右手を振る',
          color: 0x4C97FF,
          usage: 'wave_right_hand()',
          parameters: 'なし',
          description: '魔法詠唱の際に右手を振るアクションです。詠唱パターンの一部として使用します。',
          example: '詠唱パターン: 右→右→左'
        },
        {
          name: '待機',
          shortDescription: '指定した秒数待機する',
          color: 0x4C97FF,
          usage: 'wait_seconds(秒数)',
          parameters: '秒数: 待機する時間（数値）',
          description: '指定した秒数だけ行動を停止します。タイミング調整に使用します。',
          example: 'wait_seconds(2) → 2秒間待機'
        }
      ],
      magic: [
        {
          name: '魔法を唱える',
          shortDescription: '指定した魔法を発動',
          color: 0xffffe0,
          usage: 'cast_magic(魔法タイプ)',
          parameters: '魔法タイプ: FIRE, ICE, THUNDER',
          description: '指定した属性の魔法を唱えます。事前に正しい詠唱パターンが必要です。',
          example: 'cast_magic("FIRE") → 炎の魔法'
        },
        {
          name: '氷の魔法',
          shortDescription: '氷属性の魔法を発動',
          color: 0xffffe0,
          usage: 'cast_ice_magic()',
          parameters: 'なし',
          description: '氷属性の魔法を発動します。炎属性の敵に効果的です。',
          example: '敵に氷のダメージを与える'
        }
      ],
      healing: [
        {
          name: '回復魔法',
          shortDescription: 'HPを回復する魔法',
          color: 0x008b8b,
          usage: 'cast_healing()',
          parameters: 'なし',
          description: '回復魔法を使用してHPを回復します。正しい詠唱パターンが必要です。',
          example: 'HPを30回復'
        }
      ],
      control: [
        {
          name: '2回繰り返す',
          shortDescription: '中のブロックを2回実行',
          color: 0x3c9966,
          usage: 'repeat_twice()',
          parameters: 'なし',
          description: '内部のブロックを2回繰り返し実行します。',
          example: '攻撃を2回連続で実行'
        },
        {
          name: '3回繰り返す',
          shortDescription: '中のブロックを3回実行',
          color: 0x3c9966,
          usage: 'repeat_three_times()',
          parameters: 'なし',
          description: '内部のブロックを3回繰り返し実行します。',
          example: '魔法を3回連続で詠唱'
        }
      ],
      variables: [
        {
          name: '変数を設定',
          shortDescription: '変数に値を設定',
          color: 0xa055d4,
          usage: 'set_variable(変数名, 値)',
          parameters: '変数名: 変数の名前, 値: 設定する値',
          description: '指定した変数に値を設定します。',
          example: 'set_variable("counter", 0)'
        },
        {
          name: '変数を変更',
          shortDescription: '変数の値を変更',
          color: 0xa055d4,
          usage: 'change_variable(変数名, 変化量)',
          parameters: '変数名: 変数の名前, 変化量: 加算する値',
          description: '指定した変数の値を指定した量だけ変更します。',
          example: 'change_variable("counter", 1)'
        }
      ],
      functions: [
        {
          name: '関数を定義',
          shortDescription: '新しい関数を定義',
          color: 0xff6680,
          usage: 'define_function(関数名)',
          parameters: '関数名: 作成する関数の名前',
          description: '再利用可能な関数を定義します。',
          example: 'define_function("combo_attack")'
        },
        {
          name: '関数を呼び出す',
          shortDescription: '定義した関数を実行',
          color: 0xff6680,
          usage: 'call_function(関数名)',
          parameters: '関数名: 実行する関数の名前',
          description: '定義済みの関数を呼び出して実行します。',
          example: 'call_function("combo_attack")'
        }
      ],
      weapons: [
        {
          name: '武器強化',
          shortDescription: '武器を強化する',
          color: 0x8b4513,
          usage: 'upgrade_weapon(素材, 量)',
          parameters: '素材: iron/silver/gold/mithril, 量: 使用する素材の量',
          description: '指定した素材を使って武器を強化します。',
          example: 'upgrade_weapon("iron", 3)'
        },
        {
          name: '武器変更',
          shortDescription: '武器の種類を変更',
          color: 0x8b4513,
          usage: 'change_weapon(武器タイプ)',
          parameters: '武器タイプ: sword/axe/spear/bow/staff',
          description: '使用する武器の種類を変更します。',
          example: 'change_weapon("sword")'
        }
      ],
      robustness: [
        {
          name: '堅牢な攻撃',
          shortDescription: '無効化に対応した攻撃',
          color: 0x4a4a4a,
          usage: 'robust_attack()',
          parameters: 'なし',
          description: 'ブロックが無効化されても動作する堅牢な攻撃を実行します。',
          example: '代替手段を自動選択'
        },
        {
          name: 'エラーハンドリング',
          shortDescription: 'エラーを処理する',
          color: 0x4a4a4a,
          usage: 'try_catch_block()',
          parameters: 'なし',
          description: 'エラーが発生した場合の代替処理を定義します。',
          example: 'try { 攻撃 } catch { 回復 }'
        }
      ]
    };

    return blockDatabase[category] || [];
  }

  createDetailPanel() {
    // 詳細表示パネル
    this.detailPanel = this.add.rectangle(600, 350, 350, 300, 0x2c3e50, 0.9);
    this.detailPanel.setStrokeStyle(2, 0x3498db);

    // 詳細情報テキスト
    this.detailTitle = this.add.text(600, 220, 'ブロックを選択してください', {
      fontSize: '18px',
      fontFamily: 'Arial Bold',
      fill: '#ecf0f1'
    }).setOrigin(0.5);

    this.detailUsage = this.add.text(600, 250, '', {
      fontSize: '14px',
      fontFamily: 'monospace',
      fill: '#f39c12',
      backgroundColor: '#2c3e50',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5);

    this.detailDescription = this.add.text(600, 300, '', {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#bdc3c7',
      wordWrap: { width: 320 },
      align: 'center'
    }).setOrigin(0.5);

    this.detailParameters = this.add.text(600, 360, '', {
      fontSize: '11px',
      fontFamily: 'Arial',
      fill: '#95a5a6',
      wordWrap: { width: 320 },
      align: 'center'
    }).setOrigin(0.5);

    this.detailExample = this.add.text(600, 420, '', {
      fontSize: '11px',
      fontFamily: 'Arial',
      fill: '#27ae60',
      wordWrap: { width: 320 },
      align: 'center'
    }).setOrigin(0.5);

    // 試してみるボタン
    this.tryButton = this.add.text(600, 470, '試してみる', {
      fontSize: '16px',
      fontFamily: 'Arial',
      fill: '#ffffff',
      backgroundColor: '#e74c3c',
      padding: { x: 15, y: 8 }
    }).setOrigin(0.5);

    this.tryButton.setInteractive();
    this.tryButton.setVisible(false);

    this.tryButton.on('pointerdown', () => {
      this.tryBlock();
    });
  }

  selectBlock(blockData) {
    this.selectedBlock = blockData;
    
    // 詳細情報を更新
    this.detailTitle.setText(blockData.name);
    this.detailUsage.setText(blockData.usage);
    this.detailDescription.setText(blockData.description);
    this.detailParameters.setText(`パラメータ: ${blockData.parameters}`);
    this.detailExample.setText(`例: ${blockData.example}`);
    
    this.tryButton.setVisible(true);
  }

  createSearchBar() {
    // 検索バー（簡易版）
    const searchBg = this.add.rectangle(600, 120, 200, 30, 0x34495e, 0.9);
    searchBg.setStrokeStyle(1, 0x7f8c8d);

    const searchText = this.add.text(520, 120, '🔍 検索:', {
      fontSize: '14px',
      fontFamily: 'Arial',
      fill: '#bdc3c7'
    }).setOrigin(0, 0.5);

    const searchPlaceholder = this.add.text(600, 120, 'ブロック名を入力...', {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#7f8c8d'
    }).setOrigin(0.5);

    // 実際の検索機能は簡略化
    searchBg.setInteractive();
    searchBg.on('pointerdown', () => {
      console.log('Search functionality (to be implemented)');
    });
  }

  tryBlock() {
    if (!this.selectedBlock) return;

    console.log(`Trying block: ${this.selectedBlock.name}`);
    
    // デモ用のプレビューウィンドウを表示
    this.showBlockPreview();
  }

  showBlockPreview() {
    // プレビューウィンドウ
    const previewBg = this.add.rectangle(400, 300, 600, 400, 0x000000, 0.8);
    previewBg.setInteractive();

    const previewPanel = this.add.rectangle(400, 300, 500, 300, 0x2c3e50, 0.95);
    previewPanel.setStrokeStyle(3, 0x3498db);

    const previewTitle = this.add.text(400, 200, `${this.selectedBlock.name} のプレビュー`, {
      fontSize: '20px',
      fontFamily: 'Arial Bold',
      fill: '#ecf0f1'
    }).setOrigin(0.5);

    const previewCode = this.add.text(400, 250, this.selectedBlock.usage, {
      fontSize: '16px',
      fontFamily: 'monospace',
      fill: '#f39c12',
      backgroundColor: '#1e2021',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5);

    const previewDesc = this.add.text(400, 300, 'このブロックの動作をシミュレーション中...', {
      fontSize: '14px',
      fontFamily: 'Arial',
      fill: '#bdc3c7'
    }).setOrigin(0.5);

    // 閉じるボタン
    const closeBtn = this.add.text(500, 170, '✕', {
      fontSize: '20px',
      fontFamily: 'Arial',
      fill: '#e74c3c'
    }).setOrigin(0.5);

    closeBtn.setInteractive();
    closeBtn.on('pointerdown', () => {
      previewBg.destroy();
      previewPanel.destroy();
      previewTitle.destroy();
      previewCode.destroy();
      previewDesc.destroy();
      closeBtn.destroy();
    });

    // 簡単なアニメーション効果
    previewPanel.setScale(0);
    this.tweens.add({
      targets: previewPanel,
      scaleX: 1,
      scaleY: 1,
      duration: 300,
      ease: 'Back.easeOut'
    });
  }

  // 実行ボタンを非表示にするヘルパーメソッド
  hideRunButton() {
    const runButton = document.getElementById('runButton');
    if (runButton) {
      runButton.style.display = 'none';
    }
  }
}
