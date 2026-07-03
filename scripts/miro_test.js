// Miro API v2 テストスクリプト
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

async function postMiroStickyAndImage(boardId, keyword, prompt, imageUrl) {
  console.log(`Posting to Miro Board [${boardId}]...`);
  
  // 1. 付箋 (Sticky Note) の作成
  try {
    const stickyResponse = await fetch(`https://api.miro.com/v2/boards/${boardId}/sticky_notes`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: {
          content: `<b>【アセット名: ${keyword}】</b><br>生成プロンプト：<br><code>${prompt}</code>`,
          shape: "square"
        },
        position: { x: 0, y: 0 },
        style: { fillColor: "light_yellow" }
      })
    });
    
    if (!stickyResponse.ok) {
      throw new Error(`Sticky creation failed: ${stickyResponse.status} - ${await stickyResponse.text()}`);
    }
    const stickyData = await stickyResponse.json();
    console.log("✅ Sticky note created successfully! ID:", stickyData.id);
    
    // 2. 画像 (Image) の配置 (付箋の右横 x: 300 に配置)
    if (imageUrl) {
      const imageResponse = await fetch(`https://api.miro.com/v2/boards/${boardId}/images`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          data: {
            url: imageUrl,
            title: `${keyword}のスタイルイメージ`
          },
          position: { x: 300, y: 0 }
        })
      });
      
      if (!imageResponse.ok) {
        throw new Error(`Image placement failed: ${imageResponse.status} - ${await imageResponse.text()}`);
      }
      const imageData = await imageResponse.json();
      console.log("✅ Image placed on board successfully! ID:", imageData.id);
    }
    
  } catch (error) {
    console.error("Miro API test failed:", error);
  }
}

// コマンドライン引数
const args = process.argv.slice(2);
const boardId = args[0];
const keyword = args[1] || "スライム";
const prompt = args[2] || "pixel art sprite of a glowing blue slime, retro 16-bit RPG monster --aspect 1:1";
// サンプルとして公開画像を使用
const imageUrl = args[3] || "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=300";

if (!boardId) {
  console.error("Usage: node scripts/miro_test.js <board_id> [keyword] [prompt] [imageUrl]");
  process.exit(1);
}

postMiroStickyAndImage(boardId, keyword, prompt, imageUrl);
