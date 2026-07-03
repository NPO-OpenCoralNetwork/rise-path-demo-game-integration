import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_8_DATA: DocChapter = {
  id: 'vibe-ch8',
  title: { en: 'Chapter 8 | Deployment: Taking it to the World', jp: '第8章｜デプロイして“世界に出す”' },
  subtitle: { 
    en: 'Releasing your app using Vercel and Render. Making it available to everyone.', 
    jp: 'VercelとRenderを使ってアプリを公開し、世界中の人が使える状態にする。' 
  },
  readingTime: { en: '30 min read', jp: '30分で読める' },
  sections: [
    {
      id: '8-1',
      title: { en: '8-1. Frontend Deployment with Vercel', jp: '8-1. フロントエンドをVercelで公開' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Vercel is the gold standard for deploying React apps. It connects directly to GitHub and updates your site automatically every time you push.',
            jp: 'Reactアプリの公開において、Vercelはデファクトスタンダードです。GitHubと連携させるだけで、コードをpushするたびに自動でサイトが更新されます。'
          },
          style: 'lead'
        },
        {
          type: 'list',
          style: 'number',
          items: [
            { en: 'Import project from GitHub', jp: 'GitHubからリポジトリをインポートする' },
            { en: 'Set Environment Variables (VITE_SUPABASE_URL, etc.)', jp: '環境変数を設定する（VITE_SUPABASE_URLなど）' },
            { en: 'Click "Deploy"', jp: '「Deploy」ボタンを押す' }
          ]
        },
        {
          type: 'callout',
          title: { en: 'Environment Variables', jp: '環境変数の設定' },
          text: {
            en: 'Do not forget to copy your `.env` values to the Vercel dashboard. Without these, your app cannot talk to Supabase.',
            jp: '`.env` に書いた値をVercelのダッシュボードにも入力するのを忘れないでください。これを忘れると、公開したアプリがSupabaseと通信できません。'
          },
          variant: 'warning'
        }
      ]
    },
    {
      id: '8-2',
      title: { en: '8-2. Backend Deployment with Render', jp: '8-2. バックエンドをRenderで公開' },
      content: [
        {
          type: 'text',
          text: {
            en: 'If you built a custom Node.js server, Render is an excellent choice. It handles automatic SSL and scaling.',
            jp: '独自のNode.jsサーバーを構築した場合、Renderが有力な選択肢になります。自動SSL対応やスケーリングも管理してくれます。'
          }
        },
        {
          type: 'mermaid',
          chart: `graph LR
    GitHub -- Trigger --> Vercel[Frontend: Vercel]
    GitHub -- Trigger --> Render[Backend: Render]
    Vercel -- API Request --> Render
    Render -- SQL Query --> Supabase[(Database: Supabase)]`,
          caption: { en: 'The Production Architecture', jp: '本番環境の構成図' }
        }
      ]
    },
    {
      id: '8-3',
      title: { en: '8-3. Free Tier Limits', jp: '8-3. 無料枠の制限と考え方' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Most hobby projects can run for free, but know the limitations.',
            jp: 'ほとんどの個人プロジェクトは無料で運営可能ですが、制限を知っておく必要があります。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Spin-up Time**: Render free tier "sleeps" after inactivity. First request takes ~30s.', jp: '**起動時間**: Renderの無料枠は一定時間アクセスがないと「眠り」ます。最初のアクセスには30秒ほどかかります。' },
            { en: '**Bandwidth**: Vercel has a monthly limit (usually 100GB), which is plenty for MVPs.', jp: '**通信量**: Vercelには月間転送量制限（通常100GB）がありますが、MVPレベルなら十分です。' }
          ]
        }
      ]
    },
    {
      id: '8-4',
      title: { en: '8-4. Post-Launch Checklist', jp: '8-4. 公開後に確認すべきチェックリスト' },
      content: [
        {
          type: 'list',
          style: 'check',
          items: [
            { en: 'Does the site open on mobile?', jp: 'スマホ実機で正しく表示されるか？' },
            { en: 'Is the Supabase connection working?', jp: 'Supabaseとの通信（ログイン、データ保存）は動いているか？' },
            { en: 'Are there any "Console Errors" in F12?', jp: 'ブラウザのコンソール（F12）に赤いエラーが出ていないか？' }
          ]
        },
        {
          type: 'text',
          text: {
            en: 'Deployment is the start, not the end. Once it is live, real users will find real bugs. That leads us to the next chapter: Debugging.',
            jp: 'デプロイは終わりではなく、始まりです。公開されることで、実際のユーザーが実際のバグを見つけてくれます。それが次の章「デバッグ」に繋がります。'
          }
        }
      ]
    }
  ]
};
