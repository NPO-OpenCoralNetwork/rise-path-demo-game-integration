// Miro MCP Server 安全起動用ラッパースクリプト
import { spawn } from 'child_process';
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
  return null;
}

const key = getMiroApiKey();
if (!key) {
  console.error("Error: MIRO_API_KEY not found in env or .env.local");
  process.exit(1);
}

// @k-jarzyna/mcp-miro が要求する環境変数名に設定
process.env.MIRO_ACCESS_TOKEN = key;

console.error("Starting Miro MCP server process via npx...");

// 子プロセスとして mcp-miro を起動し、標準入出力を接続する
const child = spawn('npx', ['-y', '@k-jarzyna/mcp-miro'], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'] // stderrはエラー出力用、stdin/stdoutは通信用
});

// 親プロセスの標準入力を子プロセスにパイプ
process.stdin.pipe(child.stdin);
// 子プロセスの標準出力を親プロセスにパイプ
child.stdout.pipe(process.stdout);

child.on('exit', (code) => {
  console.error(`Miro MCP server exited with code ${code}`);
  process.exit(code);
});
