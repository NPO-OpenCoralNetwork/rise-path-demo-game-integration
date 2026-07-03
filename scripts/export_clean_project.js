// OSSパブリック公開用 クリーンプロジェクトエクスポートスクリプト
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SOURCE_DIR = process.cwd();
const TARGET_DIR = '/tmp/clean-rise-path-project';

// コピーから除外するブラックリスト（フォルダ名またはファイル名）
const IGNORE_LIST = [
  '.git',
  '.vercel',
  'node_modules',
  '.env.local',
  '.env',
  '.env.bak',
  '.env.local.bak',
  'env.local.template', // 実物は残し、templateは任意で除外可能だが、ここでは.env.exampleを標準とする
  'scripts/verify_gemini_keys.js', // 一時検証用
  'test_api_v2_direct.js',
  'test_final_e2e.js',
  'test_ui_endpoints.js',
  'debug_column_data.js',
  'debug_curriculum.js',
  'debug_inspect_course.js',
  'debug_list.js',
  '.DS_Store'
];

// ディレクトリを再帰的にコピーする関数（ブラックリスト除外対応）
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  // ブラックリスト判定
  const relativePath = path.relative(SOURCE_DIR, src);
  if (IGNORE_LIST.some(ignore => relativePath === ignore || relativePath.startsWith(ignore + '/'))) {
    // console.log(`[IGNORE] Skip: ${relativePath}`);
    return;
  }

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

async function run() {
  console.log(`🧹 OSS公開用にクリーンアップを開始します...`);
  console.log(`   元リポジトリ: ${SOURCE_DIR}`);
  console.log(`   出力先ディレクトリ: ${TARGET_DIR}`);

  // 1. 出力先がすでにあれば一旦削除してクリーンにする
  if (fs.existsSync(TARGET_DIR)) {
    console.log("   既存の出力先ディレクトリをクリーンアップ中...");
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  // 2. クリーンコピーの実行
  console.log("   ファイルのコピーを実行中...");
  copyRecursiveSync(SOURCE_DIR, TARGET_DIR);

  // 3. コピーされたアセット内のハードコード対策（RAGデータなどのチェック）
  // (今回は事前にコード内のキーは除去したため、そのままクリーンな状態をコピー)
  
  // 4. 出力先で Git を初期化
  console.log("   出力先で Git リポジトリを新規初期化中...");
  try {
    execSync('git init', { cwd: TARGET_DIR });
    
    // 基本の.gitignoreを作成（もし既存のものがなければ）
    const gitignorePath = path.join(TARGET_DIR, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, `node_modules/\n.env.local\n.env\ndist/\n.vercel/\n.DS_Store\n`);
    }

    // 初回コミットの作成
    execSync('git add .', { cwd: TARGET_DIR });
    execSync('git commit -m "Initial commit (Apache 2.0 Open Source Release)"', { cwd: TARGET_DIR });
    
    console.log(`\n🎉 エクスポートが完了しました！`);
    console.log(`--------------------------------------------------`);
    console.log(`✨ クリーンな公開用リポジトリが以下に作成されました：`);
    console.log(`📂 Path: [${TARGET_DIR}]`);
    console.log(`--------------------------------------------------`);
    console.log(`【公開手順】`);
    console.log(`1. ターミナルで対象ディレクトリに移動:`);
    console.log(`   cd ${TARGET_DIR}`);
    console.log(`2. GitHubで新しいパブリックリポジトリ（空）を作成。`);
    console.log(`3. リモートを追加してプッシュ:`);
    console.log(`   git remote add origin <GitHubのパブリックURL>`);
    console.log(`   git branch -M main`);
    console.log(`   git push -u origin main`);
    console.log(`--------------------------------------------------`);

  } catch (error) {
    console.error("💥 Git初期化プロセス中にエラーが発生しました:", error.message);
  }
}

run();
