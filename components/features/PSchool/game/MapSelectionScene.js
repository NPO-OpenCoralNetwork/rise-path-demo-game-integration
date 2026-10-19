// MapSelectionScene.js - マップ選択画面

// マップに並べるステージの数（Stage1Battle〜Stage20Battle）
export const STAGE_COUNT = 20;

export class MapSelectionScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MapSelectionScene' });
    this.selectedStage = 1;
    this.unlockedStages = STAGE_COUNT; // デモ用に全ステージ解放
    this.isZoomedIn = false; // ズーム状態を追跡
    this.originalCameraX = 0;
    this.originalCameraY = 0;
    this.originalZoom = 1;
    this.currentZoomBg = null;
    
    // 開発モードフラグ（本番では false に設定）
    this.isDevelopmentMode = true; // TODO: 本番リリース時は false に変更
    this.playerLevel = 1; // プレイヤーレベル（実際にはSupabaseから取得）
  }

  preload() {
    // マップ背景画像の読み込み
    this.load.image('map_bg', '/p_school/assets/map3.jpeg');
    // 旗画像の読み込み
    this.load.image('stage_flag', '/p_school/assets/flag.png');
  }

  async create() {
    console.log('MapSelectionScene initialized');
    
    // 実行ボタンを非表示にする
    this.hideRunButton();
    
    // プレイヤーレベルを取得してアンロック可能ステージを決定
    await this.loadPlayerProgress();
    
    // 背景設定
    this.createBackground();
    
    // タイトル
    this.createTitle();
    
    // ステージマップ
    this.createStageMap();
    
    // ステージ情報パネル（通常時は作成しない）
    // this.createStageInfoPanel();
    
    // 開発モード切り替え用キーボードショートカット
    this.setupDevelopmentModeToggle();
    
    // リサイズイベントの登録
    this.scale.on('resize', this.resize, this);
    
    console.log('MapSelectionScene setup complete');
  }

  resize() {
    // マップ選択画面は要素配置が画面サイズに依存するため、リサイズ時はシーンを再起動してレイアウトを再計算する
    // 連打防止のためのデバウンス処理
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.scene.restart();
    }, 100);
  }

  async loadPlayerProgress() {
    try {
      // 開発モードの場合はすべてのステージをアンロック
      if (this.isDevelopmentMode) {
        console.log(`🔧 開発モード: 全${STAGE_COUNT}ステージをアンロック`);
        this.unlockedStages = STAGE_COUNT;
        this.playerLevel = 20; // 開発用に最大レベル設定（全ステージを解放できるレベル）
        return;
      }
      
      // Supabaseからプレイヤー情報を取得
      const { supabase } = await import('../lib/supabase.js');
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('level, xp')
          .eq('id', user.id)
          .single();
          
        if (error) {
          console.error('プレイヤー情報取得エラー:', error);
          this.playerLevel = 1;
        } else {
          this.playerLevel = profile?.level || 1;
          console.log(`📊 プレイヤーレベル: ${this.playerLevel}`);
        }
      } else {
        console.log('👤 ゲストユーザー: レベル1');
        this.playerLevel = 1;
      }
      
      // レベルに基づいてアンロック可能ステージを計算
      this.unlockedStages = this.calculateUnlockedStages(this.playerLevel);
      console.log(`🔓 アンロック済みステージ: ${this.unlockedStages}`);
      
    } catch (error) {
      console.error('プレイヤー進捗読み込みエラー:', error);
      this.playerLevel = 1;
      this.unlockedStages = 1;
    }
  }

  // 開発モード切り替え用のキーボードショートカット設定
  setupDevelopmentModeToggle() {
    // Ctrl+Shift+Dで開発モードを切り替え
    this.input.keyboard.on('keydown', (event) => {
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
        this.toggleDevelopmentMode();
      }
    });
    
    // 開発モード状態を画面に表示
    this.createDevelopmentModeIndicator();
  }

  // 開発モードの切り替え
  toggleDevelopmentMode() {
    this.isDevelopmentMode = !this.isDevelopmentMode;
    
    console.log(`🔧 開発モード: ${this.isDevelopmentMode ? 'ON' : 'OFF'}`);
    
    // インジケーターを更新
    this.updateDevelopmentModeIndicator();
    
    // プレイヤー進捗を再読み込み
    this.loadPlayerProgress().then(() => {
      // マップを再作成
      this.children.removeAll();
      this.createBackground();
      this.createTitle();
      this.createStageMap();
      this.setupDevelopmentModeToggle();
    });
  }

  // 開発モードインジケーターを作成
  createDevelopmentModeIndicator() {
    this.devModeText = this.add.text(10, 10, '', {
      fontSize: '16px',
      fill: '#ff6b6b',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 }
    }).setDepth(1000);
    
    this.updateDevelopmentModeIndicator();
  }

  // 開発モードインジケーターを更新
  updateDevelopmentModeIndicator() {
    if (this.devModeText) {
      if (this.isDevelopmentMode) {
        this.devModeText.setText('🔧 開発モード (Ctrl+Shift+D で切り替え)');
        this.devModeText.setVisible(true);
      } else {
        this.devModeText.setText('Ctrl+Shift+D: 開発モード');
        this.devModeText.setStyle({ fill: '#666666' });
        this.devModeText.setVisible(false);
      }
    }
  }

  calculateUnlockedStages(playerLevel) {
    // レベルに基づくステージアンロック条件
    const stageUnlockTable = {
      1: 1,   // レベル1: ステージ1のみ
      2: 2,   // レベル2: ステージ2まで
      3: 3,   // レベル3: ステージ3まで
      4: 4,   // レベル4: ステージ4まで
      5: 6,   // レベル5: ステージ6まで（ボーナス）
      6: 7,   // レベル6: ステージ7まで
      7: 8,   // レベル7: ステージ8まで
      8: 9,   // レベル8: ステージ9まで
      9: 10,  // レベル9: ステージ10まで
      10: 12, // レベル10: ステージ12まで（ボーナス）
      11: 13, // レベル11: ステージ13まで
      12: 14, // レベル12: ステージ14まで
      13: 15, // レベル13: ステージ15まで
      14: 16, // レベル14: ステージ16まで
      15: 18, // レベル15: ステージ18まで（ボーナス）
      16: 19, // レベル16: ステージ19まで
      17: 19, // レベル17: ステージ19まで
      18: 19, // レベル18: ステージ19まで
      19: 20, // レベル19: ステージ20まで
      20: 20  // レベル20: 全ステージ
    };

    // プレイヤーレベルに対応するアンロック可能ステージ数を返す
    // レベルが20を超える場合は20ステージすべてアンロック
    return Math.min(stageUnlockTable[Math.min(playerLevel, STAGE_COUNT)] || 1, STAGE_COUNT);
  }

  createBackground() {
    // 画面サイズを取得
    const { width, height } = this.scale;
    
    // map3.jpgを背景画像として設定（全画面対応）
    const mapBg = this.add.image(width/2, height/2, 'map_bg');
    mapBg.setDisplaySize(width, height);
    mapBg.setAlpha(1.0); // 背景画像を完全に表示
    
    // 背景画像の上にオーバーレイを追加（マップの見た目を向上）
    const overlay = this.add.rectangle(width/2, height/2, width, height, 0x0f1419, 0.15);
    
    // マップUIの装飾要素を追加
    this.createMapUIDecorations();
  }

  createMapUIDecorations() {
    // 画面サイズを取得
    const { width, height } = this.scale;
    
    // マップの境界線とフレーム（画面サイズに対応）
    const mapFrame = this.add.graphics();
    mapFrame.lineStyle(4, 0x8b4513, 0.8); // 茶色の枠線
    mapFrame.strokeRoundedRect(20, 20, width - 40, height - 40, 10);
    
    // 内側の装飾フレーム
    mapFrame.lineStyle(2, 0xd4af37, 0.6); // 金色の内枠
    mapFrame.strokeRoundedRect(30, 30, width - 60, height - 60, 8);
    
    // マップの角に装飾
    this.createCornerDecorations();
    
    // 古地図風のエフェクト
    this.createAncientMapEffects();
  }

  createCornerDecorations() {
    // 画面サイズを取得
    const { width, height } = this.scale;
    
    // 四隅に装飾的な要素を追加（画面サイズに対応）
    const cornerSize = 40;
    const corners = [
      { x: 40, y: 40 },                    // 左上
      { x: width - 40, y: 40 },            // 右上
      { x: 40, y: height - 40 },           // 左下
      { x: width - 40, y: height - 40 }    // 右下
    ];
    
    corners.forEach((corner, index) => {
      const decoration = this.add.graphics();
      decoration.fillStyle(0xd4af37, 0.7);
      
      // 装飾的な図形を描画
      if (index === 0 || index === 3) { // 左側
        decoration.fillTriangle(
          corner.x, corner.y - cornerSize/2,
          corner.x + cornerSize/2, corner.y,
          corner.x, corner.y + cornerSize/2
        );
      } else { // 右側
        decoration.fillTriangle(
          corner.x, corner.y - cornerSize/2,
          corner.x - cornerSize/2, corner.y,
          corner.x, corner.y + cornerSize/2
        );
      }
    });
  }

  createAncientMapEffects() {
    // 画面サイズを取得
    const { width, height } = this.scale;
    
    // 古地図風のテクスチャエフェクト（画面サイズに対応）
    for (let i = 0; i < 30; i++) {
      const spot = this.add.graphics();
      spot.fillStyle(0x8b4513, 0.1 + Math.random() * 0.2);
      const size = 10 + Math.random() * 30;
      spot.fillCircle(
        50 + Math.random() * (width - 100),
        50 + Math.random() * (height - 100),
        size
      );
    }
    
    // 地図の境界に影効果（画面サイズに対応）
    const shadow = this.add.graphics();
    shadow.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.3, 0, 0, 0.3);
    shadow.fillRect(0, 0, width, 50); // 上の影
    shadow.fillRect(0, height - 50, width, 50); // 下の影
    shadow.fillRect(0, 0, 50, height); // 左の影
    shadow.fillRect(width - 50, 0, 50, height); // 右の影
  }

  createTitle() {
    // 画面サイズを取得
    const { width } = this.scale;
    
    // タイトル背景（画面幅に対応）
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x000000, 0.6);
    titleBg.fillRoundedRect(width/2 - 200, 20, 400, 60, 10);
    titleBg.lineStyle(2, 0xd4af37, 0.8);
    titleBg.strokeRoundedRect(width/2 - 200, 20, 400, 60, 10);
    
    // メインタイトル
    this.add.text(width/2, 50, '🗺️ 冒険マップ', {
      fontSize: '36px',
      fontFamily: 'Arial Black, sans-serif',
      fill: '#ffd700',
      stroke: '#2c3e50',
      strokeThickness: 4,
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

    // 戻るボタン
    const backButtonBg = this.add.graphics();
    backButtonBg.fillStyle(0x8b4513, 0.8);
    backButtonBg.fillRoundedRect(20, 20, 120, 40, 8);
    backButtonBg.lineStyle(2, 0xd4af37, 0.8);
    backButtonBg.strokeRoundedRect(20, 20, 120, 40, 8);
    
    const backButton = this.add.text(80, 40, '🏠 ホームへ', {
      fontSize: '20px',
      fontFamily: 'Arial, sans-serif',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2 // 解像度を2倍に設定
    }).setOrigin(0.5);

    backButton.setInteractive();
    backButton.on('pointerdown', () => {
      this.createTransitionEffect();
      this.time.delayedCall(300, () => {
        this.scene.start('HomeScene');
      });
    });

    // ホバーエフェクト
    backButton.on('pointerover', () => {
      backButton.setStyle({ fill: '#ffd700' });
      this.tweens.add({
        targets: backButtonBg,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 200,
        ease: 'Power2'
      });
    });
    
    backButton.on('pointerout', () => {
      backButton.setStyle({ fill: '#ffffff' });
      this.tweens.add({
        targets: backButtonBg,
        scaleX: 1,
        scaleY: 1,
        duration: 200,
        ease: 'Power2'
      });
    });
  }

  createTransitionEffect() {
    // 画面遷移エフェクト
    const transition = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0);
    this.tweens.add({
      targets: transition,
      alpha: 1,
      duration: 300,
      ease: 'Power2'
    });
  }

  createStageMap() {
    this.stageButtons = [];
    
    // 背景画像に合わせたステージの配置座標
    const stagePositions = this.generateMapBasedStagePositions();
    
    for (let i = 1; i <= STAGE_COUNT; i++) {
      const pos = stagePositions[i - 1];
      const isUnlocked = i <= this.unlockedStages;
      
      this.createEnhancedStageButton(pos.x, pos.y, i, isUnlocked);
    }
  }

  generateMapBasedStagePositions() {
    // 画面サイズを取得
    const { width, height } = this.scale;
    
    // 固定位置の定義（画面サイズに対応した比率で配置）
    const fixedPositions = [
      // ステージ1-5 - 左下から始まる
      { x: width * 0.15, y: height * 0.8 },   // ステージ1 - スタート地点（草原の始まり）
      { x: width * 0.25, y: height * 0.75 },  // ステージ2 - 荒れた研究所
      { x: width * 0.35, y: height * 0.7 },   // ステージ3 - 雪の遺跡
      { x: width * 0.45, y: height * 0.65 },  // ステージ4 - 溶岩の洞窟
      { x: width * 0.55, y: height * 0.6 },   // ステージ5 - 時計の空中庭園

      // ステージ6-10 - 中央を通る
      { x: width * 0.65, y: height * 0.55 },  // ステージ6 - 毒キノコの沼
      { x: width * 0.7, y: height * 0.45 },   // ステージ7 - 鉄の鋳造所
      { x: width * 0.6, y: height * 0.4 },    // ステージ8 - ゴブリンの砦
      { x: width * 0.5, y: height * 0.35 },   // ステージ9 - 幽霊屋敷
      { x: width * 0.4, y: height * 0.3 },    // ステージ10 - 闇の玉座
      
      // ステージ11-15 - 上の道を右へ（タイトルと、ピンの上に出る説明が画面の上で切れない高さ）
      { x: width * 0.29, y: height * 0.24 },  // ステージ11 - 幻影の森
      { x: width * 0.37, y: height * 0.17 },  // ステージ12 - 獣の森
      { x: width * 0.47, y: height * 0.21 },  // ステージ13 - 城の武器庫
      { x: width * 0.58, y: height * 0.17 },  // ステージ14 - 水晶の洞窟
      { x: width * 0.69, y: height * 0.22 },  // ステージ15 - 属性の祭壇

      // ステージ16-19 - 右側を下る（右上の「ブロック」ボタンより下）
      { x: width * 0.79, y: height * 0.17 },  // ステージ16 - 鏡の湖
      { x: width * 0.87, y: height * 0.27 },  // ステージ17 - 月夜の墓地
      { x: width * 0.81, y: height * 0.37 },  // ステージ18 - 錬金術師の店
      { x: width * 0.87, y: height * 0.47 },  // ステージ19 - 騎士の訓練場

      // ステージ20（最終ボス）- 右側の道の終点
      { x: width * 0.8, y: height * 0.59 }    // ステージ20 - コードの王座
    ];
    
    return fixedPositions;
  }

  createEnhancedStageButton(x, y, stageNum, isUnlocked) {
    const container = this.add.container(x, y);
    
    // ピンの影
    const shadow = this.add.ellipse(2, 25, 20, 8, 0x000000, 0.3);
    container.add(shadow);
    
    // 旗全体（ポール込み）の画像
    const flagColor = this.getStageAreaColor(stageNum);
    const flag = this.add.image(0, 0, 'stage_flag');
    
    // 画像の比率を維持して縮小 (元画像が大きいと仮定して調整)
    const targetHeight = 60; // 旗の高さを60pxくらいに設定
    const scale = targetHeight / flag.height;
    flag.setScale(scale);
    
    // 画像の原点を「ポールの下端」に合わせる (画像の下中央と仮定)
    flag.setOrigin(0.5, 1.0);
    // 影の位置に合わせるために少し上に配置
    flag.y = 25; 
    
    if (isUnlocked) {
      // アンロック状態
      // Tintを削除して元の画像の色を表示
      
      // キラキラエフェクト
      const sparkles = this.add.graphics();
      sparkles.fillStyle(0xffd700, 0.8);
      sparkles.fillCircle(-5, -30, 2);
      sparkles.fillCircle(15, -20, 1.5);
      container.add(sparkles);
      
      this.tweens.add({
        targets: sparkles,
        alpha: { from: 0.8, to: 0.3 },
        duration: 2000,
        repeat: -1,
        yoyo: true
      });
      
    } else {
      // ロック状態
      // Tintを削除。代わりに少し透明度を下げるだけで元の色を維持
      flag.setAlpha(0.5);
      
      // ロックアイコン
      const lockIcon = this.add.text(0, -10, '🔒', {
        fontSize: '16px',
        stroke: '#000',
        strokeThickness: 2
      }).setOrigin(0.5);
      container.add(lockIcon);
      
      // レベル不足の表示
      const requiredLevel = this.getRequiredLevelForStage(stageNum);
      if (requiredLevel > this.playerLevel) {
        const levelReqText = this.add.text(0, 15, `Lv.${requiredLevel}`, {
          fontSize: '10px',
          fontFamily: 'Arial Bold, sans-serif',
          fill: '#ff6b6b',
          stroke: '#000000',
          strokeThickness: 2,
          padding: { x: 2, y: 1 }
        }).setOrigin(0.5);
        container.add(levelReqText);
      }
    }
    
    container.add(flag);
    // 旗を影より手前に表示するために並び替え（addした順序で決まるが念の ため）
    container.sendToBack(flag); 
    container.sendToBack(shadow);
    
    // 特別なステージの装飾
    if (stageNum === 5 || stageNum === 10 || stageNum === 15) {
      const star = this.add.text(-10, -40, '⭐', { fontSize: '14px' }).setOrigin(0.5);
      container.add(star);
    }
    
    // ボス戦ステージの装飾
    if (stageNum === 20) {
      const crownIcon = this.add.text(0, -50, '👑', { fontSize: '18px' }).setOrigin(0.5);
      container.add(crownIcon);
    }
    
    // インタラクティブ設定
    if (isUnlocked) {
      container.setSize(40, 60);
      container.setInteractive();
      
      container.on('pointerover', () => {
        this.tweens.add({
          targets: container,
          scaleX: 1.15,
          scaleY: 1.15,
          duration: 200,
          ease: 'Back.easeOut'
        });
        this.showHoverTooltip(stageNum, x, y);
      });
      
      container.on('pointerout', () => {
        this.tweens.add({
          targets: container,
          scaleX: 1,
          scaleY: 1,
          duration: 200,
          ease: 'Back.easeIn'
        });
        this.hideHoverTooltip();
      });
      
      container.on('pointerdown', () => {
        this.createPinZoomEffect(container, x, y, stageNum);
        this.selectedStage = stageNum;
        this.selectStage(stageNum);
      });
    } else {
      // ロック状態
      container.setSize(40, 60);
      container.setInteractive();
      container.on('pointerover', () => this.showLockTooltip(stageNum, x, y));
      container.on('pointerout', () => this.hideLockTooltip());
      container.on('pointerdown', () => this.createLockedStageEffect(container));
    }
    
    this.stageButtons.push(container);
  }

  getStageAreaColor(stageNum) {
    if (stageNum <= 5) return 0x32cd32;      // 草原 - 明るい緑
    if (stageNum <= 10) return 0x8fbc8f;     // 森林 - 暗い海緑
    if (stageNum <= 15) return 0x4682b4;     // 山岳 - 鋼青
    if (stageNum <= 19) return 0xcd5c5c;     // 廃墟 - インディアンレッド
    return 0x8a2be2;                         // ボス - ブルーバイオレット
  }



  createBattleTransition() {
    // 戦闘遷移エフェクト
    const flash = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0xffffff, 0);
    this.tweens.add({
      targets: flash,
      alpha: 0.8,
      duration: 100,
      yoyo: true,
      repeat: 2,
      ease: 'Power2'
    });
    
    // 戦闘準備テキスト
    const battleText = this.add.text(this.scale.width / 2, this.scale.height / 2, '⚔️ 戦闘準備中...', {
      fontSize: '24px',
      fontFamily: 'Arial Black',
      fill: '#ff0000',
      stroke: '#ffffff',
      strokeThickness: 3,
      alpha: 0
    }).setOrigin(0.5);
    
    this.tweens.add({
      targets: battleText,
      alpha: 1,
      duration: 300,
      ease: 'Power2'
    });
  }

  // ヘルパー関数
  getCompletedStages() {
    // デモ用: ランダムに5-10ステージクリア済みとする
    return Math.floor(5 + Math.random() * 6);
  }

  showHoverTooltip(stageNum, x, y) {
    // 既存のツールチップを削除
    this.hideHoverTooltip();
    
    const stageData = this.getStageData(stageNum);
    
    // ツールチップの背景
    this.hoverTooltipBg = this.add.graphics();
    this.hoverTooltipBg.fillStyle(0x000000, 0.9);
    this.hoverTooltipBg.lineStyle(2, 0xffd700, 0.8);
    
    // ツールチップの位置を計算（ピンの上に表示。右端・左端のピンでも画面からはみ出さないように収める）
    const tooltipWidth = 240;
    const tooltipHeight = 60;
    const tooltipX = Phaser.Math.Clamp(x - tooltipWidth / 2, 8, this.scale.width - tooltipWidth - 8);
    const tooltipY = y - 80;

    this.hoverTooltipBg.fillRoundedRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    this.hoverTooltipBg.strokeRoundedRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    
    // ツールチップのテキスト
    this.hoverTooltipText = this.add.text(tooltipX + tooltipWidth/2, tooltipY + 20, stageData.name, {
      fontSize: '16px',
      fontFamily: 'Arial Bold',
      fill: '#ffd700',
      stroke: '#000000',
      strokeThickness: 1
    }).setOrigin(0.5);
    
    this.hoverTooltipSubText = this.add.text(tooltipX + tooltipWidth/2, tooltipY + 40, 'クリックでズーム', {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 1
    }).setOrigin(0.5);
    
    // ツールチップをカメラに固定
    this.hoverTooltipBg.setScrollFactor(0);
    this.hoverTooltipText.setScrollFactor(0);
    this.hoverTooltipSubText.setScrollFactor(0);
    
    // フェードイン
    [this.hoverTooltipBg, this.hoverTooltipText, this.hoverTooltipSubText].forEach(element => {
      element.setAlpha(0);
      this.tweens.add({
        targets: element,
        alpha: 1,
        duration: 200,
        ease: 'Power2'
      });
    });
  }

  hideHoverTooltip() {
    if (this.hoverTooltipBg) {
      this.hoverTooltipBg.destroy();
      this.hoverTooltipBg = null;
    }
    if (this.hoverTooltipText) {
      this.hoverTooltipText.destroy();
      this.hoverTooltipText = null;
    }
    if (this.hoverTooltipSubText) {
      this.hoverTooltipSubText.destroy();
      this.hoverTooltipSubText = null;
    }
  }

  createZoomedStageInfoPanel(stageNum) {
    // ズーム時のステージ情報パネル（ズーム視野内の右下に配置）
    const panelWidth = 160;
    const panelHeight = 100;
  
    // カメラの現在状態を取得
    const camera = this.cameras.main;
    const cameraX = camera.scrollX;
    const cameraY = camera.scrollY;
    const zoom = camera.zoom;
    
    // ズーム時の視野サイズを計算
    const viewWidth = camera.width / zoom;
    const viewHeight = camera.height / zoom;
    
    // パネルをズーム視野内の右下に配置
    const margin = -50;
    const panelX = cameraX + viewWidth - panelWidth - margin;
    const panelY = cameraY + viewHeight - panelHeight - margin + 10;
    
    // デバッグ用ログ
    console.log(`Creating panel at position: ${panelX}, ${panelY}`);
    console.log(`Camera: ${cameraX}, ${cameraY}, zoom: ${zoom}`);
    console.log(`View size: ${viewWidth}x${viewHeight}`);
    
    // パネル背景（赤枠と同じサイズに拡張）
    this.zoomedPanelBg = this.add.graphics();
    this.zoomedPanelBg.fillStyle(0x000000, 0.9);
    this.zoomedPanelBg.fillRoundedRect(panelX - 10, panelY - 10, panelWidth + 20, panelHeight + 20, 15);
    
    // 黄色の枠線（赤枠と同じサイズに拡張）
    this.zoomedPanelBg.lineStyle(3, 0xffd700, 0.9);
    this.zoomedPanelBg.strokeRoundedRect(panelX - 10, panelY - 10, panelWidth + 20, panelHeight + 20, 15);
    
    // テスト用: パネルの境界を赤で表示（より大きく、目立つように）
    this.zoomedPanelBg.lineStyle(5, 0xff0000, 1);
    this.zoomedPanelBg.strokeRoundedRect(panelX - 10, panelY - 10, panelWidth + 20, panelHeight + 20, 15);
    
    // さらに大きな緑の境界でテスト
    this.zoomedPanelBg.lineStyle(3, 0x00ff00, 1);
    this.zoomedPanelBg.strokeRoundedRect(panelX - 15, panelY - 15, panelWidth + 30, panelHeight + 30, 15);
    
    // 装飾的な内枠（赤枠に合わせてサイズ調整）
    this.zoomedPanelBg.lineStyle(1, 0x8b4513, 0.7);
    this.zoomedPanelBg.strokeRoundedRect(panelX - 10, panelY - 10, panelWidth + 20, panelHeight + 20, 10);
    
    // ステージデータを取得
    const stageData = this.getStageData(stageNum);
    
    // ステージナンバー（上部に大きく表示）
    this.zoomedStageNumberText = this.add.text(panelX + panelWidth/2, panelY + 5, `Stage ${stageNum}`, {
      fontSize: '14px',
      fontFamily: 'Arial Bold, sans-serif',
      fill: '#ffd700',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2 // 解像度を2倍に設定
    }).setOrigin(0.5);
    
    // ステージ名（ステージナンバーの下に配置）
    this.zoomedStageNameText = this.add.text(panelX + panelWidth/2, panelY + 18, stageData.name, {
      fontSize: '10px',
      fontFamily: 'Arial Bold, sans-serif',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 1,
      resolution: 2 // 解像度を2倍に設定
    }).setOrigin(0.5);
    
  
    // ステージ詳細（小さなパネルに合わせて調整）
    this.zoomedStageDetailText = this.add.text(panelX + panelWidth/2, panelY + 35, stageData.description, {
      fontSize: '8px',
      fontFamily: 'Arial, sans-serif',
      fill: '#e8e8e8',
      stroke: '#000000',
      strokeThickness: 1,
      resolution: 2, // 解像度を2倍に設定
      wordWrap: { width: panelWidth - 8 },
      align: 'center'
    }).setOrigin(0.5);

    // 報酬情報の背景（小さく調整）
    const rewardBgX = panelX + 3;
    const rewardBgY = panelY + 55;
    const rewardBgWidth = panelWidth - 6;
    const rewardBgHeight = 12;
    this.zoomedPanelBg.fillStyle(0x8b4513, 0.7);
    this.zoomedPanelBg.fillRoundedRect(rewardBgX, rewardBgY, rewardBgWidth, rewardBgHeight, 2);
    
    // 報酬情報（小さなフォントに調整）
    this.zoomedRewardText = this.add.text(panelX + panelWidth/2, rewardBgY + 6, `💎 ${stageData.reward}`, {
      fontSize: '9px',
      fontFamily: 'Arial, sans-serif',
      fill: '#ffd700',
      stroke: '#000000',
      strokeThickness: 1,
      resolution: 2 // 解像度を2倍に設定
    }).setOrigin(0.5);

    // 開始ボタン（小さく調整）
    const startBtnX = panelX + 3;
    const startBtnY = panelY + 70;
    const startBtnWidth = panelWidth - 6;
    const startBtnHeight = 18;
    const startBtnCenterX = panelX + panelWidth/2;
    const startBtnCenterY = startBtnY + startBtnHeight/2;
    
    this.zoomedStartButtonBg = this.add.graphics();
    this.zoomedStartButtonBg.fillStyle(0xe74c3c, 0.9);
    this.zoomedStartButtonBg.fillRoundedRect(-startBtnWidth/2, -startBtnHeight/2, startBtnWidth, startBtnHeight, 2);
    this.zoomedStartButtonBg.lineStyle(1, 0xffd700, 0.8);
    this.zoomedStartButtonBg.strokeRoundedRect(-startBtnWidth/2, -startBtnHeight/2, startBtnWidth, startBtnHeight, 2);
    
    this.zoomedStartButton = this.add.text(0, 0, '⚔️ START', {
      fontSize: '12px',
      fontFamily: 'Arial Bold, sans-serif',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2 // 解像度を2倍に設定
    }).setOrigin(0.5);

    // ボタンコンテナ
    this.zoomedStartButtonContainer = this.add.container(startBtnCenterX, startBtnCenterY, [this.zoomedStartButtonBg, this.zoomedStartButton]);

    // インタラクティブエリア
    const zoomedHitArea = this.add.rectangle(startBtnCenterX, startBtnCenterY, startBtnWidth, startBtnHeight, 0x000000, 0);
    zoomedHitArea.setInteractive();
    
    // ボタンのインタラクティブ設定
    zoomedHitArea.on('pointerdown', () => {
      this.createBattleTransition();
      this.time.delayedCall(500, () => {
        this.startStage(stageNum);
      });
    });

    // ホバーエフェクト
    zoomedHitArea.on('pointerover', () => {
      if (this.zoomedStartButtonBg && this.zoomedStartButtonBg.clear) {
        this.zoomedStartButtonBg.clear();
        this.zoomedStartButtonBg.fillStyle(0xc0392b, 0.9);
        this.zoomedStartButtonBg.fillRoundedRect(-startBtnWidth/2, -startBtnHeight/2, startBtnWidth, startBtnHeight, 2);
        this.zoomedStartButtonBg.lineStyle(2, 0xffd700, 1);
        this.zoomedStartButtonBg.strokeRoundedRect(-startBtnWidth/2, -startBtnHeight/2, startBtnWidth, startBtnHeight, 2);
      }
      
      if (this.zoomedStartButtonContainer) {
        this.tweens.add({
          targets: this.zoomedStartButtonContainer,
          scaleX: 1.05,
          scaleY: 1.05,
          duration: 200,
          ease: 'Power2'
        });
      }
    });
    
    zoomedHitArea.on('pointerout', () => {
      if (this.zoomedStartButtonBg && this.zoomedStartButtonBg.clear) {
        this.zoomedStartButtonBg.clear();
        this.zoomedStartButtonBg.fillStyle(0xe74c3c, 0.9);
        this.zoomedStartButtonBg.fillRoundedRect(-startBtnWidth/2, -startBtnHeight/2, startBtnWidth, startBtnHeight, 2);
        this.zoomedStartButtonBg.lineStyle(1, 0xffd700, 0.8);
        this.zoomedStartButtonBg.strokeRoundedRect(-startBtnWidth/2, -startBtnHeight/2, startBtnWidth, startBtnHeight, 2);
      }
      
      if (this.zoomedStartButtonContainer) {
        this.tweens.add({
          targets: this.zoomedStartButtonContainer,
          scaleX: 1,
          scaleY: 1,
          duration: 200,
          ease: 'Power2'
        });
      }
    });

    // ズームHitAreaの参照を保存
    this.zoomedStartButtonHitArea = zoomedHitArea;
    
    // パネル全体をワールド座標に配置（カメラと一緒に動く）
    // setScrollFactor(1)でカメラの動きに追従
    this.zoomedPanelBg.setScrollFactor(1);
    this.zoomedStageNameText.setScrollFactor(1);
    this.zoomedStageDetailText.setScrollFactor(1);
    this.zoomedRewardText.setScrollFactor(1);
    this.zoomedStartButtonContainer.setScrollFactor(1);
    this.zoomedStartButtonHitArea.setScrollFactor(1);
 
    
    console.log('Panel elements created and scroll factors set to 1 (world coordinates)');
      // パネルのフェードイン
    const panelElements = [
      this.zoomedPanelBg,
      this.zoomedStageNumberText,
      this.zoomedStageNameText, 
      this.zoomedStageDetailText, 
      this.zoomedRewardText,
      this.zoomedStartButtonContainer,
      this.zoomedStartButtonHitArea,
   
    ];
    
    panelElements.forEach(element => {
      element.setAlpha(0);
      this.tweens.add({
        targets: element,
        alpha: 1,
        duration: 600,
        delay: 200,
        ease: 'Power2'
      });
    });
  }

  destroyZoomedStageInfoPanel() {
    // ズーム時のステージ情報パネルを削除
    console.log('Destroying zoomed stage info panel');
    
    // 全てのTweenを停止
    if (this.tweens) {
      this.tweens.killAll();
    }
    
    // 各オブジェクトを安全に破棄
    const objectsToDestroy = [
      'zoomedPanelBg',
      'zoomedStageNumberText',
      'zoomedStageNameText', 
      'zoomedStageDetailText',
      'zoomedRewardText',
      'zoomedStartButton',
      'zoomedStartButtonBg',
      'zoomedStartButtonContainer'
    ];
    
    objectsToDestroy.forEach(objName => {
      if (this[objName]) {
        try {
          // イベントリスナーを削除
          if (this[objName].removeAllListeners) {
            this[objName].removeAllListeners();
          }
          // オブジェクトを破棄
          this[objName].destroy();
          this[objName] = null;
        } catch (error) {
          console.warn(`Error destroying ${objName}:`, error);
          this[objName] = null;
        }
      }
    });
  }

  selectStage(stageNum) {
    this.selectedStage = stageNum;
    
    // 選択エフェクト
    const selectedEffect = this.add.graphics();
    selectedEffect.lineStyle(4, 0xffd700, 0.8);
    selectedEffect.strokeCircle(0, 0, 30);
    
    const stagePos = this.generateMapBasedStagePositions()[stageNum - 1];
    selectedEffect.x = stagePos.x;
    selectedEffect.y = stagePos.y;
    
    this.tweens.add({
      targets: selectedEffect,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => selectedEffect.destroy()
    });
  }

  getStageData(stageNum) {
    const stageTypes = {
      1: { name: '🌱 草原の始まり', description: 'プログラミングの基礎を学ぶ初心者向けステージ', reward: 'ゴールド×50, 経験値×100' },
      // 2〜20 は、名前を各ステージの戦闘の背景に、説明をそのステージで学ぶこと（使うブロックや仕組み）に合わせる
      2: { name: '🧪 荒れた研究所', description: '回復の魔法でHPを保ちながら戦おう', reward: 'ゴールド×75, 経験値×150' },
      3: { name: '❄️ 雪の遺跡', description: '手の動きを組み合わせて炎の魔法を唱えよう', reward: 'ゴールド×100, 経験値×200' },
      4: { name: '🌋 溶岩の洞窟', description: '氷の盾で炎の攻撃を防ごう', reward: 'ゴールド×125, 経験値×250' },
      5: { name: '⏰ 時計の空中庭園', description: '5ターン以内に倒す手順を組もう', reward: 'ゴールド×150, 経験値×300' },
      6: { name: '🍄 毒キノコの沼', description: '解毒薬を調合して毒を消しながら戦おう', reward: 'ゴールド×200, 経験値×400' },
      7: { name: '⚙️ 鉄の鋳造所', description: '雷の魔法で硬い装甲を破ろう', reward: 'ゴールド×250, 経験値×500' },
      8: { name: '🏰 ゴブリンの砦', description: 'くり返しで攻撃を重ねて盾を壊そう', reward: 'ゴールド×300, 経験値×600' },
      9: { name: '👻 幽霊屋敷', description: '閃光魔法で、よける敵に攻撃を当てよう', reward: 'ゴールド×400, 経験値×700' },
      10: { name: '🌑 闇の玉座', description: 'これまでの魔法を組み合わせてボスに挑もう', reward: 'ゴールド×500, 経験値×800' },
      11: { name: '🔮 幻影の森', description: '変数に敵の攻撃を覚えて、はね返そう', reward: 'ゴールド×600, 経験値×1000' },
      12: { name: '🐾 獣の森', description: '条件分岐で攻撃を見分けて反撃しよう', reward: 'ゴールド×750, 経験値×1200' },
      13: { name: '⚔️ 城の武器庫', description: '連続攻撃を関数にまとめて守りを崩そう', reward: 'ゴールド×900, 経験値×1400' },
      14: { name: '💎 水晶の洞窟', description: 'ループ処理で水晶の鎧を砕こう', reward: 'ゴールド×1100, 経験値×1600' },
      15: { name: '🔥 属性の祭壇', description: '敵の属性を調べて、効く魔法を選ぼう', reward: 'ゴールド×1300, 経験値×1800' },
      16: { name: '💠 鏡の湖', description: 'すきを待ってカウンターを決めよう', reward: 'ゴールド×1500, 経験値×2000' },
      17: { name: '💀 月夜の墓地', description: '関数を作って、何度も呼び出そう', reward: 'ゴールド×1800, 経験値×2300' },
      18: { name: '⚗️ 錬金術師の店', description: 'レシピを関数にして薬を合成しよう', reward: 'ゴールド×2100, 経験値×2600' },
      19: { name: '🛡️ 騎士の訓練場', description: '素材で武器を強化し、使い分けよう', reward: 'ゴールド×2500, 経験値×3000' },
      20: { name: '👑 コードの王座', description: '最終試練 - これまでの技をすべて使おう', reward: '伝説の装備, マスタープログラマー称号' }
    };

    return stageTypes[stageNum] || { 
      name: `ステージ ${stageNum}`, 
      description: '謎に満ちた冒険が待っている...', 
      reward: 'ゴールド×100, 経験値×200' 
    };
  }

  startStage(stageNumber) {
    console.log(`Starting stage ${stageNumber}`);
    console.log('About to start StoryScene with data:', { 
      stage: stageNumber, 
      isDevelopmentMode: this.isDevelopmentMode 
    });
    
    // ステージ開始時にツールボックスを更新（非同期で安全に）
    if (window.updateToolboxForStage) {
      setTimeout(() => {
        window.updateToolboxForStage(stageNumber);
        console.log(`🎯 MapSelectionScene: ステージ ${stageNumber} のツールボックス更新を実行`);
      }, 100);
    } else {
      console.warn('⚠️ MapSelectionScene: ツールボックス更新機能が利用できません');
    }
    
    // ストーリーシーンに遷移してから戦闘シーンへ
    this.scene.start('StoryScene', { 
      stage: stageNumber,
      isDevelopmentMode: this.isDevelopmentMode 
    });
    
    // デバッグ用: 少し後にStorySceneが実際に開始されたかチェック
    setTimeout(() => {
      const storyScene = this.scene.get('StoryScene');
      console.log('StoryScene status after 100ms:', storyScene ? 'Found' : 'Not found');
      if (storyScene) {
        console.log('StoryScene is running:', storyScene.scene.isActive());
      }
    }, 100);
  }

  createPinZoomEffect(container, x, y, stageNum) {
    // すでにズームインしている場合は元に戻す
    if (this.isZoomedIn) {
      this.returnToOriginalView();
      return;
    }
    
    // カメラの初期位置を保存
    this.originalCameraX = this.cameras.main.scrollX;
    this.originalCameraY = this.cameras.main.scrollY;
    this.originalZoom = this.cameras.main.zoom;
    
    // ズーム時の背景エフェクト
    this.currentZoomBg = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x000000, 0);
    this.tweens.add({
      targets: this.currentZoomBg,
      alpha: 0.6,
      duration: 500,
      ease: 'Power2'
    });
    
    // カメラをピンの位置にズーム
    this.cameras.main.pan(x, y, 800, 'Power2');
    this.cameras.main.zoomTo(2.5, 800);
    this.isZoomedIn = true;
    
    // ズーム時の特別なエフェクト（ピンの位置に）
    const zoomEffect = this.add.graphics();
    zoomEffect.lineStyle(5, 0xffd700, 1);
    zoomEffect.strokeCircle(x, y, 60);
    
    this.tweens.add({
      targets: zoomEffect,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => zoomEffect.destroy()
    });
    
    // ズーム時のパーティクルエフェクト
    for (let i = 0; i < 12; i++) {
      const particle = this.add.graphics();
      particle.fillStyle(0xffd700, 0.8);
      particle.fillCircle(0, 0, 4);
      particle.x = x;
      particle.y = y;
      
      const angle = (i / 12) * Math.PI * 2;
      const distance = 150;
      
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.1,
        scaleY: 0.1,
        duration: 800,
        ease: 'Power2',
        onComplete: () => particle.destroy()
      });
    }
    
    // ピンを少し光らせる
    this.tweens.add({
      targets: container,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 400,
      ease: 'Power2',
      yoyo: true
    });
    
    // ズーム完了後にステージ情報パネルを表示
    this.time.delayedCall(800, () => {
      console.log('About to create zoomed stage info panel for stage', stageNum);
      this.createZoomedStageInfoPanel(stageNum);
    });
  }

  returnToOriginalView() {
    // ズーム時のステージ情報パネルを削除
    this.destroyZoomedStageInfoPanel();
    
    // 元の視点に戻す
    this.cameras.main.pan(this.originalCameraX + this.scale.width / 2, this.originalCameraY + this.scale.height / 2, 600, 'Power2');
    this.cameras.main.zoomTo(this.originalZoom, 600);
    
    if (this.currentZoomBg) {
      this.tweens.add({
        targets: this.currentZoomBg,
        alpha: 0,
        duration: 400,
        ease: 'Power2',
        onComplete: () => {
          this.currentZoomBg.destroy();
          this.currentZoomBg = null;
        }
      });
    }
    
    this.isZoomedIn = false;
  }

  isStageCompleted(stageNum) {
    // デモ用: ランダムに一部のステージをクリア済みとする
    return Math.random() < 0.3;
  }

  getRequiredLevelForStage(stageNum) {
    // ステージに必要なレベルを逆算する
    const levelRequirements = {
      1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 5,
      7: 6, 8: 7, 9: 8, 10: 9, 11: 10, 12: 10,
      13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 15,
      19: 16, 20: 19
    };
    return levelRequirements[stageNum] || stageNum;
  }

  showLockTooltip(stageNum, x, y) {
    this.hideLockTooltip();
    
    const requiredLevel = this.getRequiredLevelForStage(stageNum);
    const stageData = this.getStageData(stageNum);
    
    // ロック用ツールチップの背景
    this.lockTooltipBg = this.add.graphics();
    this.lockTooltipBg.fillStyle(0x2c3e50, 0.95);
    this.lockTooltipBg.lineStyle(2, 0xff6b6b, 0.8);
    
    const tooltipWidth = 240;
    const tooltipHeight = 80;
    const tooltipX = Phaser.Math.Clamp(x - tooltipWidth / 2, 8, this.scale.width - tooltipWidth - 8);
    const tooltipY = y - 100;

    this.lockTooltipBg.fillRoundedRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    this.lockTooltipBg.strokeRoundedRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    
    // ロック理由テキスト
    this.lockTooltipTitle = this.add.text(tooltipX + tooltipWidth/2, tooltipY + 20, '🔒 ' + stageData.name, {
      fontSize: '14px',
      fontFamily: 'Arial Bold',
      fill: '#ff6b6b',
      stroke: '#000000',
      strokeThickness: 1
    }).setOrigin(0.5);
    
    this.lockTooltipText = this.add.text(tooltipX + tooltipWidth/2, tooltipY + 40, `レベル ${requiredLevel} が必要です`, {
      fontSize: '12px',
      fontFamily: 'Arial',
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 1
    }).setOrigin(0.5);
    
    this.lockTooltipSubText = this.add.text(tooltipX + tooltipWidth/2, tooltipY + 60, `現在: Lv.${this.playerLevel}`, {
      fontSize: '11px',
      fontFamily: 'Arial',
      fill: '#bdc3c7',
      stroke: '#000000',
      strokeThickness: 1
    }).setOrigin(0.5);
    
    // ツールチップをカメラに固定
    [this.lockTooltipBg, this.lockTooltipTitle, this.lockTooltipText, this.lockTooltipSubText].forEach(element => {
      element.setScrollFactor(0);
      element.setAlpha(0);
      this.tweens.add({
        targets: element,
        alpha: 1,
        duration: 200,
        ease: 'Power2'
      });
    });
  }

  hideLockTooltip() {
    [this.lockTooltipBg, this.lockTooltipTitle, this.lockTooltipText, this.lockTooltipSubText].forEach(element => {
      if (element) {
        element.destroy();
      }
    });
    this.lockTooltipBg = null;
    this.lockTooltipTitle = null;
    this.lockTooltipText = null;
    this.lockTooltipSubText = null;
  }

  createLockedStageEffect(container) {
    // ロック状態のクリック時エフェクト
    const shakeAnimation = this.tweens.add({
      targets: container,
      x: container.x + 5,
      duration: 100,
      yoyo: true,
      repeat: 3,
      ease: 'Power2'
    });
    
    // 警告エフェクト
    const warningFlash = this.add.graphics();
    warningFlash.fillStyle(0xff0000, 0.3);
    warningFlash.fillCircle(container.x, container.y, 50);
    
    this.tweens.add({
      targets: warningFlash,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 600,
      ease: 'Power2',
      onComplete: () => warningFlash.destroy()
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
