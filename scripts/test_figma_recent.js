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

async function getRecentFiles() {
  console.log("Fetching recent Figma files...");
  try {
    const response = await fetch("https://api.figma.com/v1/files/recent", {
      headers: {
        "X-Figma-Token": apiKey
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    console.log("Recent Files:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to fetch recent files:", error);
  }
}

getRecentFiles();
