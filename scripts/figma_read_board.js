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

async function readFigmaFile(fileKey) {
  console.log(`Reading Figma file [${fileKey}]...`);
  try {
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: {
        "X-Figma-Token": apiKey
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    console.log("File loaded successfully! Title:", data.name);
    
    // ボード上のノードを解析
    const elements = [];
    
    function traverse(node) {
      if (node.type === "STICKY" || node.type === "TEXT" || node.type === "RECTANGLE" || node.type === "IMAGE") {
        elements.push({
          id: node.id,
          name: node.name,
          type: node.type,
          characters: node.characters || "",
          x: node.absoluteBoundingBox ? node.absoluteBoundingBox.x : 0,
          y: node.absoluteBoundingBox ? node.absoluteBoundingBox.y : 0,
          width: node.absoluteBoundingBox ? node.absoluteBoundingBox.width : 0,
          height: node.absoluteBoundingBox ? node.absoluteBoundingBox.height : 0
        });
      }
      if (node.children) {
        node.children.forEach(traverse);
      }
    }
    
    if (data.document) {
      traverse(data.document);
    }
    
    console.log("\n--- Detected Elements on Board ---");
    console.log(JSON.stringify(elements, null, 2));
    
  } catch (error) {
    console.error("Failed to read Figma file:", error);
  }
}

const args = process.argv.slice(2);
const fileKey = args[0];

if (!fileKey) {
  console.error("Usage: node scripts/figma_read_board.js <file_key>");
  process.exit(1);
}

readFigmaFile(fileKey);
