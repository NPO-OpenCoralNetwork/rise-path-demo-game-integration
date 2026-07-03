import fs from 'fs';

function getFigmaApiKey() {
  if (process.env.FIGMA_API_KEY) return process.env.FIGMA_API_KEY;
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/^FIGMA_API_KEY=["']?(.*?)["']?$/m);
    if (match?.[1]) return match[1].trim();
  } catch (e) {}
  return "YOUR_FIGMA_API_KEY";
}

const apiKey = getFigmaApiKey();

// 各アセットタイプに対応するプロンプト提案辞書
const promptLibrary = {
  "スライム": "pixel art sprite of a glowing blue slime, vibrant gelatinous body, 16-bit classic RPG monster, transparent background --aspect 1:1",
  "ゴブリン": "pixel art sprite of a green forest goblin holding a rusty sword, 16-bit retro RPG monster, transparent background --aspect 1:1",
  "背景": "hand-drawn cozy tavern interior background, magical lanterns glowing, 2D sidescroller background scene, whimsical RPG style, clean lineart --aspect 16:9",
  "ボス": "pixel art sprite of a massive dark red fire dragon, spreading wings, epic boss monster, 16-bit style, transparent background --aspect 1:1",
  "回復": "flat vector icon of a magical healing potion bottle, glowing green liquid, clean outline, mobile game UI element --aspect 1:1"
};

async function figmaAiAssistant(fileKey) {
  console.log(`Analyzing Figma board [${fileKey}] for AI suggestions...`);
  try {
    // 1. ボード情報を取得
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: { "X-Figma-Token": apiKey }
    });
    if (!response.ok) {
      throw new Error(`Figma API Error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    
    // 2. ノードのトラバース
    const targets = [];
    function traverse(node) {
      if (node.type === "STICKY" || node.type === "TEXT" || node.type === "SHAPE_WITH_TEXT") {
        const text = (node.characters || node.name || "").trim();
        // ターゲットキーワードが含まれているかチェック
        for (const keyword of Object.keys(promptLibrary)) {
          if (text.includes(keyword)) {
            targets.push({
              id: node.id,
              text: text,
              keyword: keyword,
              x: node.absoluteBoundingBox ? node.absoluteBoundingBox.x : 0,
              y: node.absoluteBoundingBox ? node.absoluteBoundingBox.y : 0,
              width: node.absoluteBoundingBox ? node.absoluteBoundingBox.width : 0
            });
            break;
          }
        }
      }
      if (node.children) {
        node.children.forEach(traverse);
      }
    }
    
    if (data.document) {
      traverse(data.document);
    }
    
    if (targets.length === 0) {
      console.log("No matching keywords (スライム, ゴブリン, 背景, ボス, 回復) found on the board.");
      console.log("Please place a Sticky Note or Text containing one of these keywords!");
      return;
    }
    
    console.log(`Found ${targets.length} targets. Generating suggestions...`);
    
    // 3. ターゲットのすぐ横にコメントを投稿
    for (const target of targets) {
      const suggestionPrompt = promptLibrary[target.keyword];
      const commentMessage = `【AIプロンプト提案 (NanoBanana Pro 2用)】\n「${target.keyword}」の画像生成用プロンプト案です：\n\n\`${suggestionPrompt}\`\n\n※このコメントはAIによって自動配置されました。`;
      
      // オブジェクトの右側に配置 (x + width + 50)
      const commentX = target.x + target.width + 50;
      const commentY = target.y;
      
      console.log(`Posting suggestion for "${target.text}" at coordinate (${commentX}, ${commentY})...`);
      
      const commentRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
        method: "POST",
        headers: {
          "X-Figma-Token": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: commentMessage,
          client_meta: { x: commentX, y: commentY }
        })
      });
      
      if (commentRes.ok) {
        console.log(`✅ Suggestion posted for "${target.keyword}"!`);
      } else {
        console.error(`Failed to post suggestion for "${target.keyword}":`, await commentRes.text());
      }
    }
    
  } catch (error) {
    console.error("AI Assistant execution failed:", error);
  }
}

const args = process.argv.slice(2);
const fileKey = args[0];

if (!fileKey) {
  console.error("Usage: node scripts/figma_ai_assistant.js <file_key>");
  process.exit(1);
}

figmaAiAssistant(fileKey);
