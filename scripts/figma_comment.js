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

async function postComment(fileKey, message, x = 0, y = 0) {
  console.log(`Posting comment to Figma file [${fileKey}]...`);
  try {
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
      method: "POST",
      headers: {
        "X-Figma-Token": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message,
        client_meta: { x: x, y: y } // コメントを置く座標
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    console.log("Comment posted successfully! Details:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to post comment:", error);
  }
}

// コマンドライン引数の処理
const args = process.argv.slice(2);
const fileKey = args[0];
const message = args[1] || "Antigravity AI からのテストコメントです！";
const x = parseFloat(args[2] || "0");
const y = parseFloat(args[3] || "0");

if (!fileKey) {
  console.error("Usage: node scripts/figma_comment.js <file_key> [message] [x] [y]");
  process.exit(1);
}

postComment(fileKey, message, x, y);
