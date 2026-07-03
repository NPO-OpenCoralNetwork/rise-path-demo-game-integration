export class UI {
    constructor() {
      this.logArea = null; // Phaserのテキストオブジェクト用
      this.logMessages = []; // メッセージ履歴
      this.logDelay = 1000; // メッセージ表示間の遅延（ミリ秒）
      this.lastLogTime = 0; // 最後のログ表示時刻
    }
  
    async log(message) {
      console.log("Game log:", message); // デバッグ用

      // 前回のログから指定時間経過するまで待機
      const now = Date.now();
      const timeSinceLastLog = now - this.lastLogTime;
      if (timeSinceLastLog < this.logDelay && this.lastLogTime > 0) {
        const waitTime = this.logDelay - timeSinceLastLog;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      this.lastLogTime = Date.now();

      // logAreaがPhaserのテキストオブジェクトの場合
      if (this.logArea && this.logArea.setText && this.logArea.scene) {
        // 最大3行までのメッセージを保持
        this.logMessages.push(message);
        if (this.logMessages.length > 3) {
          this.logMessages.shift(); // 古いメッセージを削除
        }
        
        // 表示用テキストを作成
        const displayText = this.logMessages.join('\n');
        
        // シーンがまだ生存しているか最終確認
        if (this.logArea.scene && this.logArea.scene.sys) {
          this.logArea.setText(displayText);
        }
      } 
      // DOMエレメントの場合（バックアップ処理）
      else if (this.logArea && this.logArea.appendChild) {
        const messageElement = document.createElement('div');
        messageElement.textContent = message;
        this.logArea.appendChild(messageElement);
        
        // スクロール到達点を下部に設定
        this.logArea.scrollTop = this.logArea.scrollHeight;
      }
      // logAreaがない場合はコンソールのみに出力
    }
  
    // ログ表示の遅延時間を設定（ミリ秒）
    setLogDelay(delayMs) {
      this.logDelay = delayMs;
    }
  
    // 遅延なしで即座にログ表示（緊急メッセージ用）
    logImmediate(message) {
      console.log("Game log (immediate):", message);

      if (this.logArea && this.logArea.setText && this.logArea.scene) {
        this.logMessages.push(message);
        if (this.logMessages.length > 3) {
          this.logMessages.shift();
        }
        const displayText = this.logMessages.join('\n');
        
        // シーンがまだ生存しているか最終確認
        if (this.logArea.scene && this.logArea.scene.sys) {
          this.logArea.setText(displayText);
        }
      } else if (this.logArea && this.logArea.appendChild) {
        const messageElement = document.createElement('div');
        messageElement.textContent = message;
        this.logArea.appendChild(messageElement);
        this.logArea.scrollTop = this.logArea.scrollHeight;
      }
    }
  
    updateHP(playerHP, enemyHP) {
      // このメソッドの実装はindexで上書きされているため、このデフォルト実装はシンプルに
      console.log(`HP更新 - プレイヤー: ${playerHP}, 敵: ${enemyHP}`);
    }
}
