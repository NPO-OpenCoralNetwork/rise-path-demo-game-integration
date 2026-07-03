// Miro API v2 フローチャート自動生成スクリプト
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

async function createShape(boardId, content, shapeType, x, y) {
  const response = await fetch(`https://api.miro.com/v2/boards/${boardId}/shapes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        content: content,
        shape: shapeType
      },
      position: { x: x, y: y },
      geometry: { width: 180, height: 80 }
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create shape: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

async function createConnector(boardId, startId, endId, text = "") {
  const body = {
    startItem: { id: startId },
    endItem: { id: endId },
    shape: "elbowed",
    style: {
      strokeColor: "#1a1a1a",
      strokeWidth: 3
    }
  };
  
  if (text) {
    body.captions = [{
      content: text,
      position: "50%" // 線の中心にテキストを表示
    }];
  }

  const response = await fetch(`https://api.miro.com/v2/boards/${boardId}/connectors`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Failed to create connector: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

async function generateGameFlow(boardId) {
  console.log(`Generating game logic flowchart on Miro Board [${boardId}]...`);
  try {
    // 1. ノード(図形)の作成 (戦闘のゲームロジックの流れ)
    const node1 = await createShape(boardId, "⚔️ 戦闘開始", "rectangle", 0, 300);
    console.log("✅ Created Node 1 (Start):", node1.id);
    
    const node2 = await createShape(boardId, "🤖 ブロックプログラムの評価<br>(engine.js)", "rectangle", 300, 300);
    console.log("✅ Created Node 2 (Engine):", node2.id);
    
    const node3 = await createShape(boardId, "🏆 勝敗判定", "circle", 600, 300);
    console.log("✅ Created Node 3 (Judgment):", node3.id);

    // 2. 矢印(コネクタ)でノードを接続
    await createConnector(boardId, node1.id, node2.id, "ASTへパース");
    console.log("✅ Created Connector 1");
    
    await createConnector(boardId, node2.id, node3.id, "ターン終了時");
    console.log("✅ Created Connector 2");
    
    console.log("\n🚀 Flowchart generated successfully! Check your Miro board.");
    
  } catch (error) {
    console.error("Failed to generate flowchart:", error);
  }
}

const args = process.argv.slice(2);
const boardId = args[0];

if (!boardId) {
  console.error("Usage: node scripts/miro_flowchart.js <board_id>");
  process.exit(1);
}

generateGameFlow(boardId);
