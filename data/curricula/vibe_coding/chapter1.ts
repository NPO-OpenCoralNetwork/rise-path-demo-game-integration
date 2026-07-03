import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_1_DATA: DocChapter = {
  id: 'vibe-ch1',
  title: { en: 'Chapter 1 | Minimum Viable Knowledge', jp: '第1章｜人間が理解すべき最低ライン' },
  subtitle: { 
    en: 'Absolute basics of Web Architecture required to guide AI.', 
    jp: 'AIに指示を出すために、最低限知っておくべき「Webの仕組み」' 
  },
  readingTime: { en: '15 min read', jp: '15分で読める' },
  sections: [
    {
      id: '1-1',
      title: { en: '1-1. Frontend / Backend / DB relationship', jp: '1-1. フロントエンド / バックエンド / DBの関係' },
      content: [
        {
          type: 'text',
          text: {
            en: 'What exactly are we trying to build when we ask AI to "make an app"? A modern web application consists of three main elements working together.',
            jp: '「アプリを作りたい」とAIに頼むとき、私たちが作ろうとしているものは一体何なのでしょうか？大きく分けて3つの要素が連携して動いています。'
          },
          style: 'lead'
        },
        {
          type: 'mermaid',
          chart: `graph LR
    User((User)) --> Front[Frontend<br>Interior/Service]
    Front <-->|API| Back[Backend<br>Kitchen/Command]
    Back <-->|SQL| DB[(Database<br>Warehouse)]`,
          caption: { en: 'The 3-Tier Web Architecture', jp: 'Webアプリケーションの3層構造' }
        },
        {
          type: 'callout',
          title: { en: 'Think of a Restaurant...', jp: 'レストランで例えると...' },
          text: {
            en: 'The Frontend is the "Dining Area and Waiters," the Backend is the "Chef in the Kitchen," and the Database is the "Ingredients Warehouse." Customers (users) cannot enter the kitchen directly; they must order through the waiters (frontend).',
            jp: 'フロントエンドは「客席とウェイター」、バックエンドは「厨房のシェフ」、データベースは「食材庫」です。お客さん（ユーザー）は厨房（バックエンド）に直接入ることはできません。必ずウェイター（フロントエンド）を通して注文します。'
          },
          variant: 'tip'
        },
        {
          type: 'text',
          text: {
            en: 'When giving instructions to AI, simply being aware of whether you are talking about the "Kitchen" or the "Dining Area" will dramatically improve the quality of generated code.',
            jp: 'AIに指示を出すときは、「これは厨房（バックエンド）の処理？それとも客席（フロントエンド）の話？」と意識するだけで、生成されるコードの精度が劇的に上がります。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Frontend**: Runs in the browser (React, Vue, etc.). Everything the user sees.', jp: '**フロントエンド (Frontend)**: ブラウザで動く部分。ReactやVue.jsなどで作られます。ユーザーの目に触れる全てです。' },
            { en: '**Backend**: Runs on the server (Node.js, Python, etc.). Processes and saves data.', jp: '**バックエンド (Backend)**: サーバーで動く部分。Node.jsやPythonなどで作られます。データの加工や保存を担当します。' },
            { en: '**Database (DB)**: Where data is permanently stored (PostgreSQL, MySQL, etc.).', jp: '**データベース (DB)**: データを永続的に保存する場所。PostgreSQLやMySQLなどが使われます。' }
          ]
        }
      ]
    },
    {
      id: '1-2',
      title: { en: '1-2. What is UI? What is API?', jp: '1-2. UIとは何か、APIとは何か' },
      content: [
        {
          type: 'text',
          text: {
            en: '"Make a UI" and "Make an API" are completely different requests. Let\'s understand the boundary.',
            jp: '「UIを作って」と「APIを作って」は、全く異なる作業依頼です。この2つの境界線を理解しましょう。'
          }
        },
        {
          type: 'text',
          text: {
            en: '**UI (User Interface)** is the contact point between humans and computers. Buttons, forms, layouts—things humans "operate".',
            jp: '**UI (User Interface)** は人間とコンピュータの接点です。ボタン、入力フォーム、画面レイアウトなど、「人間が操作するもの」です。'
          }
        },
        {
          type: 'text',
          text: {
            en: '**API (Application Programming Interface)** is the window for the Frontend and Backend (or systems) to talk to each other.',
            jp: '**API (Application Programming Interface)** は、フロントエンドとバックエンド（またはシステム同士）が会話するための窓口です。'
          }
        },
        {
          type: 'code',
          language: 'json',
          filename: 'API Response Example (JSON)',
          code: `{ 
  "userId": "u_12345",
  "name": "Gemini User",
  "role": "admin",
  "lastLogin": "2026-01-10T10:00:00Z"
}`
        },
        {
          type: 'callout',
          title: { en: 'Vibe Coding Tip', jp: 'バイブコーディングのコツ' },
          text: {
            en: 'Asking to "Make the UI richer" makes AI adjust CSS and animations. Asking to "Fetch more data from the API" makes AI modify backend logic and SQL queries.',
            jp: '「UIをリッチにして」と言うとAIはCSSやアニメーションを調整します。「APIからもっとデータを取ってきて」と言うとAIはバックエンドのロジックやSQLを修正します。ここを混同しないことが重要です。'
          },
          variant: 'info'
        }
      ]
    },
    {
      id: '1-3',
      title: { en: '1-3. What is Deployment?', jp: '1-3. デプロイとは「何が起きている行為」か' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Making the app you built on your local PC available to the whole world is called "Deployment". It is more than just copying files.',
            jp: 'ローカル（自分のPC）で作ったアプリを、世界中の人が使えるようにすることを「デプロイ (Deploy)」と呼びます。これは単なるファイルコピーではありません。'
          }
        },
        {
          type: 'list',
          style: 'number',
          items: [
            { en: '**Build**: Converting human-readable code into an optimized format for machines.', jp: '**ビルド (Build)**: 人間が読みやすいコードを、機械が効率よく実行できる形式に変換・圧縮すること。' },
            { en: '**Transfer**: Sending files to a server (Vercel, Render, etc.).', jp: '**転送**: サーバー（VercelやRenderなど）にファイルを送ること。' },
            { en: '**Launch**: Running the program on the server to wait for requests.', jp: '**起動**: サーバー上でプログラムを走らせ、リクエストを待ち受ける状態にすること。' }
          ]
        }
      ]
    },
    {
      id: '1-4',
      title: { en: '1-4. Why Git is Essential', jp: '1-4. Gitはなぜ必須なのか（時間を保存する技術）' },
      content: [
        {
          type: 'text',
          text: {
            en: 'In AI development, Git is more than just a backup. It is a "Save Point"—your only way to "Rewind Time" when AI accidentally breaks your code.',
            jp: 'AI開発において、Gitは「コードのバックアップ」以上の意味を持ちます。それは「セーブポイント」であり、AIが破壊したコードを「時間を巻き戻して」修復するための唯一の手段です。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Commit**: Create a save point. A record of "it was working up to here".', jp: '**Commit**: セーブポイントを作成する。「ここまで動いていた」という記録。' },
            { en: '**Push**: Upload your save data to the cloud (GitHub).', jp: '**Push**: セーブデータをクラウド（GitHub）にアップロードする。' },
            { en: '**Revert**: Undo a failed future and return to a past save point.', jp: '**Revert**: 失敗した未来をなかったことにして、過去のセーブポイントに戻る。' }
          ]
        },
        {
          type: 'image',
          src: 'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?auto=format&fit=crop&q=80&w=1200',
          alt: 'Time Machine',
          caption: { en: 'Git is a time machine for developers. Essential for experimenting without fear.', jp: 'Gitは開発者のためのタイムマシンです。恐れずに実験するために必須のツールです。' }
        },
        {
          type: 'text',
          text: {
            en: 'AI sometimes makes bold changes that break existing features. With Git, you don\'t need to "wish" for it to go back. You just command it.',
            jp: 'AIは時々、大胆な修正を行って既存の機能を壊すことがあります。Gitがあれば、「昨日の状態に戻して」と念じる必要はありません。コマンド一つで確実に戻れます。'
          }
        }
      ]
    }
  ]
};