// Miroボード ダッシュボード自動構築スクリプト
import fs from 'fs';

function getMiroApiKey() {
  if (process.env.MIRO_API_KEY) return process.env.MIRO_API_KEY;
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/^MIRO_API_KEY=["']?(.*?)["']?$/m);
    if (match?.[1]) return match[1].trim();
  } catch (e) {
    // Ignore
  }
  return "YOUR_MIRO_API_KEY";
}

const token = getMiroApiKey();

// API ヘルパー関数群
async function createSticky(boardId, content, x, y, color = "light_yellow") {
  const response = await fetch(`https://api.miro.com/v2/boards/${boardId}/sticky_notes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: { content: content, shape: "square" },
      position: { x: x, y: y },
      style: { fillColor: color }
    })
  });
  if (!response.ok) throw new Error(`Sticky failed: ${await response.text()}`);
  return await response.json();
}

async function createShape(boardId, content, shapeType, x, y, w = 180, h = 80) {
  const response = await fetch(`https://api.miro.com/v2/boards/${boardId}/shapes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: { content: content, shape: shapeType },
      position: { x: x, y: y },
      geometry: { width: w, height: h }
    })
  });
  if (!response.ok) throw new Error(`Shape failed: ${await response.text()}`);
  return await response.json();
}

async function createText(boardId, content, x, y, w = 300) {
  const response = await fetch(`https://api.miro.com/v2/boards/${boardId}/texts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: { content: content },
      position: { x: x, y: y },
      geometry: { width: w }
    })
  });
  if (!response.ok) throw new Error(`Text failed: ${await response.text()}`);
  return await response.json();
}

async function createConnector(boardId, startId, endId, text = "") {
  const body = {
    startItem: { id: startId },
    endItem: { id: endId },
    shape: "elbowed"
  };
  if (text) {
    body.captions = [{ content: text, position: "50%" }];
  }
  const response = await fetch(`https://api.miro.com/v2/boards/${boardId}/connectors`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Connector failed: ${await response.text()}`);
  return await response.json();
}

// メイン構築処理
async function buildDashboard(boardId) {
  console.log(`🚀 Starting to build the Agile Dashboard on Miro Board [${boardId}]...`);
  try {
    // --- 1. タイトル看板の作成 ---
    await createShape(boardId, "<h1>🎨 P-School アセットブラッシュアップハブ</h1>", "rectangle", 0, -500, 800, 100);
    console.log("✅ Created Title Banner");

    // --- 2. エリア①：チーム開発＆アセット適用ルール ---
    console.log("Building Area 1: Rules & Guides...");
    await createShape(boardId, "<h3>① チーム開発＆アセットルール</h3>", "rectangle", -450, -350, 350, 50);
    
    await createSticky(boardId, "<b>🚨 アセット上書きの絶対ルール</b><br><br>新しい画像は既存のファイルと<b>「全く同じファイル名・同じ拡張子（小文字）」</b>で上書き配置すること！コード変更が不要になります。", -550, -200, "light_pink");
    await createSticky(boardId, "<b>🏷️ Gitコミット・ブランチルール</b><br><br>アセット追加時は <code>asset: ○○画像の差し替え</code> とプレフィックスをつける。<br>作業前は最新のmainからブランチを切る。", -350, -200, "light_green");
    await createSticky(boardId, "<b>📄 詳細ガイド（GitHub）</b><br><br><a href='file:///Users/2005nk/Works/personal/rise-path-demo-game-integration/doc/README.md'>doc/README.md</a><br>詳細はリポジトリ内の設計書を参照してください。", -450, -20, "light_blue");

    // --- 3. エリア②：アセット進行管理カンバン ---
    console.log("Building Area 2: Kanban Board...");
    await createShape(boardId, "<h3>② アセット進行管理カンバン</h3>", "rectangle", 300, -350, 600, 50);
    
    // カンバン列ラベル
    const labelTodo = await createShape(boardId, "<b>💤 未着手 (旧画像使用中)</b>", "rectangle", 100, -250, 180, 50);
    const labelProgress = await createShape(boardId, "<b>🚧 制作中</b>", "rectangle", 300, -250, 180, 50);
    const labelDone = await createShape(boardId, "<b>✅ 適用・検証完了</b>", "rectangle", 500, -250, 180, 50);
    
    // サンプルタスクカード
    await createSticky(boardId, "<b>アセット: スライム</b><br>ステータス: 未着手<br>備考: 既存 /srime.png のブラッシュアップが必要", 100, -120, "gray");
    await createSticky(boardId, "<b>アセット: プレイヤー</b><br>ステータス: ラフ制作中<br>担当: 山田", 300, -120, "orange");
    await createSticky(boardId, "<b>アセット: 森の精霊</b><br>ステータス: 適用完了<br>備考: /serirei01.png に上書き完了！", 500, -120, "blue");

    // --- 4. エリア③：AI生成スタイル＆プロンプト実例集 ---
    console.log("Building Area 3: AI Prompt Library...");
    await createShape(boardId, "<h3>③ AI生成スタイル＆プロンプト実例集 (NanoBanana Pro 2)</h3>", "rectangle", -450, 180, 350, 50);
    
    await createText(boardId, "<b>👾 ドット絵 (Pixel Art)</b><br><code>pixel art sprite of a [キャラ名], vibrant colors, retro 16-bit RPG, transparent background --aspect 1:1</code>", -450, 260, 350);
    await createText(boardId, "<b>🎨 手描きイラスト風 (Hand-drawn)</b><br><code>hand-drawn illustration of a [キャラ名], whimsical fantasy style, soft coloring, clean background --aspect 1:1</code>", -450, 360, 350);

    // --- 5. エリア④：ゲーム画面遷移＆アセットロード図 ---
    console.log("Building Area 4: Game Flowchart...");
    await createShape(boardId, "<h3>④ ゲーム画面遷移＆アセットロード図</h3>", "rectangle", 300, 180, 600, 50);
    
    const flowHome = await createShape(boardId, "🏠 ホーム画面<br>(tokinootozure.mp3)", "rectangle", 100, 320, 150, 80);
    const flowSelect = await createShape(boardId, "🗺️ ステージ選択<br>(map3.jpeg)", "rectangle", 300, 320, 150, 80);
    const flowBattle = await createShape(boardId, "⚔️ バトルステージ<br>(battle_bgm_01.mp3)", "circle", 500, 320, 120, 120);

    await createConnector(boardId, flowHome.id, flowSelect.id, "ステージ選択へ");
    await createConnector(boardId, flowSelect.id, flowBattle.id, "バトル開始");

    console.log("\n🎉 Agile Dashboard has been successfully built on your Miro board!");
    
  } catch (error) {
    console.error("Dashboard creation failed:", error);
  }
}

const args = process.argv.slice(2);
const boardId = args[0];

if (!boardId) {
  console.error("Usage: node scripts/miro_dashboard_setup.js <board_id>");
  process.exit(1);
}

buildDashboard(boardId);
