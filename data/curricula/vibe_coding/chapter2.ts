import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_2_DATA: DocChapter = {
  id: 'vibe-ch2',
  title: { en: 'Chapter 2 | Planning with AI', jp: '第2章｜AIと企画する力を身につける' },
  subtitle: { 
    en: 'Translating "vague ideas" into "blueprints" that AI can understand.', 
    jp: '「ふんわりしたアイデア」を、エンジニアリング可能な「設計図」に翻訳する技術' 
  },
  readingTime: { en: '30 min read', jp: '30分で読める' },
  sections: [
    {
      id: '2-1',
      title: { en: '2-1. AI Sparring for Design', jp: '2-1. ChatGPTとの壁打ち設計術' },
      content: [
        {
          type: 'text',
          text: {
            en: 'In programming, AI is not just a "code generator." It is a "Senior Engineer and Product Manager" you can consult about "what to build."',
            jp: 'プログラミングにおけるAIは「単なるコード生成機」ではありません。もっと上流の、「何を作るか」を相談できる**「シニアエンジニア兼プロダクトマネージャー」**です。'
          },
          style: 'lead'
        },
        {
          type: 'text',
          text: {
            en: 'Asking AI to "write code" immediately is like asking an architect to "just lay bricks." First, discuss what kind of house you want to build. This is called "Sparring" or "Wall-boarding."',
            jp: 'いきなり「コード書いて」と言うのは、建築家に「とりあえずレンガ積んで」と言うようなものです。まずは「どんな家を建てたいか」を相談しましょう。これを「壁打ち」と呼びます。'
          }
        },
        {
          type: 'callout',
          title: { en: 'Step 1: Assign a Role', jp: 'Step 1: 役割を与える (Role Prompting)' },
          text: {
            en: 'Put the right hat on the AI. By giving roles like "Expert PM" or "Veteran Engineer," the quality and perspective of the answers change.',
            jp: 'AIに適切な帽子を被せます。「優秀なPM」「ベテランエンジニア」などの役割を与えることで、回答の質と視座が変わります。'
          },
          variant: 'info'
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'Sparring Prompt Example',
          code: `You are a veteran Product Manager and Full-stack Engineer.
I want to build a "Task Management App for solo developers."
My ideas are still vague, so please be my sparring partner.
First, ask me questions to clarify the target users and the problems they face.`
        },
        {
          type: 'text',
          text: {
            en: 'The trick is to ask the AI to "ask questions." Instead of letting the AI give the answers, let it pull them out of you to organize your own thoughts.',
            jp: 'このように、「質問してください」と頼むのがコツです。AIに答えを出させるのではなく、AIに引き出してもらうことで、自分の思考が整理されます。'
          }
        }
      ]
    },
    {
      id: '2-2',
      title: { en: '2-2. Structuring "What You Want"', jp: '2-2. 「作りたい」を構造化する（要件定義）' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Once your idea solidifies, translate it into a "system-implementable" form. The key here is "Inventory of Features" and "Prioritization."',
            jp: '壁打ちでアイデアが固まってきたら、それを「システムとして実装可能な形」に翻訳します。ここで重要なのは**「機能の棚卸し」**と**「優先順位付け」**です。'
          }
        },
        {
          type: 'callout',
          title: { en: 'Deliverables to Ask From AI', jp: 'AIに出力させるべき成果物' },
          text: {
            en: '1. Feature List (Categorized as Must/Should/Want)\n2. User Flow (Screen transitions)\n3. Data Model (Definition of information handled)',
            jp: '1. 機能一覧（Must/Should/Wantに分類）\n2. ユーザーフロー（画面遷移の流れ）\n3. データモデル（扱う情報の定義）'
          },
          variant: 'tip'
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'PRD Generation Prompt',
          code: `Summarize our discussion and create a draft "Product Requirements Document (PRD)" including:

## 1. App Overview
## 2. Target Users & Problems
## 3. Core Features (Select 3 essential for MVP)
## 4. Screen Transitions (Mermaid syntax)
## 5. Data Model (Mermaid syntax: ER Diagram)

Assume the tech stack is React, TypeScript, Tailwind CSS, and Supabase.`
        },
        {
          type: 'mermaid',
          chart: `flowchart TD
    Start(App Launch) --> Login{Logged in?}
    Login --No--> Auth[Auth Screen]
    Login --Yes--> Dashboard[Dashboard]
    Auth --> Dashboard
    Dashboard --> TaskList[Task List]
    Dashboard --> AddTask[Add Task]
    AddTask --> Save{Save}
    Save --> TaskList`,
          caption: { en: 'Example Screen Transition Flow', jp: 'AIが生成する画面遷移フローの例' }
        }
      ]
    },
    {
      id: '2-3',
      title: { en: '2-3. The "Vibe" of Data Modeling', jp: '2-3. データモデリングの「バイブ」' },
      content: [
        {
          type: 'text',
          text: {
            en: 'The most important part of app development is "Data Design." As long as this is correct, the UI can be fixed later. Tell the AI about "Relationships" in plain words.',
            jp: 'アプリ開発で最も重要なのが「データ設計」です。ここさえ間違っていなければ、UIは後からいくらでも修正できます。AIには「リレーション（関係性）」を言葉で伝えます。'
          }
        },
        {
          type: 'list',
          style: 'check',
          items: [
            { en: '**1-to-Many (1:N)**: "One user has multiple tasks"', jp: '**1対多 (1:N)**: 「1人のユーザーは、複数のタスクを持つ」' },
            { en: '**Many-to-Many (N:M)**: "Tasks have multiple tags, and tags are used by multiple tasks"', jp: '**多対多 (N:M)**: 「タスクは複数のタグを持ち、タグも複数のタスクに使われる」' },
            { en: '**1-to-1 (1:1)**: "A user has one profile setting"', jp: '**1対1 (1:1)**: 「ユーザーは1つのプロフィール設定を持つ」' }
          ]
        },
        {
          type: 'mermaid',
          chart: `erDiagram
    USER ||--o{ TASK : "has"
    USER ||--o{ TAG : "creates"
    TASK }|--|{ TAG : "labeled_with"
    
    USER {
        uuid id PK
        string email
        string username
    }
    TASK {
        uuid id PK
        uuid user_id FK
        string title
        boolean is_completed
    }
    TAG {
        uuid id PK
        string name
        string color
    }`,
          caption: { en: 'ER Diagram showing relationships', jp: 'ユーザー、タスク、タグの関係を示すER図' }
        }
      ]
    },
    {
      id: '2-4',
      title: { en: '2-4. Design Vocabulary for UI/UX', jp: '2-4. UI/UXを言語化するデザイン・ボキャブラリー' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Avoid saying "make it look good." You need to communicate the "Design System" or "Vibe" using specific vocabulary.',
            jp: '「いい感じのデザインにして」は禁句です。AIには**「デザインシステム」**や**「雰囲気」**を具体的な言葉（ボキャブラリー）で伝える必要があります。'
          }
        },
        {
          type: 'table',
          headers: [
            { en: 'Keyword', jp: 'キーワード' }, 
            { en: 'AI Interpretation', jp: 'AIの解釈・出力傾向' }
          ],
          rows: [
            [{ en: 'Modern / Clean', jp: 'Modern / Clean' }, { en: 'Spacious, Sans-serif, Flat design', jp: '余白多め、サンセリフ体、フラットデザイン' }],
            [{ en: 'Bento Grids', jp: 'Bento Grids' }, { en: 'Apple-style grid, rounded cards', jp: 'Appleのようなグリッドレイアウト、角丸のカード' }],
            [{ en: 'Neubrutalism', jp: 'Neubrutalism' }, { en: 'Thick borders, primary colors, hard shadows', jp: '太い枠線、原色使い、強いドロップシャドウ' }],
            [{ en: 'Glassmorphism', jp: 'Glassmorphism' }, { en: 'Frosted glass effect, background blur', jp: 'すりガラス効果、背景ぼかし、半透明' }],
            [{ en: 'Corporate / Trust', jp: 'Corporate / Trust' }, { en: 'Navy palette, solid fonts, high density', jp: 'ネイビー・青基調、堅実なフォント、情報の密度高め' }]
          ]
        }
      ]
    },
    {
      id: '2-5',
      title: { en: '2-5. MVP Philosophy', jp: '2-5. 失敗しない要件定義：MVPの美学' },
      content: [
        {
          type: 'text',
          text: {
            en: 'AI development is lightning fast, but more features still lead to more bugs. For the first release (MVP), have the courage to strip away features.',
            jp: 'AI開発は爆速ですが、それでも機能が増えればバグの温床になります。最初のリリース（MVP: Minimum Viable Product）では、勇気を持って機能を削ぎ落とします。'
          }
        },
        {
          type: 'list',
          style: 'number',
          items: [
            { en: '**Must**: Essential. App is useless without it.', jp: '**Must (必須)**: これがないとゴミ。絶対に作る。' },
            { en: '**Should**: Recommended, but won\'t delay release.', jp: '**Should (推奨)**: あった方がいいが、リリースを遅らせるほどではない。' },
            { en: '**Won\'t**: Decided NOT to build this time. Most important.', jp: '**Won\'t (やらない)**: 今回は作らないと決めること。これが一番大事。' }
          ]
        },
        {
          type: 'callout',
          title: { en: 'Iterative Development', jp: 'AI時代のMVP開発' },
          text: {
            en: 'With AI, adding features later is very low cost. Start with a minimal setup—just login and displaying text—and grow it like a snowball.',
            jp: 'AIを使えば「後から機能追加」のコストは極めて低いです。だからこそ、最初は**「ログインできて、文字が表示されるだけ」**くらいの極小構成からスタートし、そこから雪だるま式に機能を足していく（イテレーティブ開発）のが正解です。'
          },
          variant: 'success'
        }
      ]
    }
  ]
};
