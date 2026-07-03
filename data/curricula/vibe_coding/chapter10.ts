import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_10_DATA: DocChapter = {
  id: 'vibe-ch10',
  title: { en: 'Chapter 10 | Advanced Application: From Static to Dynamic', jp: '第10章｜応用：ゲーム・サービス開発へ' },
  subtitle: { 
    en: 'Moving beyond simple websites. Building interactive games and real-time services with AI.', 
    jp: '静的なWebサイトを超えて。AIと共に、インタラクティブなゲームやリアルタイムサービスを構築する。' 
  },
  readingTime: { en: '30 min read', jp: '30分で読める' },
  sections: [
    {
      id: '10-1',
      title: { en: '10-1. Game Development Flow', jp: '10-1. ゲーム開発に応用する流れ' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Game development is the ultimate test of "State Management." Unlike websites, games have a "Game Loop" that runs 60 times a second.',
            jp: 'ゲーム開発は「状態管理」の究極のテストです。Webサイトと違い、ゲームには1秒間に60回実行される「ゲームループ」が存在します。'
          },
          style: 'lead'
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'Game Prompt Example',
          code: `Create a simple "Clicker Game" using React + Tailwind.

Requirements:
- A big button in the center.
- A score counter that increases when clicked.
- "Upgrades" shop that appears when score reaches 100.
- An upgrade automatically adds +1 score every second (useEffect).
- Use framer-motion for satisfying click animations.`
        },
        {
          type: 'callout',
          title: { en: 'Start Small', jp: '小さく始める' },
          text: {
            en: 'Do not ask for "MMORPG". Ask for "A button that increases a number". AI excels at small, logical steps.',
            jp: 'いきなり「MMORPG」を頼まないでください。「数字が増えるボタン」から始めてください。AIは小さな論理的ステップの積み重ねが得意です。'
          },
          variant: 'tip'
        }
      ]
    },
    {
      id: '10-2',
      title: { en: '10-2. Thinking in Real-time', jp: '10-2. リアルタイム処理の考え方' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Static apps wait for a refresh. Real-time apps update instantly. Supabase makes this easy.',
            jp: '静的なアプリは更新（リロード）を待ちますが、リアルタイムアプリは即座に反応します。Supabaseを使えば、これが驚くほど簡単に実装できます。'
          }
        },
        {
          type: 'mermaid',
          chart: `sequenceDiagram
    participant User A
    participant Supabase
    participant User B
    User A->>Supabase: Send Message "Hello"
    Supabase-->>User A: Broadcast "Hello"
    Supabase-->>User B: Broadcast "Hello"
    Note over User B: UI updates instantly without reload`,
          caption: { en: 'Real-time Broadcast Flow', jp: 'リアルタイム・ブロードキャストの流れ' }
        },
        {
          type: 'text',
          text: {
            en: 'You can ask AI: "Use Supabase Realtime to subscribe to the \'messages\' table and update the chat list when a new row is inserted."',
            jp: 'AIへの指示：「Supabase Realtimeを使って \'messages\' テーブルを購読し、新しい行が追加されたらチャットリストを更新して」'
          }
        }
      ]
    },
    {
      id: '10-3',
      title: { en: '10-3. Polishing UI/UX with AI', jp: '10-3. UI/UXをAIと磨く' },
      content: [
        {
          type: 'text',
          text: {
            en: 'A working app is not enough. It needs "Juice" (satisfaction). AI is great at adding animations and micro-interactions.',
            jp: '動くだけでは不十分です。アプリには「手触り（Juice）」が必要です。AIはアニメーションやマイクロインタラクションを追加するのが得意です。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Motion**: "Add a bounce effect when the button is clicked using Framer Motion."', jp: '**動き**: 「Framer Motionを使って、ボタンクリック時にバウンドするエフェクトを追加して」' },
            { en: '**Loading**: "Replace the text \'Loading...\' with a spinning skeleton loader."', jp: '**待機**: 「\'Loading...\'という文字を、光るスケルトンローダーに置き換えて」' },
            { en: '**Toast**: "Show a success toast notification at the top right when saved."', jp: '**通知**: 「保存完了時、右上に成功トースト通知を出して」' }
          ]
        }
      ]
    },
    {
      id: '10-4',
      title: { en: '10-4. Strategy: "Ship It"', jp: '10-4. 小さく作って公開する戦略' },
      content: [
        {
          type: 'text',
          text: {
            en: 'The goal of Vibe Coding is not to write code, but to **deliver value**. Don\'t polish forever. Ship the "Beta".',
            jp: 'バイブコーディングのゴールは、コードを書くことではなく、**価値を届けること**です。永遠に磨き続けてはいけません。「ベータ版」として世に出しましょう。'
          }
        },
        {
          type: 'mermaid',
          chart: `graph LR
    Idea[Idea] --> AI[Vibe Coding]
    AI --> Deploy[Vercel/Supabase]
    Deploy --> Feedback[User Feedback]
    Feedback --> Iterate[Refine with AI]
    Iterate --> Deploy`,
          caption: { en: 'The Vibe Cycle', jp: 'バイブ・サイクル' }
        },
        {
          type: 'callout',
          title: { en: 'Your Portfolio', jp: 'あなたのポートフォリオ' },
          text: {
            en: 'A deployed app, even a simple one, is worth 100 unfinished projects. Share the URL on X (Twitter). Let the world see your Vibe.',
            jp: 'デプロイされたアプリは、たとえ単純なものであっても、100個の「未完成プロジェクト」より価値があります。URLをSNSでシェアしましょう。あなたの「バイブ」を世界に見せるのです。'
          },
          variant: 'success'
        }
      ]
    }
  ]
};
