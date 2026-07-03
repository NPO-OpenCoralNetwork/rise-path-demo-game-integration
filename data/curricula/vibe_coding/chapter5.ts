import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_5_DATA: DocChapter = {
  id: 'vibe-ch5',
  title: { en: 'Chapter 5 | GitHub Workflow Mastery', jp: '第5章｜GitHubワークフロー完全理解' },
  subtitle: { 
    en: 'Understanding the lifecycle of code and why Git is the ultimate safety net for AI-driven development.', 
    jp: 'コードのライフサイクルを理解し、なぜGitがAI開発において最強の安全網なのかを学ぶ。' 
  },
  readingTime: { en: '20 min read', jp: '20分で読める' },
  sections: [
    {
      id: '5-1',
      title: { en: '5-1. What is a Repository?', jp: '5-1. リポジトリとは何か' },
      content: [
        {
          type: 'text',
          text: {
            en: 'A **Repository** is like a digital warehouse for your project. But it\'s not just a folder; it\'s a warehouse with a built-in surveillance camera that records every single change.',
            jp: '**リポジトリ**は、プロジェクトのためのデジタルな「倉庫」です。単なるフォルダではなく、すべての変更を記録する監視カメラが備わった倉庫だと考えてください。'
          },
          style: 'lead'
        },
        {
          type: 'mermaid',
          chart: `graph TD
    Local[Local Repo<br>Your Computer] -- Push --> Remote[Remote Repo<br>GitHub Cloud]
    Remote -- Clone/Pull --> Others[Team Members<br>Other Devices]`,
          caption: { en: 'Local vs Remote Repositories', jp: 'ローカルリポジトリとリモートリポジトリの関係' }
        }
      ]
    },
    {
      id: '5-2',
      title: { en: '5-2. Commit / Push / Clone Meanings', jp: '5-2. commit / push / clone の意味' },
      content: [
        {
          type: 'text',
          text: {
            en: 'These three commands are the "Three Sacred Treasures" of development. Let\'s break them down.',
            jp: 'これらの3つのコマンドは、開発における「三種の神器」です。その意味を正しく理解しましょう。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Commit**: Taking a "Snapshot" of the current working state. You give it a message like "feat: added login button".', jp: '**Commit**: 現在の作業状態の「スナップショット」を撮ること。「ログインボタンを追加」といったメッセージを添えて保存します。' },
            { en: '**Push**: Sending your local commits to the GitHub cloud. This is like "Syncing" your progress.', jp: '**Push**: ローカルのスナップショットをGitHubのクラウドに送り出すこと。進捗を「同期」する行為です。' },
            { en: '**Clone**: Downloading a whole repository from GitHub to a new computer. The "Start Line" for any project.', jp: '**Clone**: GitHubにある倉庫丸ごとを、新しい自分のPCにダウンロードすること。開発の「スタートライン」です。' }
          ]
        }
      ]
    },
    {
      id: '5-3',
      title: { en: '5-3. Why Git is Essential for AI Dev', jp: '5-3. AI開発でGitが必須な理由' },
      content: [
        {
          type: 'text',
          text: {
            en: 'In traditional coding, bugs are often small. In AI-driven "Vibe Coding," AI might delete a whole file or rewrite a complex logic in a way that breaks everything.',
            jp: '従来のコーディングでは、バグは少しずつ発生します。しかし、AIによる「バイブコーディング」では、AIが一気にファイルを消したり、複雑なロジックをめちゃくちゃに書き換えてしまうことがあります。'
          }
        },
        {
          type: 'callout',
          title: { en: 'The AI Paradox', jp: 'AIのパラドックス' },
          text: {
            en: 'AI is fast, but it can be destructive. Git allows you to accept AI\'s bold suggestions because you know you can always hit the "Undo" button on a project-wide scale.',
            jp: 'AIは高速ですが、時に破壊的です。Gitがあれば、プロジェクト全体を「元に戻す」ボタンがあることがわかっているので、AIの大胆な提案を安心して受け入れることができます。'
          },
          variant: 'tip'
        }
      ]
    },
    {
      id: '5-4',
      title: { en: '5-4. The "Safety First" Workflow', jp: '5-4. 壊れても戻れる安心設計' },
      content: [
        {
          type: 'text',
          text: {
            en: 'The golden rule of Vibe Coding is: **Commit frequently.**',
            jp: 'バイブコーディングの鉄則は、**「こまめにコミットする」**ことです。'
          }
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'The Recovery Command',
          code: `# If AI breaks your code, just run this to return to the last working state:
git checkout .`
        },
        {
          type: 'text',
          text: {
            en: 'By integrating Git into your daily rhythm, you turn development from a "fear of breaking things" into an "excitement of experimenting."',
            jp: 'Gitを日常の習慣に取り入れることで、開発は「壊す恐怖」から「実験するワクワク」へと変わります。'
          }
        },
        {
          type: 'mermaid',
          chart: `mindmap
  root((Git for AI))
    Safety Net
      Instant Revert
      Version History
    Collaboration
      Team Sync
      Open Source
    Mindset
      Fearless Experiment
      Rapid Iteration`,
          caption: { en: 'Mind Map: Why we use Git', jp: 'マインドマップ：なぜGitを使うのか' }
        }
      ]
    },
    {
      id: '5-5',
      title: { en: '5-5. Practice: Git Command Cheat Sheet', jp: '5-5. 実践：Gitコマンド・チートシート' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Here are the actual commands you will use every day. Copy and paste these into your terminal.',
            jp: 'これらが、あなたが毎日使うことになる実際のコマンドです。ターミナルにコピペして使いましょう。'
          }
        },
        {
          type: 'callout',
          title: { en: 'Step 1: First Setup (One time only)', jp: 'Step 1: 最初の設定（1回だけ）' },
          text: {
            en: 'Tell Git who you are so your commits are labeled correctly.',
            jp: 'コミットの作者情報を登録します。'
          },
          variant: 'info'
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'Terminal',
          code: `git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"`
        },
        {
          type: 'callout',
          title: { en: 'Step 2: Start a Project', jp: 'Step 2: プロジェクトの開始' },
          text: {
            en: 'Turn a normal folder into a Git repository.',
            jp: '普通のフォルダをGitリポジトリに変身させます。'
          },
          variant: 'info'
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'Terminal',
          code: `cd my-project-folder
git init`
        },
        {
          type: 'callout',
          title: { en: 'Step 3: Save Changes (The Daily Loop)', jp: 'Step 3: 変更の保存（毎日のルーチン）' },
          text: {
            en: 'Do this every time you make a working change.',
            jp: 'コードが動くようになったら、すぐにこれを実行します。'
          },
          variant: 'success'
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'Terminal',
          code: `# 1. Add all changes to the "Staging Area"
git add .

# 2. Commit the changes with a message
git commit -m "feat: added login form"

# 3. (Optional) Check status
git status`
        },
        {
          type: 'callout',
          title: { en: 'Step 4: Sync to Cloud', jp: 'Step 4: クラウドへの同期' },
          text: {
            en: 'Send your commits to GitHub.',
            jp: 'コミットをGitHubに送信します。'
          },
          variant: 'warning'
        },
        {
          type: 'code',
          language: 'bash',
          filename: 'Terminal',
          code: `# 1. Link to GitHub repo (First time only)
git remote add origin https://github.com/your-id/your-repo.git

# 2. Push code
git push -u origin main`
        }
      ]
    }
  ]
};
