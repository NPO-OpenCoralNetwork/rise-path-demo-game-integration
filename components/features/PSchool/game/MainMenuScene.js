import Phaser from 'phaser';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create() {
    // ブロックエディタを非表示に
    this.hideBlockEditor();
    
    // 直接ホーム画面に遷移
    console.log('MainMenuScene: Redirecting to HomeScene');
    this.scene.start('HomeScene');
  }

  hideBlockEditor() {
    // ブロックエディタを非表示にする処理
    const blocklyDiv = document.getElementById('blocklyDiv');
    if (blocklyDiv) {
      blocklyDiv.style.display = 'none';
    }
    
    // 実行ボタンを非表示にする
    const runButton = document.getElementById('runButton');
    if (runButton) {
      runButton.style.display = 'none';
    }
    
    const gameCanvas = document.getElementById('gameCanvas');
    if (gameCanvas) {
      gameCanvas.style.display = 'block';
    }
  }
}