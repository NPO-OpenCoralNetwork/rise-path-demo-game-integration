import Phaser from 'phaser';
import { Player } from "./player";
import { Enemy } from "./enemy";
import { UI } from "./ui";
import { SpellBook } from "./SpellBook";
import { filterBlocksByLevel, getAvailableBlocksByLevel, getNewlyUnlockedBlocks } from "./levelBlockRestrictions";

export class BattleScene extends Phaser.Scene {
  constructor(config) {
    // 継承クラスからconfigが渡された場合はそれを使用し、なければデフォルトのkeyを設定
    const sceneConfig = config || { key: 'BattleScene' };
    super(sceneConfig);
    
    // 設定の初期値
    this.settings = {
      background: 'forest',
      enemy: 'goblin',
      enemyTextureKey: 'enemy',              // 敵スプライトのキー
      enemyTexturePath: null,                // 敵スプライトのパス（未指定時は名前から推測）
      enemyDisplaySize: { width: 350, height: 200 }, // 敵スプライトの表示サイズ
      backgroundTextureKey: 'battleBg',      // 背景スプライトのキー
      backgroundTexturePath: null,           // 背景スプライトのパス（未指定時は名前から推測）
      scratchMode: true, // デフォルトでtrueに変更
      stageNumber: 1,
      isDevelopmentMode: false // レベル制限を無効にする開発モードフラグ
    };
    
    // ゲーム変数の初期化
    this.player = null;
    this.enemy = null;
    this.ui = null;
    
    // 経験値トラッキング用変数
    this.battleStats = {
      executionCount: 0,
      blockCount: 0,
      battleStartTime: null,
      battleEndTime: null
    };
    
    // 魔法の書の初期化
    this.spellBook = new SpellBook();
    
    // グローバルアクセス用
    window.spellBook = this.spellBook;
    
    // デバッグ用関数をグローバルに追加
    window.debugSpellBook = () => {
      if (window.spellBook) {
        return window.spellBook.debugStageInfo();
      } else {
        console.warn('SpellBook not initialized');
        return null;
      }
    };

    // 魔法の書を開くボタンを作成するフラグ
    this.spellBookButton = null;

    // 敵の麻痺状態管理（グローバル）
    this.isEnemyParalyzed = false;
    this.paralyzeRemainingTurns = 0;
    this.paralyzeStatusText = null;
  }

  init(data) {
    // データがあれば設定を更新
    this.settings = { ...this.settings, ...data };
    // 確実にscratchModeを有効にする
    this.settings.scratchMode = true;
    
    // 現在のステージをクラス変数とグローバル変数に設定
    this.stage = this.settings.stageNumber || 1;
    window.currentStage = this.stage;
    
    console.log('Battle initialized with settings:', this.settings);
    console.log('Current stage set to:', this.stage);
  }

  preload() {
    // アセット読み込みエラーのハンドリング
    this.load.on('loaderror', (file) => {
      console.warn(`Failed to load asset: ${file.src}`);
    });

    // バトル用アセットをロード（エラー時のフォールバック付き）
    const backgroundKey = this.settings.backgroundTextureKey || 'battleBg';
    const inferredBackgroundPath = this.settings.backgroundTexturePath || this.getBackgroundTexturePathByName(this.settings.background);
    const backgroundPath = inferredBackgroundPath || '/p_school/assets/bg1.png';
    this.settings.backgroundTexturePath = backgroundPath;
    console.log('[BattleScene preload] background key:', backgroundKey, 'path:', backgroundPath, 'name:', this.settings.background);
    this.load.image(backgroundKey, backgroundPath);
    this.load.image('player', '/p_school/assets/main-chara01_transparent.png');
    // 敵テクスチャはシーンごとに差し替え可能
    const enemyKey = this.settings.enemyTextureKey || 'enemy';
    const inferredPath = this.settings.enemyTexturePath || this.getEnemyTexturePathByName(this.settings.enemy);
    const enemyPath = inferredPath || '/p_school/assets/srime.png';
    // 推測したパスを後段でも使えるように保持
    this.settings.enemyTexturePath = enemyPath;
    console.log('[BattleScene preload] enemy key:', enemyKey, 'path:', enemyPath, 'name:', this.settings.enemy);
    this.load.image(enemyKey, enemyPath);
    
    // UI要素（オプショナル）
    try {
      this.load.image('buttonBg', '/p_school/assets/button.png');
    } catch (e) {
      console.warn('button.png not found, using fallback');
    }
    
    try {
      this.load.image('hpBarFrame', '/p_school/assets/hp-bar-frame.png');
    } catch (e) {
      console.warn('hp-bar-frame.png not found, using fallback');
    }
    
    try {
      this.load.image('panelBg', '/p_school/assets/panel-bg.png');
    } catch (e) {
      console.warn('panel-bg.png not found, using fallback');
    }
    
    // エフェクト用アセット（オプショナル）
    try {
      this.load.image('particle', '/p_school/assets/particle.png');
    } catch (e) {
      console.warn('particle.png not found, using fallback');
    }
    
    // 魔法の書の画像をロード（オプショナル）
    try {
      this.load.image('spellbook', '/p_school/assets/spellbook.png');
    } catch (e) {
      console.warn('spellbook.png not found, using fallback');
    }
    
    // BGMの読み込み
    this.load.audio('battleTheme', '/p_school/assets/audio/battle_bgm_01.mp3');
    
    // モダンなWebフォントの読み込み (Google Fontsなど外部フォントがある場合)
    // 注意: Google Fontsを使う場合はindex.htmlにフォントのリンクを追加する必要があります
    // このコードは、フォントがすでにロードされている前提です
  }

  create() {
    // バトル統計の初期化
    this.battleStats = {
      executionCount: 0,
      blockCount: 0,
      battleStartTime: Date.now(),
      battleEndTime: null
    };
    
    // カスタム変数・リストの初期化
    this.customVariables = {};
    this.customLists = {};
    
    // システム変数の初期化
    this.customVariables['敵の技名'] = '';
    
    // ゲーム画面のレイアウトを設定
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.display = 'flex';
      gameContainer.style.flexDirection = 'row';
    }

    // ブロックエディタを表示（scratchModeが有効な場合のみ）
    if (this.settings.scratchMode) {
      console.log("scratchMode is enabled, setting up block editor (React managed)");
      
      // React側にバトルモード開始を通知
      if (typeof window.setBattleMode === 'function') {
        window.setBattleMode(true);
      }

      // DOM操作はReactコンポーネントに移譲するため無効化
      /*
      const blocklyDiv = document.getElementById('blocklyDiv');
      // ... (rest of commented out code)
      */
    } else {
      console.log("scratchMode is disabled");
    }
    
