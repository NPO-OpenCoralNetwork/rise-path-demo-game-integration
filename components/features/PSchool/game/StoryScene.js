// StoryScene.js - ビジュアルノベル風のストーリー画面
export class StoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StoryScene' });
    this.storyData = null;
    this.currentDialogueIndex = 0;
    this.dialogues = [];
    this.isTyping = false;
    this.typewriterTimer = null;
    this.currentText = '';
    this.targetText = '';
    this.charactersPerSecond = 30;
    this.stageNumber = 1;
  }

  init(data) {
    console.log('=== StoryScene INIT called ===');
    console.log('StoryScene initialized with data:', data);
    this.stageNumber = data.stage || 1;
    this.context = data.context || 'start'; // 'start' or 'victory'
    this.returnTo = data.returnTo || 'HomeScene'; // 次に遷移するシーン
    this.isDevelopmentMode = data.isDevelopmentMode || false; // 開発モードフラグ
    console.log('Stage number set to:', this.stageNumber);
    console.log('Context set to:', this.context);
    console.log('Return destination set to:', this.returnTo);
    console.log('Development mode:', this.isDevelopmentMode);
    this.loadStoryData(this.stageNumber, this.context);
  }

  preload() {
    // 背景画像やキャラクター画像の読み込み
    this.load.image('story_bg', '/p_school/assets/bg1.png');
    this.load.image('character1', '/p_school/assets/main-chara.png');
    this.load.image('character2', '/p_school/assets/serirei01.png');
  }

  create() {
    console.log('=== StoryScene CREATE called ===');
    console.log('StoryScene created for stage:', this.stageNumber);
    
    // ストーリーシーン中はブロックエディタを非表示にする
    this.hideBlockEditor();
    
    // 背景設定
    this.createBackground();
    
    // UI要素の作成
    this.createStoryUI();
    
    // 最初のダイアログを表示
    this.showDialogue();
    
    // クリックイベントの設定
    this.setupInputEvents();
    
    // リサイズイベントの登録
    this.scale.on('resize', this.resize, this);
    
    // シーン終了時のクリーンアップ登録
    this.events.on('shutdown', this.shutdown, this);
    
    console.log('StoryScene setup complete');
  }
  
  resize(gameSize) {
    // シーンがアクティブでない、またはカメラが存在しない場合は処理しない
    if (!this.scene.isActive() || !this.cameras || !this.cameras.main) {
      return;
    }

    const width = gameSize.width;
    const height = gameSize.height;
    
    this.cameras.main.setViewport(0, 0, width, height);
    
    if (this.bg) {
      this.bg.setPosition(width/2, height/2);
      this.bg.setDisplaySize(width, height);
    }
    
    if (this.overlay) {
      this.overlay.setPosition(width/2, height/2);
      this.overlay.setDisplaySize(width, height);
    }
    
    // UIの位置調整（簡易版）
    if (this.dialogueBg) {
      const dialogueY = height - 150;
      this.dialogueBg.clear();
      this.dialogueBg.fillStyle(0x000000, 0.8);
      this.dialogueBg.fillRoundedRect(20, dialogueY, width - 40, 120, 15);
      this.dialogueBg.lineStyle(3, 0xffd700, 1);
      this.dialogueBg.strokeRoundedRect(20, dialogueY, width - 40, 120, 15);
      
      if (this.characterNameText) {
        this.characterNameText.setPosition(50, dialogueY + 20);
      }
      
      if (this.dialogueText) {
        this.dialogueText.setPosition(50, dialogueY + 50);
        this.dialogueText.setStyle({ wordWrap: { width: width - 100 } });
      }
    }
    
    if (this.skipButton) {
        this.skipButton.setPosition(width - 230, 37);
        // 背景グラフィックスの再描画は複雑なので省略するか、コンテナ化して移動させるのがベター
    }
  }

  shutdown() {
    // イベントリスナーの解除
    this.scale.off('resize', this.resize, this);
  }

  // ブロックエディタを非表示にする
  hideBlockEditor() {
    const blocklyDiv = document.getElementById('blocklyDiv');
    if (blocklyDiv) {
      blocklyDiv.style.display = 'none';
    }
    
    const runButton = document.getElementById('runButton');
    if (runButton) {
      runButton.style.display = 'none';
    }
    
    const playerHP = document.getElementById('playerHP');
    if (playerHP) {
      playerHP.style.display = 'none';
    }
    
    const enemyHP = document.getElementById('enemyHP');
    if (enemyHP) {
      enemyHP.style.display = 'none';
    }
  }

  loadStoryData(stageNumber, context = 'start') {
    // 各ステージのストーリーデータを設定
    // context: 'start' (バトル開始前) or 'victory' (バトル勝利後)
    const storyDatabase = {
      1: {
        start: {
          title: "魔法の森への旅立ち",
          dialogues: [
            {
              character: "narrator",
              text: "古い森の奥深くで、不思議な魔法の力が目覚めようとしていた...",
              background: "story_bg"
            },
            {
              character: "player",
              text: "この森には何か特別な力があるようですね。",
              background: "story_bg",
              portrait: "character1"
            },
            {
              character: "enemy",
              text: "その通りだ。この森の秘密を知りたければ、私を倒してみろ！",
              background: "story_bg",
              portrait: "character2"
            },
            {
              character: "narrator",
              text: "戦いが始まろうとしている...",
              background: "story_bg"
            }
          ]
        },
        victory: {
          title: "森の守護者との絆",
          dialogues: [
            {
              character: "narrator",
              text: "森の精霊との戦いが終わった...",
              background: "story_bg"
            },
            {
              character: "enemy",
              text: "見事だ...君には確かに魔法の力が宿っている。",
              background: "story_bg",
              portrait: "character2"
            },
            {
              character: "player",
              text: "ありがとうございます。この力を正しく使います。",
              background: "story_bg",
              portrait: "character1"
            },
            {
              character: "narrator",
              text: "こうして、プレイヤーは森の守護者の認めるところとなった。\n新たな冒険が君を待っている...",
              background: "story_bg"
            }
          ]
        }
      }
      // 他のステージのストーリーは将来的にここに追加可能
      // 2: { 
      //   start: { title: "ステージ2開始", dialogues: [...] },
      //   victory: { title: "ステージ2勝利", dialogues: [...] }
      // },
    };

    // デフォルトのストーリーデータ
    const defaultStory = {
      start: {
        title: `ステージ ${stageNumber}`,
        dialogues: [] // 空の配列で即座にバトルへ
      },
      victory: {
        title: `ステージ ${stageNumber} クリア`,
        dialogues: [
          {
            character: "narrator",
            text: `ステージ ${stageNumber} をクリアしました！\nおめでとうございます！`,
            background: "story_bg"
          }
        ]
      }
    };

    const stageData = storyDatabase[stageNumber] || defaultStory;
    this.storyData = stageData[context] || stageData.start;
    this.dialogues = this.storyData.dialogues;
    this.currentDialogueIndex = 0;
  }

  createBackground() {
    const { width, height } = this.scale;
    
    // 背景画像
    this.bg = this.add.image(width/2, height/2, 'story_bg');
    this.bg.setDisplaySize(width, height);
    this.bg.setAlpha(0.7);
    
    // 暗いオーバーレイ
    this.overlay = this.add.rectangle(width/2, height/2, width, height, 0x000000, 0.4);
  }

  createStoryUI() {
    const { width, height } = this.scale;
    
    // タイトル表示（ストーリーデータが存在する場合のみ）
    if (this.storyData && this.storyData.title) {
      this.titleText = this.add.text(width/2, 60, this.storyData.title, {
        fontSize: '48px',
        fontFamily: 'Arial Black, sans-serif',
        fill: '#ffd700',
        stroke: '#2c3e50',
        strokeThickness: 6,
        resolution: 2, // 解像度を2倍に設定
        shadow: {
          offsetX: 3,
          offsetY: 3,
          color: '#000000',
          blur: 6,
          stroke: true,
          fill: true
        }
      }).setOrigin(0.5);
    }

    // キャラクター表示エリア
    this.characterContainer = this.add.container(0, 0);
    
    // ダイアログボックス
    this.createDialogueBox();
    
    // スキップボタン
    this.createSkipButton();
  }

  createDialogueBox() {
    const { width, height } = this.scale;
    
    // ダイアログボックス背景
    const dialogueY = height - 150;
    const dialogueHeight = 120;
    
    this.dialogueBg = this.add.graphics();
    this.dialogueBg.fillStyle(0x000000, 0.8);
    this.dialogueBg.fillRoundedRect(20, dialogueY, width - 40, dialogueHeight, 15);
    this.dialogueBg.lineStyle(3, 0xffd700, 1);
    this.dialogueBg.strokeRoundedRect(20, dialogueY, width - 40, dialogueHeight, 15);
    
    // キャラクター名表示
    this.characterNameText = this.add.text(50, dialogueY + 20, '', {
      fontSize: '24px',
      fontFamily: 'Arial Bold, sans-serif',
      fill: '#ffd700',
      stroke: '#000000',
      strokeThickness: 3,
      resolution: 2 // 解像度を2倍に設定
    });
    
    // ダイアログテキスト
    this.dialogueText = this.add.text(50, dialogueY + 50, '', {
      fontSize: '20px',
      fontFamily: 'Arial, sans-serif',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2, // 解像度を2倍に設定
      wordWrap: {
        width: width - 100,
        useAdvancedWrap: true
      }
    });
  }

  createSkipButton() {
    const { width } = this.scale;
    
    // スキップボタン
    const skipBg = this.add.graphics();
    skipBg.fillStyle(0xe74c3c, 0.8);
    skipBg.fillRoundedRect(width - 280, 20, 100, 35, 8);
    skipBg.lineStyle(2, 0xffd700, 1);
    skipBg.strokeRoundedRect(width - 280, 20, 100, 35, 8);
    
    this.skipButton = this.add.text(width - 230, 37, 'スキップ', {
      fontSize: '18px',
      fontFamily: 'Arial Bold, sans-serif',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2 // 解像度を2倍に設定
    }).setOrigin(0.5);
    
    // ボタンをインタラクティブにする
    const skipButtonArea = this.add.rectangle(width - 230, 37, 100, 35, 0x000000, 0)
      .setInteractive()
      .on('pointerdown', () => this.skipTobattaglia())
      .on('pointerover', () => {
        skipBg.clear();
        skipBg.fillStyle(0xf55c4c, 0.9);
        skipBg.fillRoundedRect(width - 280, 20, 100, 35, 8);
        skipBg.lineStyle(2, 0xffd700, 1);
        skipBg.strokeRoundedRect(width - 280, 20, 100, 35, 8);
      })
      .on('pointerout', () => {
        skipBg.clear();
        skipBg.fillStyle(0xe74c3c, 0.8);
        skipBg.fillRoundedRect(width - 280, 20, 100, 35, 8);
        skipBg.lineStyle(2, 0xffd700, 1);
        skipBg.strokeRoundedRect(width - 280, 20, 100, 35, 8);
      });
  }

  setupInputEvents() {
    // 画面クリックで次のダイアログへ
    this.input.on('pointerdown', (pointer, currentlyOver) => {
      // UI要素をクリックした場合は無視
      if (currentlyOver.length > 0) return;
      
      if (this.isTyping) {
        // タイピング中の場合は即座に全文表示
        this.completeTyping();
      } else {
        // 次のダイアログへ
        this.nextDialogue();
      }
    });
    
    // キーボードイベント
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.isTyping) {
        this.completeTyping();
      } else {
        this.nextDialogue();
      }
    });
    
    this.input.keyboard.on('keydown-ENTER', () => {
      if (this.isTyping) {
        this.completeTyping();
      } else {
        this.nextDialogue();
      }
    });
    
    this.input.keyboard.on('keydown-ESC', () => {
      this.skipTobattaglia();
    });
  }

  showDialogue() {
    console.log('=== showDialogue called ===');
    console.log('Dialogues length:', this.dialogues.length);
    console.log('Current dialogue index:', this.currentDialogueIndex);
    console.log('Stage number:', this.stageNumber);
    
    // ダイアログが空の場合の処理
    if (this.dialogues.length === 0) {
      console.log('No story dialogue');
      if (this.context === 'victory') {
        // 勝利後でダイアログが空の場合は直接ホーム画面へ
        console.log('No victory story, moving directly to home');
        this.scene.start(this.returnTo);
      } else {
        // 開始前でダイアログが空の場合は直接バトルへ
        console.log('No start story, moving directly to battle');
        const battleSceneName = this.getBattleSceneName(this.stageNumber);
        console.log('Battle scene name:', battleSceneName);
        this.scene.start(battleSceneName, { 
          stage: this.stageNumber,
          isDevelopmentMode: this.isDevelopmentMode 
        });
      }
      return;
    }
    
    if (this.currentDialogueIndex >= this.dialogues.length) {
      console.log('All dialogues finished, ending story');
      this.endStory();
      return;
    }
    
    const dialogue = this.dialogues[this.currentDialogueIndex];
    console.log('Showing dialogue:', dialogue);
    
    // キャラクター名を表示
    this.updateCharacterName(dialogue.character);
    
    // キャラクターポートレートを表示
    this.updateCharacterPortrait(dialogue.portrait);
    
    // テキストをタイプライター効果で表示
    this.startTyping(dialogue.text);
  }

  updateCharacterName(character) {
    const nameMap = {
      'narrator': 'ナレーター',
      'player': 'プレイヤー',
      'enemy': '敵',
      'ally': '仲間'
    };
    
    const displayName = nameMap[character] || character;
    this.characterNameText.setText(displayName);
  }

  updateCharacterPortrait(portrait) {
    // 既存のポートレートを削除
    this.characterContainer.removeAll(true);
    
    // メインキャラクターを画面左に常時表示
    const { width, height } = this.scale;
    const mainCharacterImage = this.add.image(150, height - 250, 'character1');
    mainCharacterImage.setDisplaySize(200, 250);
    mainCharacterImage.setAlpha(0.9);
    this.characterContainer.add(mainCharacterImage);
    
    // 会話中の相手キャラクターがいる場合は右側に表示
    if (portrait && portrait !== 'character1') {
      const portraitImage = this.add.image(width - 200, height - 300, portrait);
      portraitImage.setDisplaySize(150, 200);
      portraitImage.setAlpha(0.9);
      this.characterContainer.add(portraitImage);
    }
  }

  startTyping(text) {
    this.isTyping = true;
    this.currentText = '';
    this.targetText = text;
    this.dialogueText.setText('');
    
    // タイプライター効果
    const charactersPerTick = Math.max(1, Math.floor(this.charactersPerSecond / 60));
    
    this.typewriterTimer = this.time.addEvent({
      delay: 1000 / this.charactersPerSecond,
      callback: () => {
        if (this.currentText.length < this.targetText.length) {
          this.currentText += this.targetText[this.currentText.length];
          this.dialogueText.setText(this.currentText);
        } else {
          this.completeTyping();
        }
      },
      loop: true
    });
  }

  completeTyping() {
    if (this.typewriterTimer) {
      this.typewriterTimer.destroy();
      this.typewriterTimer = null;
    }
    
    this.isTyping = false;
    this.currentText = this.targetText;
    this.dialogueText.setText(this.currentText);
  }

  nextDialogue() {
    if (this.isTyping) {
      this.completeTyping();
      return;
    }
    
    this.currentDialogueIndex++;
    this.showDialogue();
  }

  skipTobattaglia() {
    console.log('Skipping story');
    if (this.context === 'victory') {
      // 勝利後のストーリーをスキップする場合は直接ホーム画面へ
      console.log('Skipping victory story, moving to home');
      this.scene.start(this.returnTo);
    } else {
      // 開始前のストーリーをスキップする場合はバトルへ
      console.log('Skipping start story, moving to battle');
      const battleSceneName = this.getBattleSceneName(this.stageNumber);
      this.scene.start(battleSceneName, { 
        stage: this.stageNumber,
        isDevelopmentMode: this.isDevelopmentMode 
      });
    }
  }

  endStory() {
    console.log('Story ended');
    console.log('Context:', this.context);
    console.log('Return destination:', this.returnTo);
    
    // フェードアウト効果
    this.cameras.main.fadeOut(1000, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      if (this.context === 'victory') {
        // 勝利後のストーリーの場合は指定された遷移先へ（通常はホーム画面）
        console.log('Moving to:', this.returnTo);
        this.scene.start(this.returnTo);
      } else {
        // 開始前のストーリーの場合はバトルシーンへ
        const battleSceneName = this.getBattleSceneName(this.stageNumber);
        console.log('Moving to battle:', battleSceneName);
        this.scene.start(battleSceneName, { 
          stage: this.stageNumber,
          isDevelopmentMode: this.isDevelopmentMode 
        });
      }
    });
  }

  // ステージ番号に応じた正しいBattleSceneの名前を取得
  getBattleSceneName(stageNumber) {
    // すべてのステージで Stage{番号}Battle の形式を使用
    return `Stage${stageNumber}Battle`;
  }
}
