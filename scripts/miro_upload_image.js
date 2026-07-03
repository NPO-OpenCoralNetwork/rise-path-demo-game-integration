// ローカルPNGファイルをMiroボードにアップロードするスクリプト
import fs from 'fs';

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

async function uploadImageToMiro(boardId, filepath, x, y, title) {
  const fileData = fs.readFileSync(filepath);
  const boundary = '----MiroUpload' + Date.now();
  const fileName = filepath.split('/').pop();

  const jsonPart = JSON.stringify({
    position: { x, y },
    geometry: { width: 600 }
  });

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

  // タイトル付箋を配置
  if (title) {
    await fetch(`https://api.miro.com/v2/boards/${boardId}/sticky_notes`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { content: `<b>📊 ${title}</b>`, shape: "square" },
        position: { x, y: y - 250 },
        style: { fillColor: "dark_blue" }
      })
    });
    console.log("✅ Title sticky created");
  }

  // 画像アップロード
  const res = await fetch(`https://api.miro.com/v2/boards/${boardId}/images`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status} - ${await res.text()}`);
  const result = await res.json();
  console.log(`✅ Image uploaded! ID: ${result.id}`);
  return result;
}

const [boardId, filepath, x, y, title] = process.argv.slice(2);
if (!boardId || !filepath) {
  console.error("Usage: node scripts/miro_upload_image.js <board_id> <filepath> [x] [y] [title]");
  process.exit(1);
}

uploadImageToMiro(boardId, filepath, Number(x || 0), Number(y || 0), title || "");