    // 背景の設定（アセットの読み込み確認付き）
    const backgroundKey = this.settings.backgroundTextureKey || 'battleBg';
    if (this.textures.exists(backgroundKey)) {
      console.log('[BattleScene create] background texture found:', backgroundKey, 'path:', this.settings.backgroundTexturePath);
      this.background = this.add.image(this.scale.width / 2, this.scale.height / 2, backgroundKey);
      this.background.setDisplaySize(this.scale.width, this.scale.height);
    } else {
      console.warn('[BattleScene create] background texture missing, using fallback. key:', backgroundKey, 'expected path:', this.settings.backgroundTexturePath);
      // フォールバック: 単色の背景を作成
      this.background = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x1a1a2e);
      console.warn('battleBg asset not found, using fallback background');
    }

    // リサイズイベントの登録
    this.scale.on('resize', this.resize, this);

    // プレイヤーと敵のスプライト（フォールバック付き）
    if (this.textures.exists('player')) {
      this.playerSprite = this.add.sprite(this.scale.width * 0.25, this.scale.height * 0.67, 'player');
      
      // 画像比率を維持したままサイズを拡大 (高さ基準で350px程度に)
      const playerTexture = this.textures.get('player').getSourceImage();
      const playerAspectRatio = playerTexture.width / playerTexture.height;
      const targetHeight = 350;
      this.playerSprite.setDisplaySize(targetHeight * playerAspectRatio, targetHeight);
    } else {
      // フォールバック: 円形のプレイヤー
      const playerGraphics = this.add.graphics();
      playerGraphics.fillStyle(0x00ff00);
      playerGraphics.fillCircle(this.scale.width * 0.25, this.scale.height * 0.67, 100); // フォールバックも大きく
      this.playerSprite = playerGraphics;
      console.warn('player asset not found, using fallback graphics');
    }
    
    const enemyKey = this.settings.enemyTextureKey || 'enemy';
    if (this.textures.exists(enemyKey)) {
      this.enemySprite = this.add.sprite(this.scale.width * 0.75, this.scale.height * 0.6, enemyKey);
      
      // 画像比率を維持したままサイズを調整 (200pxの2/3である約133pxに縮小)
      const enemyTexture = this.textures.get(enemyKey).getSourceImage();
      const enemyAspectRatio = enemyTexture.width / enemyTexture.height;
      const targetWidth = 133;
      this.enemySprite.setDisplaySize(targetWidth, targetWidth / enemyAspectRatio);
      
      console.log('[BattleScene create] enemy texture found:', enemyKey, 'path:', this.settings.enemyTexturePath);
    } else {
      console.warn('[BattleScene create] enemy texture missing, using fallback graphics. key:', enemyKey, 'expected path:', this.settings.enemyTexturePath);
      // フォールバック: 円形の敵 (サイズを2/3に調整)
      const enemyGraphics = this.add.graphics();
      enemyGraphics.fillStyle(0xff0000);
      enemyGraphics.fillCircle(this.scale.width * 0.75, this.scale.height * 0.6, 33);
      this.enemySprite = enemyGraphics;
      console.warn('enemy asset not found, using fallback graphics');
    }
    
    // キャラクターに影をつける（スプライトの場合のみ）
    if (this.playerSprite.setAlpha) {
      this.playerSprite.setAlpha(0.9);
    }
    if (this.enemySprite.setAlpha) {
      this.enemySprite.setAlpha(0.9);
    }

    // 魔法の書ボタンを作成（左上に配置）
    const spellBookContainer = this.add.container(90, 50);
    
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x2a1810, 0.8);
    buttonBg.lineStyle(2, 0x8b6914);
    buttonBg.fillRoundedRect(-40, -20, 80, 40, 10);
    buttonBg.strokeRoundedRect(-40, -20, 80, 40, 10);
    
    const buttonText = this.add.text(0, 0, '📖', {
      fontSize: '24px',
      fill: '#ffd700'
    }).setOrigin(0.5);
    
    const buttonLabel = this.add.text(0, 22, '魔法の書', {
      fontSize: '12px',
      fill: '#ffd700',
      fontFamily: 'Georgia, serif'
    }).setOrigin(0.5);
    
    spellBookContainer.add([buttonBg, buttonText, buttonLabel]);
    spellBookContainer.setInteractive(new Phaser.Geom.Rectangle(-40, -20, 80, 40), Phaser.Geom.Rectangle.Contains);
    
    spellBookContainer.on('pointerover', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x3a2820, 0.8);
      buttonBg.lineStyle(2, 0x8b6914);
      buttonBg.fillRoundedRect(-40, -20, 80, 40, 10);
      buttonBg.strokeRoundedRect(-40, -20, 80, 40, 10);
      this.tweens.add({
        targets: buttonText,
        y: -2,
        duration: 100,
        ease: 'Power1'
      });
    });
    
    spellBookContainer.on('pointerout', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x2a1810, 0.8);
      buttonBg.lineStyle(2, 0x8b6914);
      buttonBg.fillRoundedRect(-40, -20, 80, 40, 10);
      buttonBg.strokeRoundedRect(-40, -20, 80, 40, 10);
      this.tweens.add({
        targets: buttonText,
        y: 0,
        duration: 100,
        ease: 'Power1'
      });
    });
    
    spellBookContainer.on('pointerdown', () => {
      this.spellBook.toggle();
    });
    
    this.spellBookButton = spellBookContainer;
    
    // コマンドログパネル（下部半透明、グラデーション効果付き）
    const logPanel = this.add.graphics();
    
    // ログエリアの位置とサイズを計算（テキストエリアに合わせる）
    const logX = this.scale.width * 0.15; // テキストより少し左から開始
    const logY = this.scale.height * 0.82; // テキストより少し上から開始
    const logWidth = this.scale.width * 0.75; // テキストのwordWrapより少し広く
    const logHeight = this.scale.height * 0.16; // 画面下部の16%を使用
    
    // グラデーション背景
    logPanel.fillStyle(0x000000, 0.7);
    logPanel.fillRect(logX, logY, logWidth, logHeight);
    
    // パネル上部の装飾ライン
    logPanel.lineStyle(2, 0x4a6fff, 1);
    logPanel.lineBetween(logX, logY, logX + logWidth, logY);
    
    // UIとゲーム状態を初期化
    this.ui = new UI();
    
    // このテキストオブジェクトを UI のログエリアとして割り当てる
    this.ui.logArea = this.add.text(this.scale.width * 0.16, this.scale.height * 0.84, '', { 
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '16px', 
      fill: '#ffffff',
      wordWrap: { width: this.scale.width * 0.73 },
      lineSpacing: 6,
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true }
    });
    
    // プレイヤーと敵を初期化（同期的にレベルを取得）
    const playerLevel = this.getPlayerLevelSync();
    console.log('Initializing player with level:', playerLevel);
    
    this.player = new Player(this, this.ui, playerLevel);
    this.player.sprite = this.playerSprite;
    
    // プレイヤーHP確認
    console.log('Player HP after init:', this.player.hp, '/', this.player.maxHp);
    
    this.enemy = new Enemy(this, this.ui);
    this.enemy.sprite = this.enemySprite;
    
    // HPバー表示用のスタイリッシュなコンテナを作成
    this.createHPBars();
    
    // HPバーの初期値を更新（NaNチェック付き）
    const playerHP = isNaN(this.player.hp) ? 50 : this.player.hp;
    const playerMaxHP = isNaN(this.player.maxHp) ? 50 : this.player.maxHp;
    const enemyHP = isNaN(this.enemy.hp) ? 50 : this.enemy.hp;
    
    // NaNの場合はデフォルト値を設定
    if (isNaN(this.player.hp)) {
      this.player.hp = 50;
      this.player.maxHp = 50;
    }
    
    this.updateHP(playerHP, enemyHP);
    
    // レベル表示を追加
    this.levelText = this.add.text(10, 70, `Lv.${playerLevel}`, {
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '16px',
      fill: '#ffff00',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true }
    });
    
    // バトル開始のログメッセージ
    this.addLog(`バトルが始まりました！${this.settings.enemy}と対決します！`);
    
    // バトル開始演出
    this.cameras.main.flash(500, 255, 255, 255, true);

    // BGMの再生
    try {
      // 既存のBGMを停止（もしあれば）
      this.sound.stopAll();
      
      this.battleMusic = this.sound.add('battleTheme', { 
        loop: true, 
        volume: 0.5 
      });
      this.battleMusic.play();
      console.log('Battle music started');
    } catch (e) {
      console.warn('Failed to play battle music:', e);
    }
    
    // 非同期でレベル情報を更新（Supabaseから取得後）
    this.updatePlayerLevelAsync();
  }
  
  resize(gameSize, baseSize, displaySize, resolution) {
    const width = gameSize.width;
    const height = gameSize.height;

    this.cameras.main.setViewport(0, 0, width, height);

    if (this.background) {
      this.background.setPosition(width / 2, height / 2);
      this.background.setDisplaySize(width, height);
    }

    // プレイヤーと敵の位置調整
    if (this.playerSprite) {
      this.playerSprite.setPosition(width * 0.25, height * 0.67);
    }
    if (this.enemySprite) {
      this.enemySprite.setPosition(width * 0.75, height * 0.6);
    }
    
    // UI要素の位置調整（必要に応じて追加）
    // 例: ログパネルや魔法の書ボタンの再配置など
    
    // 魔法の書ボタンの再配置
    if (this.spellBookButton) {
        this.spellBookButton.setPosition(90, 50); // 固定位置だが、必要なら相対位置に変更
    }
    
    // ログエリアの再配置（UIクラス内で管理されているため、再生成や更新が必要かも）
    if (this.ui && this.ui.logArea) {
       const logX = width * 0.16;
       const logY = height * 0.84;
       this.ui.logArea.setPosition(logX, logY);
       this.ui.logArea.setStyle({ wordWrap: { width: width * 0.73 } });
       
       // 背景パネルはグラフィックスなので再描画が必要だが、
       // ここでは簡易的にログテキストのみ調整
    }

    // DOM要素の再表示と位置調整（リサイズ時やシーン遷移後の復帰用）
    const runButton = document.getElementById('runButton');
    if (runButton && this.settings.scratchMode) {
        runButton.style.display = 'block';
    }
    
    // HPバーなどのUIレイヤーも確認
    const uiLayer = document.getElementById('ui-layer');
    if (uiLayer) {
        uiLayer.style.display = 'flex';
    }
  }

  // HPバーを作成する新しいメソッド (DOM Overlay版)
  createHPBars() {
    // 既存のCanvasベースのHPバーがあれば削除
    if (this.playerHPBar) this.playerHPBar.destroy();
    if (this.enemyHPBar) this.enemyHPBar.destroy();
    if (this.playerHPText) this.playerHPText.destroy();
    if (this.enemyHPText) this.enemyHPText.destroy();

    // DOM要素の参照を取得
    this.domPlayerHPBar = document.getElementById('player-hp-bar');
    this.domPlayerHPDelay = document.getElementById('player-hp-delay');
    this.domPlayerHPValue = document.getElementById('player-hp-value');
    this.domPlayerHPCard = document.getElementById('player-hp-card');

    this.domEnemyHPBar = document.getElementById('enemy-hp-bar');
    this.domEnemyHPDelay = document.getElementById('enemy-hp-delay');
    this.domEnemyHPValue = document.getElementById('enemy-hp-value');
    this.domEnemyName = document.getElementById('enemy-name-display');
    this.domEnemyHPCard = document.getElementById('enemy-hp-card');

    // UIレイヤーを表示
    const uiLayer = document.getElementById('ui-layer');
    if (uiLayer) {
      uiLayer.style.display = 'flex';
    }

    // 敵の名前を更新
    if (this.domEnemyName && this.enemy) {
      this.domEnemyName.textContent = this.enemy.name || 'Enemy';
    }

    // 初期化
    this.updateHP(this.player.hp, this.enemy.hp);
  }

  // プレイヤーのHPバーを描画（旧メソッド：DOM版では使用しない）
  drawPlayerHP(hp) {
    // DOM版に移行したため処理なし
  }
  
  // 敵のHPバーを描画（旧メソッド：DOM版では使用しない）
  drawEnemyHP(hp) {
    // DOM版に移行したため処理なし
  }
  
  // HPバー更新 (DOM版)
  updateHP(playerHP, enemyHP) {
    const playerMaxHP = this.player?.maxHp || 100;
    const enemyMaxHP = this.enemy?.maxHp || 50;
    
    // パーセンテージ計算
    const playerPct = Math.max(0, Math.min(100, (playerHP / playerMaxHP) * 100));
    const enemyPct = Math.max(0, Math.min(100, (enemyHP / enemyMaxHP) * 100));

    // DOM更新: プレイヤー
    if (this.domPlayerHPBar) {
      this.domPlayerHPBar.style.width = `${playerPct}%`;
      // 遅延バーも更新（CSS transitionで遅れて追従する）
      if (this.domPlayerHPDelay) {
        this.domPlayerHPDelay.style.width = `${playerPct}%`;
      }
      // 数値更新
      if (this.domPlayerHPValue) {
        this.domPlayerHPValue.innerHTML = `${Math.ceil(playerHP)}<small>/${playerMaxHP}</small>`;
      }
      // 瀕死エフェクト
      if (playerPct < 30) {
        this.domPlayerHPCard?.classList.add('critical');
      } else {
        this.domPlayerHPCard?.classList.remove('critical');
      }
    }

    // DOM更新: 敵
    if (this.domEnemyHPBar) {
      this.domEnemyHPBar.style.width = `${enemyPct}%`;
      if (this.domEnemyHPDelay) {
        this.domEnemyHPDelay.style.width = `${enemyPct}%`;
      }
      if (this.domEnemyHPValue) {
        this.domEnemyHPValue.innerHTML = `${Math.ceil(enemyHP)}<small>/${enemyMaxHP}</small>`;
      }
      // 敵の名前更新（念のため毎回確認）
      if (this.domEnemyName && this.enemy?.name) {
        // 名前が変わった場合のみ更新
        if (this.domEnemyName.textContent !== this.enemy.name) {
          this.domEnemyName.textContent = this.enemy.name;
        }
      }
    }
    
    // HTML要素も更新（後方互換性のため残す）
    const playerHPElement = document.getElementById('playerHP');
    const enemyHPElement = document.getElementById('enemyHP');
    
    if (playerHPElement) playerHPElement.textContent = `Player: ${playerHP}`;
    if (enemyHPElement) playerHPElement.textContent = `Enemy: ${enemyHP}`;
  }

  // プレイヤーのレベルを取得
  getPlayerLevel() {
    // グローバル変数から取得（Supabaseからロードされている場合）
    if (typeof window !== 'undefined' && window.playerLevel) {
      const level = parseInt(window.playerLevel, 10);
      if (!isNaN(level) && level >= 1 && level <= 100) {
        console.log('Level from window.playerLevel:', level);
        return level;
      }
    }
    
    // localStorageから取得
    try {
      const savedLevel = localStorage.getItem('playerLevel');
      if (savedLevel) {
        const level = parseInt(savedLevel, 10);
        if (!isNaN(level) && level >= 1 && level <= 100) {
          console.log('Level from localStorage:', level);
          return level;
        }
      }
    } catch (e) {
      console.warn('localStorage access failed:', e);
    }
    
    // デフォルトはレベル1
    console.log('Using default level: 1');
    return 1;
  }

  
  // 魔法詠唱のポップアップを表示（Stage1のベース実装）
  showSpellPopup() {
    // すでにポップアップがある場合は削除
    if (this.spellPopup) {
      this.hideSpellPopup();
      return;
    }
    
    // カメラをフラッシュさせる演出
    this.cameras.main.flash(200, 255, 240, 180, true);
    
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    
    // コンテナ作成
    const container = this.add.container(centerX, centerY);
    container.setScale(0);
    
    // ポップアップの背景
    const popupBg = this.add.graphics();
    popupBg.fillStyle(0x111122, 0.85);
    popupBg.fillRoundedRect(-220, -170, 440, 340, 15);
    
    // 装飾的な枠線
    popupBg.lineStyle(3, 0x4a6fff, 1);
    popupBg.strokeRoundedRect(-220, -170, 440, 340, 15);
    
    // 内側の光る装飾
    popupBg.lineStyle(1, 0x7a9fff, 0.5);
    popupBg.strokeRoundedRect(-210, -160, 420, 320, 12);
    
    // タイトル背景
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x4a6fff, 0.6);
    titleBg.fillRoundedRect(-180, -155, 360, 50, 10);
    
    // タイトル (基本コマンドのみ表示)
    const title = this.add.text(0, -130, '基本コマンド', {
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '28px',
      fontStyle: 'bold',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 3, fill: true }
    }).setOrigin(0.5);
    
    // ステージ1のコンテンツを作成
    // 攻撃アイコン
    const attackIcon = this.add.graphics();
    attackIcon.fillStyle(0xff3300, 0.8);
    attackIcon.fillCircle(-150, -30, 15);
    
    // 攻撃コマンドの説明
    const attackText = this.add.text(-120, -30, '「攻撃」: 敵に基本攻撃を行います', {
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '18px',
      fill: '#ff9966',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 1, fill: true }
    }).setOrigin(0, 0.5);
    
    // 解説
    const stageInfo = this.add.text(0, 50, '敵を倒すにはまず攻撃を覚えましょう。\n適切なタイミングでの攻撃が勝利への鍵です！', {
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '16px',
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 380 }
    }).setOrigin(0.5);
    
    // ボタン背景
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x880000, 1);
    buttonBg.fillRoundedRect(-60, 130, 120, 40, 10);
    buttonBg.lineStyle(2, 0xff0000, 1);
    buttonBg.strokeRoundedRect(-60, 130, 120, 40, 10);
    
    // 閉じるボタン
    const closeButton = this.add.text(0, 150, '閉じる', {
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '20px',
      fontStyle: 'bold',
      fill: '#ffffff'
    }).setOrigin(0.5).setInteractive();
    
    // 基本要素をコンテナに追加
    container.add([popupBg, titleBg, title, buttonBg, closeButton, 
                  attackIcon, attackText, stageInfo]);
    
    // ポップアップを表示するアニメーション
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut'
    });
    
    // ボタンのイベント
    closeButton.on('pointerdown', () => {
      this.hideSpellPopup();
    });
    
    // ホバーエフェクト
    closeButton.on('pointerover', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0xaa0000, 1);
      buttonBg.fillRoundedRect(-60, 130, 120, 40, 10);
      buttonBg.lineStyle(2, 0xff3333, 1);
      buttonBg.strokeRoundedRect(-60, 130, 120, 40, 10);
      closeButton.setScale(1.05);
    });
    
    closeButton.on('pointerout', () => {
      buttonBg.clear();
      buttonBg.fillStyle(0x880000, 1);
      buttonBg.fillRoundedRect(-60, 130, 120, 40, 10);
      buttonBg.lineStyle(2, 0xff0000, 1);
      buttonBg.strokeRoundedRect(-60, 130, 120, 40, 10);
      closeButton.setScale(1);
    });
    
    // 参照を保存
    this.spellPopup = {
      container: container,
      bg: popupBg,
      title: title,
      button: closeButton
    };
  }
  
  // ポップアップを閉じる
  hideSpellPopup() {
    if (this.spellPopup) {
      const container = this.spellPopup.container;
      
      // 閉じるアニメーション
      this.tweens.add({
        targets: container,
        scale: 0,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => {
          container.destroy();
          this.spellPopup = null;
        }
      });
    }
  }

  // バトルログ追加
  addLog(message) {
    // UIのログに追加 - UIクラスのlogAreaを使用
    if (this.ui && this.ui.logArea) {
      this.ui.log(message);
    }
  }

  // アニメーション再生
  async playAnimation(animationType) {
    console.log(`Playing animation: ${animationType}`);
    
    // アニメーションタイプに応じた処理
    switch(animationType) {
      case 'playerAttack':
        // プレイヤーの攻撃アニメーション - より現代的なアニメーション
        const originalX = this.playerSprite.x;
        
        // 1. プレイヤーが素早く動く（攻撃動作）
        this.tweens.add({
          targets: this.playerSprite,
          x: originalX + 80,
          angle: 5, // 少し傾く
          duration: 150,
          ease: 'Power2',
          yoyo: true,
          repeat: 0
        });

        // 2. 切り裂くエフェクト（プレイヤーが動き出した直後に発生）
        this.time.delayedCall(100, () => {
            const slash = this.add.graphics();
            slash.lineStyle(4, 0xffffff, 1);
            
            // 斬撃線を描画 (サイズを拡大)
            for (let i = 0; i < 3; i++) {
              const offset = i * 15; // オフセットも少し広げる
              slash.beginPath();
              slash.moveTo(this.enemySprite.x - 80 + offset, this.enemySprite.y - 60 + offset);
              slash.lineTo(this.enemySprite.x + 60 + offset, this.enemySprite.y + 40 + offset);
              slash.strokePath();
            }
            
            // 斬撃のフェードアウト
            this.tweens.add({
              targets: slash,
              alpha: 0,
              duration: 200,
              onComplete: () => slash.destroy()
            });
        });

        // 3. 敵のダメージ演出（斬撃が表示された少し後に発生）
        this.time.delayedCall(250, () => {
            this.enemySprite.setTint(0xff0000);
            
            // 敵が揺れる
            this.tweens.add({
              targets: this.enemySprite,
              x: this.enemySprite.x + 10,
              duration: 50,
              yoyo: true,
              repeat: 1,
              onComplete: () => this.enemySprite.clearTint()
            });
            
            // 軽いカメラシェイクを追加して打撃感を出す
            this.cameras.main.shake(100, 0.005);
        });
        
        // アニメーションの完了を待機
        await new Promise(resolve => setTimeout(resolve, 500));
        break;
        
      case 'magic_fire':
        // 火の魔法エフェクト - 爆発的な炎の演出
        
        // カメラシェイク効果
        this.cameras.main.shake(150, 0.005);
        
        // 魔法の詠唱エフェクト（プレイヤー周り）
        const castFx = this.add.graphics();
        castFx.fillStyle(0xff3300, 0.4);
        castFx.fillCircle(this.playerSprite.x, this.playerSprite.y, 40);
        
        // 詠唱エフェクトのアニメーション
        this.tweens.add({
          targets: castFx,
          alpha: 0,
          scale: 1.5,
          duration: 300,
          onComplete: () => castFx.destroy()
        });

        // 敵に向かって飛んでいく火の弾
        const fireball = this.add.graphics();
        fireball.fillStyle(0xff3300, 0.8);
        fireball.fillCircle(0, 0, 15);
        
        // 内側の明るい部分
        fireball.fillStyle(0xffff00, 0.9);
        fireball.fillCircle(0, 0, 8);
        
        // 火の粒子を追加
        const particles = [];
        for (let i = 0; i < 5; i++) {
          const particle = this.add.graphics();
          particle.fillStyle(0xff5500, 0.6);
          particle.fillCircle(0, 0, 5);
          particles.push(particle);
        }

        // 火の弾の軌道アニメーション
        const path = new Phaser.Curves.Path(this.playerSprite.x, this.playerSprite.y);
        path.cubicBezierTo(
          this.enemySprite.x, this.enemySprite.y, 
          this.playerSprite.x, this.playerSprite.y - 150,
          (this.playerSprite.x + this.enemySprite.x) / 2, this.playerSprite.y - 100
        );
        
        // 火の弾を移動
        this.tweens.add({
          targets: fireball,
          x: this.enemySprite.x,
          y: this.enemySprite.y,
          duration: 600,
          onUpdate: (tween, target) => {
            const position = path.getPoint(tween.progress);
            fireball.x = position.x;
            fireball.y = position.y;
            
            // 粒子もランダムに動かす
            particles.forEach((p, i) => {
              p.x = position.x + Math.sin(tween.progress * 10 + i) * 10;
              p.y = position.y + Math.cos(tween.progress * 10 + i) * 10;
            });
          },
          onComplete: () => {
            // 爆発エフェクト
            fireball.destroy();
            particles.forEach(p => p.destroy());
            
            // 大きな爆発を描画
            const explosion = this.add.graphics();
            explosion.fillStyle(0xff3300, 0.8);
            explosion.fillCircle(this.enemySprite.x, this.enemySprite.y, 60);
            
            // 内側の白熱部分
            explosion.fillStyle(0xffcc00, 0.9);
            explosion.fillCircle(this.enemySprite.x, this.enemySprite.y, 40);
            
            explosion.fillStyle(0xffff00, 1);
            explosion.fillCircle(this.enemySprite.x, this.enemySprite.y, 20);
            
            // 爆発によるカメラシェイク
            this.cameras.main.shake(300, 0.01);
            
            // 爆発のフェードアウト
            this.tweens.add({
              targets: explosion,
              alpha: 0,
              scale: 1.5,
              duration: 500,
              onComplete: () => explosion.destroy()
            });
            
            // 敵のダメージ演出
            this.enemySprite.setTint(0xff3300);
            setTimeout(() => this.enemySprite.clearTint(), 400);
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 1100));
        break;
        
      case 'magic_ice':
        // 氷の魔法エフェクト - より結晶的なアイスエフェクト
        
        // 魔法の詠唱エフェクト（プレイヤー周り）
        const iceCastFx = this.add.graphics();
        iceCastFx.fillStyle(0x00ffff, 0.4);
        iceCastFx.fillCircle(this.playerSprite.x, this.playerSprite.y, 40);
        
        this.tweens.add({
          targets: iceCastFx,
          alpha: 0,
          scale: 1.5,
          duration: 300,
          onComplete: () => iceCastFx.destroy()
        });

        // 氷の結晶を複数作成
        const iceShards = [];
        for (let i = 0; i < 6; i++) {
          const shard = this.add.graphics();
          
          // 六角形の結晶を描く
          shard.fillStyle(0x00ffff, 0.8);
          shard.fillCircle(0, 0, 10);
          
          // 内側の明るい部分
          shard.fillStyle(0xaaffff, 0.9);
          shard.fillCircle(0, 0, 5);
          
          // 初期位置設定
          shard.x = this.playerSprite.x;
          shard.y = this.playerSprite.y;
          
          // 飛んでいく先の位置をランダムに少しずらす
          const targetX = this.enemySprite.x + (Math.random() * 60 - 30);
          const targetY = this.enemySprite.y + (Math.random() * 60 - 30);
          
          // アニメーション
          this.tweens.add({
            targets: shard,
            x: targetX,
            y: targetY,
            scale: 1.5,
            duration: 400 + i * 50,
            ease: 'Cubic.easeOut',
            onComplete: function() {
              // 結晶が消える
              this.tweens.add({
                targets: shard,
                alpha: 0,
                scale: 0.5,
                duration: 200,
                onComplete: () => shard.destroy()
              });
            }.bind(this)
          });
          
          iceShards.push(shard);
        }
        
        // 氷結エフェクト
        setTimeout(() => {
          const freezeEffect = this.add.graphics();
          
          // 氷の結晶のパターン
          freezeEffect.fillStyle(0x00ffff, 0.6);
          freezeEffect.fillRect(this.enemySprite.x - 40, this.enemySprite.y - 40, 80, 80);
          
          freezeEffect.lineStyle(2, 0xaaffff, 0.8);
          
          // 結晶パターンを描く
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const length = 50;
            freezeEffect.lineBetween(
              this.enemySprite.x, 
              this.enemySprite.y, 
              this.enemySprite.x + Math.cos(angle) * length,
              this.enemySprite.y + Math.sin(angle) * length
            );
          }
          
          // 敵を青く染める
          this.enemySprite.setTint(0x00ffff);
          
          // 氷結エフェクトのアニメーション
          this.tweens.add({
            targets: freezeEffect,
            alpha: { from: 0.8, to: 0 },
            duration: 800,
            onComplete: () => {
              freezeEffect.destroy();
              this.enemySprite.clearTint();
            }
          });
        }, 400);
        
        await new Promise(resolve => setTimeout(resolve, 1200));
        break;
        
      case 'magic_thunder':
        // 雷の魔法エフェクト - よりダイナミックな稲妻
        
        // 魔法の詠唱エフェクト（プレイヤー周り）
        const thunderCastFx = this.add.graphics();
        thunderCastFx.fillStyle(0xffff00, 0.4);
        thunderCastFx.fillCircle(this.playerSprite.x, this.playerSprite.y, 40);
        
        this.tweens.add({
          targets: thunderCastFx,
          alpha: 0,
          scale: 1.5,
          duration: 300,
          onComplete: () => thunderCastFx.destroy()
        });
        
        // 天候を暗く
        const darkOverlay = this.add.graphics();
        darkOverlay.fillStyle(0x000033, 0.5);
        darkOverlay.fillRect(0, 0, this.scale.width, this.scale.height);
        
        // 雲が集まる演出
        const cloud = this.add.graphics();
        cloud.fillStyle(0x444466, 0.7);
        cloud.fillRect(this.enemySprite.x - this.scale.width * 0.125, 0, this.scale.width * 0.25, this.scale.height * 0.167);
        
        // 雲のアニメーション
        this.tweens.add({
          targets: cloud,
          y: 60,
          alpha: 0.9,
          duration: 400
        });
        
        // 複数の稲妻を描画
        setTimeout(() => {
          // 閃光
          this.cameras.main.flash(100, 255, 255, 180);
          
          // 大きな稲妻
          const mainLightning = this.add.graphics();
          mainLightning.lineStyle(8, 0xffffff, 1);
          mainLightning.beginPath();
          
          // ジグザグの稲妻を描画 - より複雑なパターン
          let x = this.enemySprite.x;
          let y = 100;
          const segments = 6;
          mainLightning.moveTo(x, y);
          
          for (let i = 1; i <= segments; i++) {
            const progress = i / segments;
            const xOffset = (Math.random() * 60 - 30) * (1 - progress); // 下に行くほど収束
            x = this.enemySprite.x + xOffset;
            y = 100 + (this.enemySprite.y - 100) * progress;
            mainLightning.lineTo(x, y);
          }
          
          mainLightning.strokePath();
          
          // 中心の輝く部分
          const coreLightning = this.add.graphics();
          coreLightning.lineStyle(4, 0xffff99, 0.8);
          coreLightning.lineBetween(
            this.enemySprite.x, 100,
            this.enemySprite.x, this.enemySprite.y
          );
          
          // 分岐する小さな稲妻
          const branches = [];
          for (let i = 0; i < 4; i++) {
            const branch = this.add.graphics();
            branch.lineStyle(3, 0xffffff, 0.7);
            
            const startY = 100 + Math.random() * (this.enemySprite.y - 150);
            const length = 30 + Math.random() * 60;
            const angle = (Math.random() * Math.PI / 2) + Math.PI / 4;
            
            branch.beginPath();
            branch.moveTo(this.enemySprite.x, startY);
            branch.lineTo(
              this.enemySprite.x + Math.cos(angle) * length,
              startY + Math.sin(angle) * length
            );
            branch.strokePath();
            
            branches.push(branch);
          }
          
          // 衝撃波エフェクト
          const shockwave = this.add.graphics();
          shockwave.lineStyle(2, 0xffff99, 0.8);
          shockwave.strokeCircle(this.enemySprite.x, this.enemySprite.y, 30);
          
          // 衝撃波を拡大
          this.tweens.add({
            targets: shockwave,
            scale: 2,
            alpha: 0,
            duration: 400,
            onComplete: () => shockwave.destroy()
          });
          
          // カメラシェイク
          this.cameras.main.shake(300, 0.02);
          
          // 敵のダメージ演出
          this.enemySprite.setTint(0xffff00);
          
          // 稲妻のフェードアウト
          setTimeout(() => {
            this.tweens.add({
              targets: [mainLightning, coreLightning, ...branches],
              alpha: 0,
              duration: 200,
              onComplete: () => {
                mainLightning.destroy();
                coreLightning.destroy();
                branches.forEach(b => b.destroy());
              }
            });
            
            this.enemySprite.clearTint();
          }, 200);
          
          // 暗さのフェードアウト
          this.tweens.add({
            targets: [darkOverlay, cloud],
            alpha: 0,
            duration: 500,
            onComplete: () => {
              darkOverlay.destroy();
              cloud.destroy();
            }
          });
        }, 500);
        
        await new Promise(resolve => setTimeout(resolve, 1300));
        break;
        
      case 'enemyAttack':
        // 敵の攻撃アニメーション
        const enemyOriginalX = this.enemySprite.x;
        
        // 敵が前進する
        this.tweens.add({
          targets: this.enemySprite,
          x: enemyOriginalX - 80,
          angle: -5,
          duration: 150,
          ease: 'Power2',
          yoyo: true,
          repeat: 0,
          onComplete: () => {
            // 攻撃エフェクト（衝撃波）
            const impact = this.add.graphics();
            impact.lineStyle(4, 0xff0000, 1);
            impact.strokeCircle(this.playerSprite.x, this.playerSprite.y, 30);
            
            // 斬撃エフェクト
            const enemySlash = this.add.graphics();
            enemySlash.lineStyle(4, 0xff3333, 1);
            for (let i = 0; i < 3; i++) {
              const offset = i * 8;
              enemySlash.beginPath();
              enemySlash.moveTo(this.playerSprite.x + 30 - offset, this.playerSprite.y - 25 + offset);
              enemySlash.lineTo(this.playerSprite.x - 25 - offset, this.playerSprite.y + 20 + offset);
              enemySlash.strokePath();
            }
            
            // 衝撃波の拡大
            this.tweens.add({
              targets: impact,
              scale: 2,
              alpha: 0,
              duration: 300,
              onComplete: () => impact.destroy()
            });
            
            // 斬撃のフェードアウト
            this.tweens.add({
              targets: enemySlash,
              alpha: 0,
              duration: 200,
              onComplete: () => enemySlash.destroy()
            });
            
            // プレイヤーのダメージ演出
            this.playerSprite.setTint(0xff0000);
            this.tweens.add({
              targets: this.playerSprite,
              x: this.playerSprite.x - 10,
              duration: 50,
              yoyo: true,
              repeat: 2,
              onComplete: () => this.playerSprite.clearTint()
            });
            
            // カメラシェイク
            this.cameras.main.shake(200, 0.01);
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 600));
        break;
        
      case 'enemyAttack_poison':
        // 毒攻撃エフェクト（ステージ6用）
        const poisonEnemyOriginalX = this.enemySprite.x;
        
        this.tweens.add({
          targets: this.enemySprite,
          x: poisonEnemyOriginalX - 60,
          duration: 200,
          ease: 'Power2',
          yoyo: true,
          onComplete: () => {
            // 毒の飛沫エフェクト
            for (let i = 0; i < 8; i++) {
              const droplet = this.add.graphics();
              droplet.fillStyle(0x9900ff, 0.8);
              droplet.fillCircle(0, 0, 6);
              droplet.x = this.enemySprite.x;
              droplet.y = this.enemySprite.y;
              
              const targetX = this.playerSprite.x + (Math.random() * 60 - 30);
              const targetY = this.playerSprite.y + (Math.random() * 60 - 30);
              
              this.tweens.add({
                targets: droplet,
                x: targetX,
                y: targetY,
                alpha: 0,
                duration: 400 + i * 50,
                ease: 'Power2',
                onComplete: () => droplet.destroy()
              });
            }
            
            // プレイヤーに毒エフェクト
            setTimeout(() => {
              this.playerSprite.setTint(0x9900ff);
              this.tweens.add({
                targets: this.playerSprite,
                x: this.playerSprite.x - 8,
                duration: 60,
                yoyo: true,
                repeat: 2,
                onComplete: () => this.playerSprite.clearTint()
              });
              this.cameras.main.shake(150, 0.008);
            }, 300);
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 700));
        break;
        
      case 'enemyAttack_fire':
        // 炎攻撃エフェクト（ステージ4用）
        const fireEnemyOriginalX = this.enemySprite.x;
        
        this.tweens.add({
          targets: this.enemySprite,
          x: fireEnemyOriginalX - 50,
          angle: -3,
          duration: 150,
          ease: 'Power2',
          yoyo: true,
          onComplete: () => {
            // 炎の球
            const fireball = this.add.graphics();
            fireball.fillStyle(0xff6600, 0.9);
            fireball.fillCircle(0, 0, 20);
            fireball.fillStyle(0xffcc00, 0.8);
            fireball.fillCircle(0, 0, 12);
            fireball.x = this.enemySprite.x;
            fireball.y = this.enemySprite.y;
            
            this.tweens.add({
              targets: fireball,
              x: this.playerSprite.x,
              y: this.playerSprite.y,
              duration: 300,
              ease: 'Power2',
              onComplete: () => {
                fireball.destroy();
                
                // 爆発エフェクト
                const explosion = this.add.graphics();
                explosion.fillStyle(0xff3300, 0.8);
                explosion.fillCircle(this.playerSprite.x, this.playerSprite.y, 50);
                explosion.fillStyle(0xffcc00, 0.9);
                explosion.fillCircle(this.playerSprite.x, this.playerSprite.y, 30);
                
                this.tweens.add({
                  targets: explosion,
                  alpha: 0,
                  scale: 1.5,
                  duration: 400,
                  onComplete: () => explosion.destroy()
                });
                
                this.playerSprite.setTint(0xff6600);
                this.cameras.main.shake(300, 0.015);
                setTimeout(() => this.playerSprite.clearTint(), 400);
              }
            });
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 800));
        break;
        
      case 'enemyAttack_shadow':
        // 闇の攻撃エフェクト（ステージ9用）
        this.tweens.add({
          targets: this.enemySprite,
          alpha: 0.3,
          duration: 200,
          yoyo: true,
          repeat: 1
        });
        
        const darkWaveEffect = this.add.graphics();
        darkWaveEffect.fillStyle(0x4B0082, 0.8);
        darkWaveEffect.fillCircle(this.enemySprite.x, this.enemySprite.y, 20);
        
        this.tweens.add({
          targets: darkWaveEffect,
          x: this.playerSprite.x - this.enemySprite.x,
          y: this.playerSprite.y - this.enemySprite.y,
          scale: 3,
          alpha: 0,
          duration: 600,
          ease: 'Power2',
          onComplete: () => {
            darkWaveEffect.destroy();
            
            const darkAura = this.add.graphics();
            darkAura.fillStyle(0x000000, 0.7);
            darkAura.fillCircle(this.playerSprite.x, this.playerSprite.y, 60);
            
            this.tweens.add({
              targets: darkAura,
              alpha: 0,
              scale: 0.5,
              duration: 500,
              onComplete: () => darkAura.destroy()
            });
            
            this.playerSprite.setTint(0x4B0082);
            this.cameras.main.shake(400, 0.02);
            setTimeout(() => this.playerSprite.clearTint(), 500);
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        break;
        
      case 'enemyAttack_boss':
        // ボス攻撃エフェクト（ステージ10用）
        const bossOriginalX = this.enemySprite.x;
        
        const bossAura = this.add.graphics();
        bossAura.fillStyle(0x8B0000, 0.5);
        bossAura.fillCircle(this.enemySprite.x, this.enemySprite.y, 80);
        
        this.tweens.add({
          targets: bossAura,
          scale: 1.5,
          alpha: 0,
          duration: 500,
          onComplete: () => bossAura.destroy()
        });
        
        this.tweens.add({
          targets: this.enemySprite,
          x: bossOriginalX - 100,
          duration: 200,
          ease: 'Power3',
          yoyo: true,
          onComplete: () => {
            for (let i = 0; i < 5; i++) {
              const bossSlash = this.add.graphics();
              bossSlash.lineStyle(5, 0xff0000, 1);
              const angle = (i / 5) * Math.PI - Math.PI / 2;
              bossSlash.beginPath();
              bossSlash.moveTo(this.playerSprite.x, this.playerSprite.y);
              bossSlash.lineTo(
                this.playerSprite.x + Math.cos(angle) * 60,
                this.playerSprite.y + Math.sin(angle) * 60
              );
              bossSlash.strokePath();
              
              this.tweens.add({
                targets: bossSlash,
                alpha: 0,
                duration: 300,
                delay: i * 50,
                onComplete: () => bossSlash.destroy()
              });
            }
            
            this.playerSprite.setTint(0xff0000);
            this.cameras.main.shake(400, 0.025);
            this.cameras.main.flash(100, 255, 0, 0);
            setTimeout(() => this.playerSprite.clearTint(), 500);
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 900));
        break;
        
      default:
        console.log(`未知のアニメーションタイプ: ${animationType}`);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    return true;
  }
  
  // 敵へのダメージ処理
  dealDamageToEnemy(damage, attackType = 'normal') {
    if (this.enemy) {
      this.enemy.hp = Math.max(0, this.enemy.hp - damage);
      this.updateHP(this.player.hp, this.enemy.hp);
      
      // 敵のHPが0になったら戦闘終了
      if (this.enemy.hp <= 0) {
        this.addLog("敵を倒した！プレイヤーの勝利！");
        this.gameOver(true); // true = プレイヤー勝利
        return false;
      }
      return true;
    }
    return false;
  }
  
  // バトル中のプレイヤーのHPを回復するメソッド
  async healPlayer(amount) {
    console.log("BattleScene healPlayer called with amount:", amount);
    // 現在のHPを取得し、回復量を加算（最大HPを超えないように）
    const currentHP = this.player.getHP();
    const maxHP = 100; // プレイヤーの最大HP
    
    // 回復量に基づいた新しいHP値を計算（最大HPを超えないように）
    const newHP = Math.min(currentHP + amount, maxHP);
    this.player.setHP(newHP);
    
    // HPバーを更新
    this.updateHP(newHP, this.enemy.getHP());
    
    // 回復エフェクトを表示
    this.showHealEffect();
    
    // ログに回復メッセージを追加
    this.addLog(`プレイヤーのHPが ${amount} 回復した！`);
    
    return true;
  }

  // 回復エフェクトを表示する
  showHealEffect() {
    // プレイヤースプライトの位置を取得
    const x = this.playerSprite.x;
    const y = this.playerSprite.y;
    
    // パーティクルの画像がない場合は、シェイプを代用
    if (!this.textures.exists('healParticle')) {
      this.make.graphics({ x: 0, y: 0, add: false })
        .fillStyle(0x00ff00, 1)  // 緑色
        .fillCircle(8, 8, 8)     // 半径8のサークル
        .generateTexture('healParticle', 16, 16);
    }
    
    // Phaser 3.60 新API使用 - 回復エフェクト用のパーティクルエミッター作成
    const particles = this.add.particles(x, y, {
      key: 'healParticle',
      speed: { min: 50, max: 100 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.8, end: 0 },
      tint: [0x00ff00, 0x99ff66, 0x66ff99], // 緑色のバリエーション
      lifespan: 1000,
      blendMode: 'ADD',
      frequency: 50,
      rotate: { min: 0, max: 360 },
      angle: { min: 0, max: 360 },
      radial: true,
      gravityY: -50,
      emitting: true,
      duration: 2000
    });
    
    // 光のオーラエフェクト
    const glowCircle = this.add.graphics();
    glowCircle.fillStyle(0x00ff00, 0.3);
    glowCircle.fillCircle(x, y, 50);
    
    // プレイヤーを一時的に緑色に着色
    this.playerSprite.setTint(0x99ff99);
    
    // キラキラ効果アニメーション
    this.tweens.add({
      targets: glowCircle,
      alpha: { from: 0.3, to: 0 },
      scale: { from: 1, to: 2 },
      duration: 800,
      ease: 'Sine.easeOut',
      onComplete: () => {
        glowCircle.destroy();
      }
    });
    
    // 回復テキストの表示
    const healText = this.add.text(x, y - 50, 'Heal!', {
      fontFamily: 'Verdana, "メイリオ", sans-serif',
      fontSize: '28px',
      fontStyle: 'bold',
      fill: '#00ff00',
      stroke: '#004400',
      strokeThickness: 4,
      shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 2, fill: true }
    }).setOrigin(0.5);
    
    // テキストアニメーション
    this.tweens.add({
      targets: healText,
      y: y - 100,
      alpha: { from: 1, to: 0 },
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        healText.destroy();
      }
    });
    
    // 一定時間後にエフェクトを停止して色を元に戻す
    this.time.delayedCall(1000, () => {
      particles.stop();
      this.playerSprite.clearTint();
      
      // 少し遅れてパーティクルを破棄（残りのパーティクルが消えるのを待つ）
      this.time.delayedCall(500, () => {
        particles.destroy();
      });
    });
  }

  // ゲームオーバー処理
  gameOver(isVictory) {
    // 勝利か敗北かに応じて結果を表示
    if (isVictory) {
      // 勝利時の処理
      this.handleVictory();
    } else {
      // 敗北時の処理
      this.handleDefeat();
    }
  }

  // 勝利時の処理
  async handleVictory() {
    // バトル終了を通知
    if (typeof window.setBattleMode === 'function') {
      window.setBattleMode(false);
    }

    // バトル終了時刻を記録
    this.battleStats.battleEndTime = Date.now();
    
    const resultText = "勝利！";
    
    // 大きな結果テキストを画面中央に表示
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    
    const resultDisplay = this.add.text(centerX, centerY, resultText, {
      fontSize: '64px',
      fill: '#00ff00',
      stroke: '#000',
      strokeThickness: 6,
      fontStyle: 'bold'
    }).setOrigin(0.5);
    
    // テキストに拡大縮小アニメーションを適用
    this.tweens.add({
      targets: resultDisplay,
      scale: { from: 0.5, to: 1 },
      duration: 500,
      ease: 'Bounce.Out'
    });

    // 勝利メッセージを表示
    const victoryMessage = this.add.text(centerX, centerY + 60, 'ステージクリア！', {
      fontSize: '32px',
      fill: '#ffffff',
      stroke: '#000',
      strokeThickness: 3
    }).setOrigin(0.5);

    // 経験値計算と表示
    await this.calculateAndDisplayExperience(centerX, centerY);

    // 入力を無効化（DOM操作は無効化）
    /*
    const runButton = document.getElementById("runButton");
    if (runButton) {
      runButton.disabled = true;
    }
    */

    // 5秒後にストーリーシーンへ遷移（経験値表示時間を考慮）
    this.time.delayedCall(5000, () => {
      // 現在のステージ番号を取得
      const currentStage = this.settings.stageNumber || 1;
      
      // ストーリーシーンへ遷移（勝利後のストーリー）
      this.scene.start('StoryScene', { 
        stage: currentStage,
        context: 'victory', // 勝利後のストーリーであることを示す
        returnTo: 'HomeScene' // ストーリー後の遷移先
      });
    });
  }

  // 経験値計算と表示
  async calculateAndDisplayExperience(centerX, centerY) {
    try {
      console.log('=== 経験値計算開始 ===');
      
      // データベース状態確認
      console.log('データベース状態を確認中...');
      const { checkDatabaseSetup, initializeProfileColumns } = await import('../supabase/databaseCheck.js');
      const dbStatus = await checkDatabaseSetup();
      
      if (!dbStatus.success) {
        console.error('データベース状態確認エラー:', dbStatus);
        this.addLog(`データベースエラー: ${dbStatus.error}`);
        
        if (dbStatus.needsProfile) {
          this.addLog('プロフィールが作成されていません');
          return;
        }
        
        if (dbStatus.needsUpdate && dbStatus.missingColumns) {
          this.addLog('データベースの更新が必要です');
          console.log('不足しているカラム:', dbStatus.missingColumns);
          return;
        }
        
        return;
      }
      
      console.log('データベース状態確認完了');
      
      // 経験値システムをインポート
      console.log('経験値システムをインポート中...');
      const { calculateExperience, updatePlayerExperience } = await import('../supabase/experienceSystem.js');
      console.log('経験値システムのインポート完了');
      
      // 現在のユーザーIDを取得
      console.log('ユーザー情報を取得中...');
      const { supabase } = await import('../lib/supabase.js');
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.error('認証エラー:', authError);
        this.addLog(`認証エラー: ${authError.message}`);
        return;
      }
      
      if (!user) {
        console.warn('ユーザーが認証されていないため、経験値を保存できません');
        this.addLog('ゲストモードのため経験値は保存されません');
        return;
      }
      
      console.log('認証済みユーザー:', user.id);

      // 基準経験値（ステージ1）
      const baseExperience = 100;
      
      // 最終的なブロック数を取得
      const finalBlockCount = this.getCurrentBlockCount();
      if (finalBlockCount > 0) {
        this.battleStats.blockCount = finalBlockCount;
      }
      
      console.log('バトル統計:', this.battleStats);
      
      // 経験値計算（目標: 3ブロック、1回実行）
      console.log('経験値を計算中...');
      const expResult = calculateExperience(
        baseExperience, 
        this.battleStats.blockCount, 
        this.battleStats.executionCount,
        3, // 目標ブロック数
        1  // 目標実行回数
      );
      console.log('経験値計算結果:', expResult);

      // 経験値をデータベースに保存
      console.log('データベースに経験値を保存中...');
      const updateResult = await updatePlayerExperience(
        user.id,
        expResult.experience,
        this.settings.stageNumber || 1,
        {
          blockCount: this.battleStats.blockCount,
          executionCount: this.battleStats.executionCount,
          efficiencyMultiplier: expResult.efficiencyMultiplier
        }
      );
      
      console.log('データベース更新結果:', updateResult);

      if (updateResult.success) {
        console.log('経験値保存成功');
        // 経験値表示
        const expText = this.add.text(centerX, centerY + 120, 
          `経験値 +${expResult.experience}`, {
          fontSize: '28px',
          fill: '#ffff00',
          stroke: '#000',
          strokeThickness: 2
        }).setOrigin(0.5);

        // 効率ボーナス表示
        const efficiencyText = this.add.text(centerX, centerY + 150, 
          `効率ボーナス: x${expResult.efficiencyMultiplier.toFixed(2)}`, {
          fontSize: '20px',
          fill: '#00ffff',
          stroke: '#000',
          strokeThickness: 2
        }).setOrigin(0.5);

        // 統計表示
        const statsText = this.add.text(centerX, centerY + 180, 
          `ブロック数: ${this.battleStats.blockCount} | 実行回数: ${this.battleStats.executionCount}`, {
          fontSize: '16px',
          fill: '#ffffff',
          stroke: '#000',
          strokeThickness: 1
        }).setOrigin(0.5);

        // レベルアップチェック
        if (updateResult.level.levelUp) {
          const levelUpText = this.add.text(centerX, centerY + 210, 
            `🎉 レベルアップ！ Lv.${updateResult.level.current}`, {
            fontSize: '24px',
            fill: '#ff69b4',
            stroke: '#000',
            strokeThickness: 2
          }).setOrigin(0.5);

          // レベルアップアニメーション
          this.tweens.add({
            targets: levelUpText,
            scale: { from: 0.8, to: 1.2, to: 1 },
            duration: 1000,
            ease: 'Bounce.Out'
          });
        }

      } else {
        console.error('経験値更新エラーの詳細:', {
          error: updateResult.error,
          details: updateResult.details
        });
        this.addLog(`経験値保存エラー: ${updateResult.error}`);
        
        // デバッグ用の詳細情報表示
        if (updateResult.details) {
          console.error('エラーの詳細:', updateResult.details);
          this.addLog(`詳細: ${JSON.stringify(updateResult.details, null, 2)}`);
        }
      }

    } catch (error) {
      console.error('=== 経験値処理で予期しないエラー ===');
      console.error('エラーオブジェクト:', error);
      console.error('エラーメッセージ:', error.message);
      console.error('エラースタック:', error.stack);
      this.addLog(`経験値処理エラー: ${error.message}`);
    }
  }

  // 敗北時の処理
  handleDefeat() {
    // バトル終了を通知
    if (typeof window.setBattleMode === 'function') {
      window.setBattleMode(false);
    }

    const resultText = "敗北...";
    
    // 大きな結果テキストを画面中央に表示
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    
    const resultDisplay = this.add.text(centerX, centerY, resultText, {
      fontSize: '64px',
      fill: '#ff0000',
      stroke: '#000',
      strokeThickness: 6,
      fontStyle: 'bold'
    }).setOrigin(0.5);
    
    // テキストに拡大縮小アニメーションを適用
    this.tweens.add({
      targets: resultDisplay,
      scale: { from: 0.5, to: 1 },
      duration: 500,
      ease: 'Bounce.Out'
    });
    
    // リスタートボタンを表示
    const restartButton = this.add.text(centerX, centerY + 80, 'もう一度戦う', {
      fontSize: '32px',
      fill: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // ホームに戻るボタンを表示
    const homeButton = this.add.text(centerX, centerY + 140, 'ホーム画面に戻る', {
      fontSize: '24px',
      fill: '#ffffff',
      backgroundColor: '#666666',
      padding: { x: 15, y: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    
    // リスタートボタンのイベントリスナー
    restartButton.on('pointerdown', () => {
      this.scene.restart();
    });

    // ホームボタンのイベントリスナー
    homeButton.on('pointerdown', () => {
      this.scene.start('HomeScene');
    });
    
    // ホバー効果
    restartButton.on('pointerover', () => {
      restartButton.setStyle({ fill: '#ffff00' });
    });
    
    
    restartButton.on('pointerout', () => {
      restartButton.setStyle({ fill: '#ffffff' });
    });

    homeButton.on('pointerover', () => {
      homeButton.setStyle({ fill: '#ffff00' });
    });
    
    homeButton.on('pointerout', () => {
      homeButton.setStyle({ fill: '#ffffff' });
    });
    
    // 入力を無効化して戦闘終了状態にする
    /*
    const runButton = document.getElementById("runButton");
    if (runButton) {
      runButton.disabled = true;
      
      // 2秒後に入力を再度有効化
      setTimeout(() => {
        runButton.disabled = false;
      }, 2000);
    }
    */
  }

  // ブロックエディタを表示
  showBlockEditor() {
    console.log("Showing block editor and UI elements (Managed by React)");
    
    // Reactコンポーネント側で制御するため、DOM直接操作は無効化
    /*
    const blocklyDiv = document.getElementById('blocklyDiv');
    if (blocklyDiv) {
      blocklyDiv.style.display = 'block';
      blocklyDiv.style.visibility = 'visible';
    }
    
    const runButton = document.getElementById('runButton');
    if (runButton) {
      runButton.style.display = 'block';
      runButton.disabled = false;
    }
    
    const uiLayer = document.getElementById('ui-layer');
    if (uiLayer) {
      uiLayer.style.display = 'flex';
    }
    */
  }
  
  shutdown() {
    // バトル終了を通知（安全策）
    if (typeof window.setBattleMode === 'function') {
      window.setBattleMode(false);
    }

    // シーン破棄時の処理
    if (this.spellBook) {
      this.spellBook.hide();  // 魔法の書を非表示に
    }

    // BGMの停止
    if (this.battleMusic) {
      this.battleMusic.stop();
    }
  }
  
  // 共通のステージセットアップメソッド
  async setupStageCommon(stageConfig) {
    // 背景色設定
    if (stageConfig.backgroundColor) {
      this.cameras.main.setBackgroundColor(stageConfig.backgroundColor);
    }
    
    // 敵のティント設定
    if (stageConfig.enemyTint && this.enemySprite && typeof this.enemySprite.setTint === 'function') {
      this.enemySprite.setTint(stageConfig.enemyTint);
    }
    
    // 敵のHP設定
    if (stageConfig.enemyHp && this.enemy) {
      this.enemy.maxHp = stageConfig.enemyHp;
      this.enemy.hp = stageConfig.enemyHp;
      if (this.enemyHPText) {
        this.enemyHPText.setText(`HP: ${stageConfig.enemyHp}/${stageConfig.enemyHp}`);
      }
    }
    
    // ステージ開始メッセージ
    if (stageConfig.startMessage) {
      this.addLog(stageConfig.startMessage);
    }
    
    // 利用可能ブロック設定（レベル制限を適用）
    if (stageConfig.availableBlocks) {
      try {
        // プレイヤーレベルを取得
        const playerLevel = await this.getPlayerLevel();
        
        // 開発モードの確認
        const isDevelopmentMode = this.settings.isDevelopmentMode || false;
        
        // レベル制限を適用してブロックをフィルタリング
        const filteredBlocks = filterBlocksByLevel(
          stageConfig.availableBlocks, 
          playerLevel, 
          isDevelopmentMode
        );
        
        this.availableBlocks = filteredBlocks;
        
        // デバッグ情報をログに出力
        console.log(`=== ブロック制限システム ===`);
        console.log(`プレイヤーレベル: ${playerLevel}`);
        console.log(`開発モード: ${isDevelopmentMode}`);
        console.log(`ステージのブロック数: ${stageConfig.availableBlocks.length}`);
        console.log(`利用可能ブロック数: ${filteredBlocks.length}`);
        console.log(`ステージのブロック:`, stageConfig.availableBlocks);
        console.log(`利用可能ブロック:`, filteredBlocks);
        
        if (!isDevelopmentMode && filteredBlocks.length < stageConfig.availableBlocks.length) {
          const restrictedBlocks = stageConfig.availableBlocks.filter(
            block => !filteredBlocks.includes(block)
          );
          console.log(`制限されたブロック:`, restrictedBlocks);
          this.addLog(`現在のレベル(${playerLevel})では一部のブロックが制限されています`);
        } else if (!isDevelopmentMode) {
          console.log('すべてのブロックが利用可能です');
        } else {
          console.log('開発モードのため制限なし');
        }
        
        // ツールボックスを更新
        console.log('=== ツールボックス更新開始 ===');
        this.updateBlocklyToolbox(filteredBlocks);
        console.log('=== ツールボックス更新完了 ===');
        
        // SpellBookのステージ更新
        if (this.spellBook && this.stage) {
          console.log(`=== 魔法の書をステージ ${this.stage} に更新 ===`);
          this.spellBook.updateForStage(this.stage);
        }
        
        // ステージ別ツールボックス更新も実行
        if (window.updateToolboxForStage && this.settings.stageNumber) {
          // ワークスペースの準備ができるまで確実に待機
          const waitForWorkspace = () => {
            return new Promise((resolve) => {
              const checkWorkspace = () => {
                // 両方の参照をチェック
                const workspace = window.blocklyWorkspace || window.workspace;
                if (workspace) {
                  console.log('✅ Blocklyワークスペースが見つかりました');
                  resolve(workspace);
                } else {
                  console.log('⏳ Blocklyワークスペースを待機中...');
                  setTimeout(checkWorkspace, 100);
                }
              };
              checkWorkspace();
            });
          };
          
          // 非同期でワークスペース準備を待機
          waitForWorkspace().then((workspace) => {
            // ワークスペース参照を統一
            if (!window.workspace && workspace) {
              window.workspace = workspace;
            }
            
            // ツールボックス更新を実行
            window.updateToolboxForStage(this.settings.stageNumber);
            
            // デバッグ情報を出力
            console.log(`✅ ステージ ${this.settings.stageNumber} のツールボックス設定を適用しました`);
            console.log(`📊 現在のワークスペース状態:`, {
              workspace: !!window.workspace,
              blocklyWorkspace: !!window.blocklyWorkspace,
              stageNumber: this.settings.stageNumber,
              toolboxFunction: typeof window.updateToolboxForStage
            });
          }).catch((error) => {
            console.error('❌ ツールボックス更新でエラー:', error);
          });
          
        } else {
          console.warn('⚠️ ツールボックス更新機能またはステージ番号が利用できません', {
            updateFunction: !!window.updateToolboxForStage,
            stageNumber: this.settings.stageNumber
          });
        }
        
      } catch (error) {
        console.warn('プレイヤーレベルの取得に失敗:', error);
        // エラー時はレベル制限なしでブロックを設定
        this.availableBlocks = stageConfig.availableBlocks;
        // ツールボックスも更新
        console.log('=== エラー時ツールボックス更新 ===');
        this.updateBlocklyToolbox(stageConfig.availableBlocks);
      }
    }
    
    // 遅延メッセージ
    if (stageConfig.delayedMessage) {
      this.time.delayedCall(stageConfig.delayedMessage.delay || 2000, () => {
        this.addLog(stageConfig.delayedMessage.text);
      });
    }
  }

  // プレイヤーのレベルを同期的に取得（キャッシュ・ローカルストレージから）
  getPlayerLevelSync() {
    // グローバル変数から取得（Supabaseからロードされている場合）
    if (typeof window !== 'undefined' && window.playerLevel) {
      const level = parseInt(window.playerLevel, 10);
      if (!isNaN(level) && level >= 1 && level <= 100) {
        console.log('Level from window.playerLevel:', level);
        return level;
      }
    }
    
    // localStorageから取得
    try {
      const savedLevel = localStorage.getItem('playerLevel');
      if (savedLevel) {
        const level = parseInt(savedLevel, 10);
        if (!isNaN(level) && level >= 1 && level <= 100) {
          console.log('Level from localStorage:', level);
          return level;
        }
      }
    } catch (e) {
      console.warn('localStorage access failed:', e);
    }
    
    // デフォルトはレベル1
    console.log('Using default level: 1');
    return 1;
  }

  // 非同期でプレイヤーレベルを更新
  async updatePlayerLevelAsync() {
    try {
      const level = await this.getPlayerLevel();
      
      // レベル表示を更新
      if (this.levelText) {
        this.levelText.setText(`Lv.${level}`);
      }
      
      // グローバル変数とlocalStorageを更新
      window.playerLevel = level;
      try {
        localStorage.setItem('playerLevel', level.toString());
      } catch (e) {
        console.warn('localStorage save failed:', e);
      }
      
      console.log('Player level updated asynchronously:', level);
    } catch (error) {
      console.warn('Failed to update player level asynchronously:', error);
    }
  }

  // プレイヤーレベルを取得するメソッド（非同期）
  async getPlayerLevel() {
    try {
      // Supabaseからプレイヤーレベルを取得
      const { supabase } = await import('../lib/supabase.js');
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        console.warn('認証されていないため、デフォルトレベル1を使用');
        return 1;
      }
      
      // プロフィールからレベルを取得
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('level')
        .eq('id', user.id)
        .single();
      
      if (profileError || !profile) {
        console.warn('プロフィール取得エラー、デフォルトレベル1を使用:', profileError);
        return 1;
      }
      
      return profile.level || 1;
      
    } catch (error) {
      console.warn('プレイヤーレベル取得エラー:', error);
      return 1; // デフォルト値
    }
  }

  // Blocklyツールボックスの動的更新（一時的に無効化）
  updateBlocklyToolbox(availableBlocks) {
    if (!window.blocklyWorkspace) {
      console.warn('Blocklyワークスペースが利用できません');
      return;
    }

    // 動的ツールボックス更新は一時的に無効化
    // 代わりに、実行時にブロック制限をチェックする方式を使用
    console.log('利用可能ブロック:', availableBlocks);
    console.log('ツールボックス動的更新は無効化されています（実行時制限を使用）');
    
    // 利用可能ブロックをグローバルに保存（実行時チェック用）
    window.currentAvailableBlocks = availableBlocks;
  }

  // プレイヤーのコード実行時に呼ばれる統計更新関数
  updateBattleStats(blockCount) {
    this.battleStats.executionCount++;
    this.battleStats.blockCount = blockCount;
    console.log('バトル統計更新:', this.battleStats);
  }

  // ブロックの数を取得する関数（外部から呼び出し可能）
  getCurrentBlockCount() {
    // この関数は外部のBlocklyから呼び出される予定
    if (typeof Blockly !== 'undefined' && Blockly.getMainWorkspace) {
      const workspace = Blockly.getMainWorkspace();
      if (workspace) {
        const blocks = workspace.getAllBlocks();
        return blocks.length;
      }
    }
    return 0;
  }

  // 敵に麻痺効果を適用（グローバルメソッド）
  applyParalyzeEffect() {
    console.log('Applying paralyze effect to enemy (global)');
    console.log('Before paralysis application:', {
      isEnemyParalyzed: this.isEnemyParalyzed,
      paralyzeRemainingTurns: this.paralyzeRemainingTurns
    });
    
    // インスタンス変数とグローバル変数の両方に設定
    this.isEnemyParalyzed = true;
    this.paralyzeRemainingTurns = 3;
    
    // グローバル変数にも保存（バックアップとして）    
    window.globalParalysisState = {
      isEnemyParalyzed: true,
      paralyzeRemainingTurns: 3,
      appliedAt: Date.now()
    };
    
    console.log('After paralysis application:', {
      isEnemyParalyzed: this.isEnemyParalyzed,
      paralyzeRemainingTurns: this.paralyzeRemainingTurns,
      global: window.globalParalysisState
    });
    
    // 麻痺状態のテキスト表示
    if (this.paralyzeStatusText) {
      this.paralyzeStatusText.destroy();
    }
    
    this.paralyzeStatusText = this.add.text(this.scale.width * 0.75, this.scale.height * 0.3, 
      `🔒 麻痺状態: あと${this.paralyzeRemainingTurns}ターン`, {
      fontSize: '18px',
      fontFamily: 'Arial',
      fill: '#9B59B6',
      backgroundColor: '#FFFFFF',
      padding: { x: 10, y: 5 }
    });
    
    this.addLog('🔮 麻痺魔法成功！敵が3ターン行動不能になりました！');
    console.log('Enemy paralyzed for', this.paralyzeRemainingTurns, 'turns');
    
    // 敵スプライトに麻痺エフェクト
    if (this.enemySprite) {
      this.tweens.add({
        targets: this.enemySprite,
        alpha: { from: 1, to: 0.3 },
        duration: 300,
        yoyo: true,
        repeat: 2
      });
    }

    // 少し後に状態を再確認
    setTimeout(() => {
      console.log('Paralysis state after 100ms:', {
        isEnemyParalyzed: this.isEnemyParalyzed,
        paralyzeRemainingTurns: this.paralyzeRemainingTurns
      });
    }, 100);
  }

  // 麻痺状態を1ターン減らす（グローバルメソッド）
  decreaseParalyzeEffect() {
    if (this.isEnemyParalyzed && this.paralyzeRemainingTurns > 0) {
      this.paralyzeRemainingTurns--;
      
      // グローバル状態も更新
      if (window.globalParalysisState) {
        window.globalParalysisState.paralyzeRemainingTurns = this.paralyzeRemainingTurns;
      }
      
      if (this.paralyzeRemainingTurns <= 0) {
        this.isEnemyParalyzed = false;
        
        // グローバル状態をクリア
        if (window.globalParalysisState) {
          window.globalParalysisState.isEnemyParalyzed = false;
        }
        
        if (this.paralyzeStatusText) {
          this.paralyzeStatusText.destroy();
          this.paralyzeStatusText = null;
        }
        this.addLog('🔓 敵の麻痺状態が解除されました');
      } else {
        if (this.paralyzeStatusText) {
          this.paralyzeStatusText.setText(`🔒 麻痺状態: あと${this.paralyzeRemainingTurns}ターン`);
        }
      }
    }
  }

  // 敵のターン処理（グローバル）
  async enemyTurn() {
    console.log('BattleScene.enemyTurn() called (global)');
    console.log('Scene instance info:', {
      sceneKey: this.scene?.key,
      constructor: this.constructor.name,
      instanceId: this.scene?.scene?.key
    });
    console.log('Paralysis state:', {
      isEnemyParalyzed: this.isEnemyParalyzed,
      paralyzeRemainingTurns: this.paralyzeRemainingTurns,
      globalState: window.globalParalysisState
    });
    
    // グローバル状態から復元（インスタンス状態が失われた場合）
    if (window.globalParalysisState && window.globalParalysisState.isEnemyParalyzed && 
        (!this.isEnemyParalyzed || this.paralyzeRemainingTurns === 0)) {
      console.log('Restoring paralysis state from global backup');
      this.isEnemyParalyzed = window.globalParalysisState.isEnemyParalyzed;
      this.paralyzeRemainingTurns = window.globalParalysisState.paralyzeRemainingTurns;
    }
    
    // 麻痺状態チェック
    if (this.isEnemyParalyzed && this.paralyzeRemainingTurns > 0) {
      this.addLog('⚡ 敵は麻痺状態で行動できません');
      this.decreaseParalyzeEffect();
      console.log('Enemy paralyzed, skipping turn');
      return; // 麻痺中は敵の行動を完全にスキップ
    }
    
    console.log('Enemy not paralyzed, executing normal turn');
    
    // ステージ11以降でenemyActionメソッドが存在する場合はそれを呼び出す
    if (typeof this.enemyAction === 'function') {
      console.log('Calling this.enemyAction() (stage 11+)');
      this.enemyAction();
    } else if (this.enemy && this.enemy.takeTurn) {
      // enemyActionが存在しない場合（ステージ1-10）はenemy.takeTurn()を呼び出す
      console.log('Calling enemy.takeTurn()');
      await this.enemy.takeTurn();
    } else {
      console.log('No enemy.takeTurn method available');
    }
  }

  // 閃光魔法効果を適用（グローバルメソッド）
  async applyFlashEffect() {
    console.log('Applying flash effect (global)');
    
    const damage = 25; // 回避不可の高威力ダメージ
    
    this.addLog('✨ 閃光魔法発動！回避不可の大ダメージ攻撃！');
    
    // 閃光エフェクト
    await this.playFlashAnimation();
    
    // ダメージ処理
    if (this.enemy) {
      this.enemy.hp -= damage;
      this.updateHP(this.player.hp, this.enemy.hp);
      
      this.addLog(`⚡ 敵に${damage}ダメージ！（回避不可）`);
      
      // 敵のHPが0になったかチェック
      if (this.enemy.hp <= 0) {
        this.addLog("敵を倒した！プレイヤーの勝利！");
        this.gameOver(true);
      }
    }
  }

  // 閃光魔法のアニメーション
  async playFlashAnimation() {
    // 画面全体を白くフラッシュ
    const flash = this.add.graphics();
    flash.fillStyle(0xffffff, 0.9);
    flash.fillRect(0, 0, this.scale.width, this.scale.height);
    
    // 眩しい光のエフェクト
    const lightRays = [];
    for (let i = 0; i < 8; i++) {
      const ray = this.add.graphics();
      ray.lineStyle(4, 0xffffff, 0.8);
      
      const centerX = this.scale.width / 2;
      const centerY = this.scale.height / 2;
      const angle = (i / 8) * Math.PI * 2;
      const length = 300;
      
      ray.lineBetween(
        centerX,
        centerY,
        centerX + Math.cos(angle) * length,
        centerY + Math.sin(angle) * length
      );
      
      lightRays.push(ray);
    }
    
    // カメラの激しいフラッシュ
    this.cameras.main.flash(200, 255, 255, 255, true);
    
    // 敵の強烈な点滅エフェクト
    if (this.enemySprite) {
      this.enemySprite.setTint(0xffffff);
      
      this.tweens.add({
        targets: this.enemySprite,
        alpha: { from: 1, to: 0.1 },
        duration: 100,
        yoyo: true,
        repeat: 3
      });
    }
    
    // エフェクトのフェードアウト
    setTimeout(() => {
      this.tweens.add({
        targets: [flash, ...lightRays],
        alpha: 0,
        duration: 300,
        onComplete: () => {
          flash.destroy();
          lightRays.forEach(ray => ray.destroy());
        }
      });
      
      if (this.enemySprite) {
        this.enemySprite.clearTint();
        this.enemySprite.alpha = 1;
      }
    }, 400);
    
    // アニメーション完了まで待機
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  
  // 敵名からアセットパスを推測するユーティリティ
  getEnemyTexturePathByName(name = '') {
    const n = (name || '').toLowerCase();
    console.log('[BattleScene] resolve enemy texture', { name, lowered: n });
    if (n.includes('スライム') || n.includes('slime')) return '/p_school/assets/srime8.png';              // Stage1 (New Slime - 1:1 Aspect)
    if (n.includes('精霊') || n.includes('spirit') || n.includes('seirei')) return '/p_school/assets/serirei01.png'; // Stage1 (Forest Spirit)
    if (n.includes('mirrorknight') || n.includes('twinblade') || n.includes('双子')) return '/p_school/assets/mirrorknight.png'; // Stage13
    if (n.includes('ケミカル') || n.includes('chemical')) return '/p_school/assets/chemical.png';        // Stage2
    if (n.includes('アイス') || n.includes('ice') || n.includes('氷') || n.includes('フロスト')) return '/p_school/assets/ice.png'; // Stage3
    if (n.includes('フレイム') || n.includes('炎') || n.includes('fire') || n.includes('ウルフ')) return '/p_school/assets/frame.png'; // Stage4 (no fire asset)
    if (n.includes('タイム') || n.includes('time')) return '/p_school/assets/time.png';                  // Stage5
    if (n.includes('ポイズン') || n.includes('毒') || n.includes('poison')) return '/p_school/assets/poison.png'; // Stage6
    if (n.includes('メタル') || n.includes('metal') || n.includes('armor') || n.includes('arm')) return '/p_school/assets/armard.png'; // Stage7
    if (n.includes('シールド') || n.includes('盾') || n.includes('ゴブリン')) return '/p_school/assets/shield.png'; // Stage8
    if (n.includes('シャドウ') || n.includes('shadow') || n.includes('ゴースト') || n.includes('影')) return '/p_school/assets/shadow.png'; // Stage9
    if (n.includes('ダーク') || n.includes('dark') || n.includes('ナイト')) return '/p_school/assets/dark.png'; // Stage10
    return '/p_school/assets/srime.png';
  }
  
  // Background path resolver based on stage setting
  getBackgroundTexturePathByName(name = '') {
    const n = (name || '').toLowerCase();
    // 各ステージのキーワードに合わせて、既存アセットから最適なものを選択
    if (n.includes('armory') || n.includes('武器庫')) return '/p_school/assets/armory.jpg'; // Stage13
    if (n.includes('forest')) return '/p_school/assets/forest_stage1.jpg';
    if (n.includes('labo') || n.includes('laboratory')) return '/p_school/assets/labo.jpg';
    if (n.includes('snow')) return '/p_school/assets/snow.jpg';
    if (n.includes('valcano') || n.includes('volcano')) return '/p_school/assets/volcano.jpg';
    if (n.includes('clock')) return '/p_school/assets/clock.jpg';
    if (n.includes('numa')) return '/p_school/assets/numa.jpg';
    if (n.includes('metal')) return '/p_school/assets/metal.jpg'; // 武器庫は金属背景
    if (n.includes('goblin')) return '/p_school/assets/goblin.jpg';
    if (n.includes('shadow') || n.includes('ghost') || n.includes('graveyard')) return '/p_school/assets/ghost.jpg'; // 墓地はゴースト背景
    if (n.includes('castle') || n.includes('dark') || n.includes('void')) return '/p_school/assets/dark.png'; // デジタル/虚無はダーク背景
    if (n.includes('crystal')) return '/p_school/assets/snow.jpg'; // クリスタルは雪山背景を代用
    return '/p_school/assets/bg1.png';
  }

  destroy() {
    // シーン完全破棄時の処理
    if (this.spellBook) {
      this.spellBook.hide();  // 魔法の書を非表示に
    }
    
    // UIレイヤーを非表示にする
    const uiLayer = document.getElementById('ui-layer');
    if (uiLayer) {
      uiLayer.style.display = 'none';
    }
  }
}
