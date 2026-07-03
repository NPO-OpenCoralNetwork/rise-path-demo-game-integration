import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_6_DATA: DocChapter = {
  id: 'vibe-ch6',
  title: { en: 'Chapter 6 | Vibe Coding with Gemini CLI', jp: '第6章｜Gemini CLIによるバイブコーディング' },
  subtitle: { 
    en: 'Moving beyond chat. Implementing logic directly into your codebase with natural language.', 
    jp: 'チャット画面を飛び出し、自然言語でコードベースに直接ロジックを実装する。' 
  },
  readingTime: { en: '30 min read', jp: '30分で読める' },
  sections: [
    {
      id: '6-1',
      title: { en: '6-1. Why CLI? No More Copy-Paste', jp: '6-1. なぜCLIなのか？コピペ地獄からの解放' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Until now, you had to copy code from the browser and paste it into VSCode. With **Gemini CLI**, the AI lives *inside* your terminal. It reads your files and edits them directly.',
            jp: 'これまでは、ブラウザで生成されたコードをコピーし、VSCodeにペーストしていました。**Gemini CLI** を使えば、AIがあなたのターミナルの中に住み着きます。AIはあなたのファイルを読み、直接編集してくれます。'
          },
          style: 'lead'
        },
        {
          type: 'mermaid',
          chart: `graph LR
    Human[You] -- "Fix the bug" --> CLI[Gemini CLI]
    CLI -- Read --> File[Source Code]
    CLI -- Edit --> File
    File -- Run --> App[Application]`,
          caption: { en: 'Direct Manipulation Workflow', jp: '直接操作のワークフロー' }
        }
      ]
    },
    {
      id: '6-2',
      title: { en: '6-2. Installation & Setup', jp: '6-2. 導入とセットアップ' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Setting up is simple. You just need an API Key and a terminal.',
            jp: 'セットアップは簡単です。必要なのはAPIキーとターミナルだけです。'
          }
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'Terminal',
          code: `# 1. Install the tool (Example command)
npm install -g @google/gemini-cli

# 2. Set your API Key
export GEMINI_API_KEY="AIzaSy..."

# 3. Start coding!
gemini "Create a simple Express server"`
        },
        {
          type: 'callout',
          title: { en: 'Security Note', jp: 'セキュリティの注意点' },
          text: {
            en: 'Never commit your API Key to GitHub. Always use environment variables (.env) or export it in your shell session.',
            jp: 'APIキーは絶対にGitHubにコミットしないでください。必ず環境変数（.env）を使用するか、シェルセッションでexportしてください。'
          },
          variant: 'warning'
        }
      ]
    },
    {
      id: '6-3',
      title: { en: '6-3. Coding with Natural Language', jp: '6-3. 自然言語でコードを実装する' },
      content: [
        {
          type: 'text',
          text: {
            en: 'You don\'t write code; you write \'intent\'. The CLI handles the syntax.',
            jp: 'あなたはコードを書くのではなく、「意図」を書きます。構文はCLIが処理します。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Refactoring**: \'Refactor user.ts to use async/await\'', jp: '**リファクタリング**: \'user.ts を async/await を使うように書き換えて\'' },
            { en: '**Bug Fix**: \'I get a TypeError on line 50. Fix it.\'', jp: '**バグ修正**: \'50行目でTypeErrorが出るんだけど、直して\'' },
            { en: '**Feature Add**: \'Add a dark mode toggle to the header\'', jp: '**機能追加**: \'ヘッダーにダークモード切り替えボタンを追加して\'' }
          ]
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'Example Session',
          code: `$ gemini "Add a validation check for email format in signup.ts"
> Reading signup.ts...
> Analyzing context...
> Applied changes to signup.ts
> Done.`
        }
      ]
    },
    {
      id: '6-4',
      title: { en: '6-4. Connecting Frontend and Backend', jp: '6-4. フロントとバックを接続する' },
      content: [
        {
          type: 'text',
          text: {
            en: 'The real power of CLI shines when editing multiple files. You can ask it to connect your new React form to your Node.js API.',
            jp: 'CLIの真価は、複数ファイルの編集で発揮されます。新しいReactフォームを作成し、それをNode.jsのAPIに接続するといった作業を一括で依頼できます。'
          }
        },
        {
          type: 'mermaid',
          chart: `sequenceDiagram
    participant User
    participant CLI
    participant React
    participant Node
    User->>CLI: "Connect Login Form to /api/login"
    CLI->>React: Update handleSubmit()
    CLI->>Node: Update app.post('/login')
    CLI-->>User: "Connected!"`,
          caption: { en: 'Multi-file Editing', jp: '複数ファイルの一括編集' }
        },
        {
          type: 'callout',
          title: { en: 'Vibe Check', jp: 'バイブチェック' },
          text: {
            en: 'Always verify the changes with `git diff` before committing. AI is powerful but not perfect.',
            jp: 'コミットする前に、必ず `git diff` で変更内容を確認してください。AIは強力ですが、完璧ではありません。'
          },
          variant: 'tip'
        }
      ]
    }
  ]
};
