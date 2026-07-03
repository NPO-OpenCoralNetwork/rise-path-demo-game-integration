// Miro に Mermaid 図を画像として配置するスクリプト (v2: ダウンロード→アップロード方式)
import fs from 'fs';
import { execSync } from 'child_process';

function getMiroApiKey() {
  if (process.env.MIRO_API_KEY) return process.env.MIRO_API_KEY;
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/^MIRO_API_KEY=["']?(.*?)["']?$/m);
    if (match?.[1]) return match[1].trim();
  } catch (e) {}
  return null;
}

const token = getMiroApiKey();

// Mermaid テキスト → mermaid.ink URL
function mermaidToUrl(mermaidCode) {
  const base64 = Buffer.from(mermaidCode).toString('base64');
  return `https://mermaid.ink/img/${base64}?type=png`;
}

// mermaid.ink から画像をダウンロードしてローカルに保存
async function downloadImage(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  console.log(`   Downloaded ${buffer.length} bytes → ${filepath}`);
}

// ファイルを multipart/form-data で Miro にアップロード
async function uploadImageToMiro(boardId, filepath, x, y) {
  const fileData = fs.readFileSync(filepath);

  // Node.js の fetch + FormData でマルチパートアップロード
  const boundary = '----MiroUploadBoundary' + Date.now();
  const fileName = 'mermaid_diagram.png';

  // JSON部分
  const jsonPart = JSON.stringify({
    position: { x: x, y: y },
    geometry: { width: 600 }
  });

  // マルチパートボディを手動構築
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="data"\r\n`);
  parts.push(`Content-Type: application/json\r\n\r\n`);
  parts.push(`${jsonPart}\r\n`);
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="resource"; filename="${fileName}"\r\n`);
  parts.push(`Content-Type: image/png\r\n\r\n`);

  const headerBuf = Buffer.from(parts.join(''));
  const footerBuf = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([headerBuf, fileData, footerBuf]);

  const res = await fetch(`https://api.miro.com/v2/boards/${boardId}/images`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: body
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} - ${await res.text()}`);
  }
  return await res.json();
}

async function placeMermaidOnMiro(boardId, mermaidCode, title, x, y) {
  console.log(`\n📊 Processing: "${title}"`);

  // 1. mermaid.ink で画像をレンダリング＆ダウンロード
  const url = mermaidToUrl(mermaidCode);
  const tmpFile = `/tmp/mermaid_${Date.now()}.png`;
  await downloadImage(url, tmpFile);

  // 2. タイトル付箋
  await fetch(`https://api.miro.com/v2/boards/${boardId}/sticky_notes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: { content: `<b>📊 ${title}</b>`, shape: "square" },
      position: { x: x, y: y - 250 },
      style: { fillColor: "dark_blue" }
    })
  });
  console.log("   ✅ Title sticky created");

  // 3. ダウンロードした画像をMiroにアップロード
  const result = await uploadImageToMiro(boardId, tmpFile, x, y);
  console.log(`   ✅ Diagram placed on board! ID: ${result.id}`);

  // 一時ファイルを削除
  fs.unlinkSync(tmpFile);
  return result;
}

// ===== メイン =====
async function main(boardId) {
  const gameFlowMermaid = `flowchart LR
    A["ホーム画面"] --> B["カリキュラム選択"]
    B --> C["ステージ選択"]
    C --> D["バトルステージ"]
    D --> E{"勝敗判定"}
    E -->|勝利| F["リザルト画面"]
    E -->|敗北| G["リトライ"]
    G --> D
    F --> C

    style A fill:#4CAF50,color:#fff
    style D fill:#FF5722,color:#fff
    style E fill:#FFC107,color:#000
    style F fill:#2196F3,color:#fff`;

  const assetFlowMermaid = `flowchart TD
    A["AI Image Gen"] --> B["Trim and Optimize"]
    B --> C["Overwrite Same Filename"]
    C --> D["Preview in Phaser"]
    D --> E{"OK?"}
    E -->|Yes| F["Git Commit Push"]
    E -->|No| A
    F --> G["PR Review"]

    style A fill:#9C27B0,color:#fff
    style C fill:#FF9800,color:#fff
    style F fill:#4CAF50,color:#fff`;

  console.log("🚀 Placing Mermaid diagrams on Miro board...");

  // 1つ目は既に配置済みのためスキップ
  // await placeMermaidOnMiro(boardId, gameFlowMermaid, "ゲーム画面遷移図", 300, 650);

  await placeMermaidOnMiro(boardId, assetFlowMermaid, "アセット差し替えワークフロー", -450, 650);

  console.log("\n🎉 All Mermaid diagrams placed successfully!");
}

const boardId = process.argv[2];
if (!boardId) {
  console.error("Usage: node scripts/miro_mermaid.js <board_id>");
  process.exit(1);
}
main(boardId);
