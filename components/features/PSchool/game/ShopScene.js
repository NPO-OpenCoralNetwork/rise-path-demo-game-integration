// ShopScene.js - ショップ画面
export class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShopScene' });
    this.playerGold = 100;
    this.selectedItem = null;
  }

  create() {
    console.log('ShopScene initialized');
    
    // 実行ボタンを非表示にする
    this.hideRunButton();
    
    // プレイヤーデータの読み込み
    this.loadPlayerData();
    
    // 背景設定
    this.createBackground();
    
    // タイトル
    this.createTitle();
    
    // 通貨表示
    this.createCurrencyDisplay();
    
    // ショップアイテム
    this.createShopItems();
    
    // アイテム詳細パネル
    this.createItemDetailPanel();
    
    console.log('ShopScene setup complete');
  }

  loadPlayerData() {
    const savedData = JSON.parse(localStorage.getItem('codeOfRuinsPlayerData') || '{}');
    this.playerGold = savedData.gold || 100;
  }

  createBackground() {
    // ショップの背景
    const bg = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x2c1810);
    
    // ショップの装飾
    this.createShopDecorations();
  }

  createShopDecorations() {
    // カウンター
    const counter = this.add.rectangle(this.scale.width / 2, this.scale.height * 0.83, this.scale.width * 0.75, 80, 0x8b4513);
    
    // 棚
    for (let i = 0; i < 4; i++) {
      const shelf = this.add.rectangle(150 + i * 150, 350, 100, 120, 0x654321);
    }
    
    // 看板
    const sign = this.add.rectangle(400, 150, 200, 60, 0x8b4513);
    const signText = this.add.text(400, 150, 'ルーンズ商店', {
      fontSize: '18px',
      fontFamily: 'Arial',
      fill: '#ffd700'
    }).setOrigin(0.5);
  }

  createTitle() {
    this.add.text(this.scale.width / 2, this.scale.height * 0.08, 'ショップ', {
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

  createCurrencyDisplay() {
    // 所持金表示
    this.goldText = this.add.text(this.scale.width - 150, this.scale.height * 0.17, `💰 ${this.playerGold} G`, {
      fontSize: '20px',
      fontFamily: 'Arial',
      fill: '#ffd700',
      stroke: '#2c3e50',
      strokeThickness: 2
    });
  }

  createShopItems() {
    const items = this.getShopItems();
    
    items.forEach((item, index) => {
      const x = this.scale.width * 0.19 + (index % 4) * (this.scale.width * 0.19);
      const y = this.scale.height * 0.47 + Math.floor(index / 4) * (this.scale.height * 0.2);
      
      this.createShopItem(x, y, item);
    });
  }

  getShopItems() {
    return [
      {
        id: 'health_potion',
        name: 'ヘルスポーション',
        description: 'HPを50回復する',
        price: 30,
        icon: '🧪',
        type: 'consumable'
      },
      {
        id: 'mana_potion',
        name: 'マナポーション', 
        description: 'MPを30回復する',
        price: 25,
        icon: '💙',
        type: 'consumable'
      },
      {
        id: 'attack_boost',
        name: '攻撃力強化書',
        description: '攻撃力を永続的に+5',
        price: 100,
        icon: '⚔️',
        type: 'upgrade'
      },
      {
        id: 'defense_boost',
        name: '防御力強化書',
        description: '防御力を永続的に+3',
        price: 80,
        icon: '🛡️',
        type: 'upgrade'
      },
      {
        id: 'code_optimizer',
        name: 'コード最適化ツール',
        description: 'ブロック数ボーナス+10%',
        price: 150,
        icon: '🔧',
        type: 'tool'
      },
      {
        id: 'debug_helper',
        name: 'デバッグヘルパー',
        description: 'エラー時の自動修正',
        price: 120,
        icon: '🐛',
        type: 'tool'
      },
      {
        id: 'golden_scroll',
        name: '黄金の巻物',
        description: '経験値ボーナス+20%',
        price: 200,
        icon: '📜',
        type: 'special'
      },
      {
        id: 'mystery_box',
        name: '謎の宝箱',
        description: 'ランダムアイテム',
        price: 50,
        icon: '📦',
        type: 'mystery'
      }
    ];
  }

  createShopItem(x, y, item) {
    const container = this.add.container(x, y);
    
    // アイテムの背景
    const itemBg = this.add.rectangle(0, 0, 120, 100, 0x34495e, 0.8);
    itemBg.setStrokeStyle(2, this.getItemColor(item.type));
    
    // アイテムアイコン
    const icon = this.add.text(0, -20, item.icon, {
      fontSize: '32px'
    }).setOrigin(0.5);
    
    // アイテム名
    const name = this.add.text(0, 10, item.name, {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#ecf0f1',
      wordWrap: { width: 110 },
      align: 'center'
    }).setOrigin(0.5);
    
    // 価格
    const price = this.add.text(0, 35, `${item.price} G`, {
      fontSize: '14px',
      fontFamily: 'Arial Bold',
      fill: '#f1c40f'
    }).setOrigin(0.5);
    
    container.add([itemBg, icon, name, price]);
    
    // インタラクティブ設定
    itemBg.setInteractive();
    
    itemBg.on('pointerover', () => {
      this.selectItem(item);
      itemBg.setFillStyle(this.getItemColor(item.type), 0.3);
      container.setScale(1.05);
    });
    
    itemBg.on('pointerout', () => {
      itemBg.setFillStyle(0x34495e, 0.8);
      container.setScale(1);
    });
    
    itemBg.on('pointerdown', () => {
      this.buyItem(item);
    });
  }

  getItemColor(type) {
    const colors = {
      consumable: 0x27ae60,
      upgrade: 0xe74c3c,
      tool: 0x3498db,
      special: 0xf39c12,
      mystery: 0x9b59b6
    };
    return colors[type] || 0x95a5a6;
  }

  createItemDetailPanel() {
    // 詳細パネル
    this.detailPanel = this.add.rectangle(600, 450, 300, 150, 0x2c3e50, 0.9);
    this.detailPanel.setStrokeStyle(2, 0x3498db);
    
    this.detailTitle = this.add.text(600, 400, 'アイテムを選択してください', {
      fontSize: '16px',
      fontFamily: 'Arial Bold',
      fill: '#ecf0f1'
    }).setOrigin(0.5);
    
    this.detailDescription = this.add.text(600, 430, '', {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#ecf0f1',
      wordWrap: { width: 280 },
      align: 'center'
    }).setOrigin(0.5);
  }

  // 実行ボタンを非表示にするヘルパーメソッド
  hideRunButton() {
    const runButton = document.getElementById('runButton');
    if (runButton) {
      runButton.style.display = 'none';
    }
  }
}