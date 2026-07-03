import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_7_DATA: DocChapter = {
  id: 'vibe-ch7',
  title: { en: 'Chapter 7 | Data Persistence with Supabase', jp: '第7章｜Supabaseでデータを持たせる' },
  subtitle: { 
    en: 'Adding a "Brain" (Database) and "Gatekeeper" (Auth) to your application.', 
    jp: 'アプリに「脳（データベース）」と「門番（認証）」を追加する。' 
  },
  readingTime: { en: '25 min read', jp: '25分で読める' },
  sections: [
    {
      id: '7-1',
      title: { en: '7-1. What is Supabase?', jp: '7-1. Supabaseとは何か' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Supabase is an open-source alternative to Firebase. It provides a full backend suite (Database, Auth, Storage, Realtime) based on **PostgreSQL**.',
            jp: 'Supabaseは、Firebaseのオープンソース代替として人気のBaaSです。**PostgreSQL** をベースにしたバックエンド機能（データベース、認証、ストレージ、リアルタイム通信）を一式提供してくれます。'
          },
          style: 'lead'
        },
        {
          type: 'list',
          items: [
            { en: '**Relational DB**: Unlike Firebase (NoSQL), it uses SQL, which is great for structured data.', jp: '**リレーショナルDB**: Firebase (NoSQL) と違い、SQLを使うため、構造化されたデータの扱いに長けています。' },
            { en: '**Instant API**: It automatically generates APIs from your table schema.', jp: '**API自動生成**: テーブルを作ると、自動的にAPIが生えてきます。バックエンドのコードを書く必要が激減します。' },
            { en: '**Generative AI Support**: It has built-in Vector capabilities for AI apps.', jp: '**生成AIサポート**: ベクトル検索機能が標準搭載されており、AIアプリ開発との相性が抜群です。' }
          ]
        }
      ]
    },
    {
      id: '7-2',
      title: { en: '7-2. The Three Pillars: Auth, DB, Storage', jp: '7-2. Auth・DB・Storageの役割' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Supabase simplifies the three hardest parts of web development.',
            jp: 'Web開発で最も面倒な3つの要素を、Supabaseは劇的に簡単にします。'
          }
        },
        {
          type: 'table',
          headers: [
            { en: 'Feature', jp: '機能' },
            { en: 'Role', jp: '役割' }
          ],
          rows: [
            [
              { en: 'Authentication', jp: 'Auth (認証)' },
              { en: 'Handles Login/Sign-up. Supports Google, GitHub, and Magic Links.', jp: 'ログイン・サインアップ機能。Googleログインやメールリンク認証も一瞬で実装可能。' }
            ],
            [
              { en: 'Database', jp: 'Database (DB)' },
              { en: 'Stores user data (Todo items, Profiles, Chat logs).', jp: 'ユーザーデータの保存場所。Todoリスト、プロフィール、チャットログなど。' }
            ],
            [
              { en: 'Storage', jp: 'Storage (倉庫)' },
              { en: 'Stores large files like Profile Pictures and Uploaded Images.', jp: 'プロフィール画像やアップロードされた写真など、巨大なファイルの保存場所。' }
            ]
          ]
        }
      ]
    },
    {
      id: '7-3',
      title: { en: '7-3. API Keys and Environment Variables', jp: '7-3. APIキーと環境変数の考え方' },
      content: [
        {
          type: 'text',
          text: {
            en: 'To connect your Frontend to Supabase, you need "Keys". But be careful where you put them.',
            jp: 'フロントエンドからSupabaseに接続するには「鍵（APIキー）」が必要です。しかし、その置き場所には注意が必要です。'
          }
        },
        {
          type: 'code',
          language: 'bash',
          filename: '.env.local',
          code: `VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_placeholder`
        },
        {
          type: 'callout',
          title: { en: 'Safety First', jp: '安全第一' },
          text: {
            en: 'Never hardcode keys in your `.tsx` files. Always use `.env` files and add `.env` to your `.gitignore` to prevent leaking secrets to GitHub.',
            jp: '`.tsx` ファイルの中にキーを直接書かないでください（ハードコーディング禁止）。必ず `.env` ファイルを使い、`.env` を `.gitignore` に追加して、GitHubに秘密情報が漏れるのを防ぎましょう。'
          },
          variant: 'warning'
        }
      ]
    },
    {
      id: '7-4',
      title: { en: '7-4. Supabase × AI Workflow', jp: '7-4. Supabase × AIで詰まりやすいポイント' },
      content: [
        {
          type: 'text',
          text: {
            en: 'AI is great at writing SQL, but you need to give it the right context.',
            jp: 'AIはSQLを書くのが得意ですが、正しい文脈を与える必要があります。'
          }
        },
        {
          type: 'mermaid',
          chart: `sequenceDiagram
    participant You
    participant AI
    participant Supabase
    You->>AI: "Create a table for Todos"
    AI->>You: "Here is the SQL code"
    You->>Supabase: Run SQL in SQL Editor
    Supabase-->>You: Table Created!
    You->>AI: "Now write React code to fetch Todos"`,
          caption: { en: 'The Workflow', jp: '開発フロー' }
        },
        {
          type: 'callout',
          title: { en: 'RLS (Row Level Security)', jp: 'RLS（行レベルセキュリティ）' },
          text: {
            en: 'By default, Supabase tables are private. You must enable "RLS Policies" to let users see their own data. Ask AI: "Write an RLS policy that allows users to select only their own todos."',
            jp: 'Supabaseのテーブルはデフォルトで非公開です。「RLSポリシー」を設定しないと、データを取得できません。AIに「ユーザーが自分のデータだけを見れるRLSポリシーを書いて」と頼みましょう。'
          },
          variant: 'tip'
        }
      ]
    }
  ]
};
