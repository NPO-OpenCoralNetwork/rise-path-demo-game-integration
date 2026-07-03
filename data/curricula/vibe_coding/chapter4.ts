import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_4_DATA: DocChapter = {
  id: 'vibe-ch4',
  title: { en: 'Chapter 4 | Generating Frontend with AI', jp: '第4章｜フロントエンドをAIで生成する' },
  subtitle: { 
    en: 'Building the "Look and Feel" instantly using Google AI Studio & Gemini 3 Pro.', 
    jp: 'Google AI Studio × Gemini 3 Pro で「見た目」を爆速構築する' 
  },
  readingTime: { en: '25 min read', jp: '25分で読める' },
  sections: [
    {
      id: '4-1',
      title: { en: '4-1. Why Google AI Studio?', jp: '4-1. なぜ Google AI Studio なのか？' },
      content: [
        {
          type: 'text',
          text: {
            en: 'While ChatGPT is great, for development, **Google AI Studio** is a hidden gem. It offers raw access to Gemini 3 Pro, one of the most powerful models for coding, often for free.',
            jp: 'ChatGPTも優秀ですが、開発においては **Google AI Studio** が隠れた名ツールです。コーディング性能が極めて高い「Gemini 3 Pro」の生の能力を、（多くの場合無料で）フル活用できるからです。'
          },
          style: 'lead'
        },
        {
          type: 'list',
          items: [
            { en: '**Long Context**: It can read massive amounts of documentation or existing code at once (up to 2M tokens!).', jp: '**ロングコンテキスト**: 膨大なドキュメントや既存のコードを一度に読み込めます（最大200万トークン！）。' },
            { en: '**Multimodal**: It understands images and videos with exceptionally high precision.', jp: '**マルチモーダル**: 画像や動画の認識精度が極めて高いです。「このスクショと同じUIを作って」が得意技です。' },
            { en: '**Controllability**: You can tweak "Temperature" (creativity) to get consistent code outputs.', jp: '**制御性**: 「Temperature（創造性）」などのパラメータを調整し、安定したコードを出力させることができます。' }
          ]
        },
        {
          type: 'callout',
          title: { en: 'Setup', jp: '準備' },
          text: {
            en: 'Access https://aistudio.google.com/ and log in with your Google account. That\'s it. You are ready to develop.',
            jp: 'https://aistudio.google.com/ にアクセスし、Googleアカウントでログインするだけです。これだけで、最強の開発環境が手に入ります。'
          },
          variant: 'info'
        }
      ]
    },
    {
      id: '4-2',
      title: { en: '4-2. "Screenshot" is the Best Blueprint', jp: '4-2. 「スクショ」が最強の設計図' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Why is image input faster? Because describing UI in words is incredibly inefficient. A single screenshot contains thousands of data points about layout, color, and spacing.',
            jp: 'なぜ画像のほうが早いのか？ それは、UIを言葉で説明するのが圧倒的に非効率だからです。1枚のスクショには、レイアウト、色、余白に関する数千のデータポイントが含まれています。'
          }
        },
        {
          type: 'table',
          headers: [
            { en: 'Comparison', jp: '比較' },
            { en: 'Text Prompting', jp: 'テキスト指示' },
            { en: 'Image Prompting', jp: '画像指示（スクショ）' }
          ],
          rows: [
            [
              { en: 'Effort', jp: '指示の手間' }, 
              { en: 'High (Need to define layout, colors, font sizes)', jp: '高い（レイアウト、色、サイズを言語化する必要あり）' }, 
              { en: 'Zero (Just Paste)', jp: 'ゼロ（貼るだけ）' }
            ],
            [
              { en: 'Information Density', jp: '情報量' }, 
              { en: 'Low (Nuances are lost)', jp: '低い（ニュアンスが伝わりきらない）' }, 
              { en: 'High (Pixel-perfect details)', jp: '高い（ピクセル単位の情報を網羅）' }
            ],
            [
              { en: 'Result Accuracy', jp: '再現度' }, 
              { en: 'Hit or Miss (Depends on your vocabulary)', jp: 'バラつく（言語化能力に依存）' }, 
              { en: 'Consistent (AI sees what you see)', jp: '安定（AIが「正解」を見ているため）' }
            ]
          ]
        },
        {
          type: 'text',
          text: {
            en: 'Draw a rough sketch on paper, take a photo, and paste it. Or take a screenshot of a website you like. Gemini will understand the layout, colors, and even the "vibe" instantly.',
            jp: '紙に手書きでラフを描いて写真を撮るか、参考になるWebサイトのスクリーンショットを撮って貼り付けましょう。Geminiはレイアウト、配色、そして「雰囲気」までも一瞬で理解します。'
          }
        },
        {
          type: 'mermaid',
          chart: `graph LR
    Input[Input: Image/Sketch] --> Gemini{Gemini 3 Pro}
    Gemini --> Code[Output: React/HTML Code]
    Code --> Preview[Browser Preview]`,
          caption: { en: 'Image to Code Workflow', jp: '画像からコードを生成するフロー' }
        }
      ]
    },
    {
      id: '4-3',
      title: { en: '4-3. The "One-Shot" Prompt for UI', jp: '4-3. 1発で動くコードを出させるプロンプト' },
      content: [
        {
          type: 'text',
          text: {
            en: 'To get usable code instantly, you need to specify the "Tech Stack" clearly. Otherwise, you might get raw HTML when you wanted React.',
            jp: '使えるコードを即座に得るためには、「技術スタック」を明確に指定する必要があります。そうしないと、Reactが欲しいのに生のHTMLが返ってきたりします。'
          }
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'UI Generation Prompt Template',
          code: `Act as an expert Frontend Developer.
Create a modern, responsive landing page based on the attached image.

Requirements:
- Framework: React (Functional Components)
- Styling: Tailwind CSS (use standard utility classes)
- Icons: Lucide React (import from 'lucide-react')
- Structure: Single file component (for easy copying)
- Design: Make it look clean, professional, and mobile-responsive.

Output ONLY the code. No explanation needed.`
        },
        {
          type: 'callout',
          title: { en: 'Why Single File?', jp: 'なぜ「単一ファイル」？' },
          text: {
            en: 'For prototyping, asking for a "Single file component" is crucial. It allows you to copy-paste everything into `App.tsx` and see it work immediately without managing multiple files.',
            jp: 'プロトタイピングでは「単一ファイル（Single file）」で出力させることが重要です。そうすれば、`App.tsx` に丸ごとコピペするだけで動きます。ファイル分割は、動いた後にやればいいのです。'
          },
          variant: 'tip'
        }
      ]
    },
    {
      id: '4-4',
      title: { en: '4-4. Download & GitHub Integration', jp: '4-4. ダウンロード・GitHub連携' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Once you have the code, don\'t just stare at it. Put it in your local environment.',
            jp: 'コードが生成されたら、眺めているだけではいけません。自分のローカル環境に移しましょう。'
          }
        },
        {
          type: 'list',
          style: 'number',
          items: [
            { en: '**Download**: Use the "Download" or "Export" button in AI Studio to save your project as a folder.', jp: '**ダウンロード**: AI Studioの「Download」または「Export」機能を使って、プロジェクトをフォルダとして保存します。' },
            { en: '**Open in VSCode**: Open the downloaded folder in VSCode to start the development environment.', jp: '**VSCodeで開く**: 保存したフォルダをVSCodeで開き、ローカルでの開発・微調整を開始します。' },
            { en: '**Push to GitHub**: Initialize a Git repo (`git init`), add a remote, and `push` your code to the cloud.', jp: '**GitHubへPush**: `git init` でリポジトリを作成し、GitHubにリモート登録して `push` します。これで「セーブポイント」がクラウドに保存されます。' },
            { en: '**Clone Anywhere**: Now you can `clone` this project on any other machine and continue developing from where you left off.', jp: '**どこでもClone**: 一度GitHubに上げれば、別のPCでも `git clone` するだけで、すぐに開発の続きを再開できます。' }
          ]
        },
        {
          type: 'callout',
          title: { en: 'Note on Git Commands', jp: 'Gitコマンドについて' },
          text: {
            en: 'Detailed Git commands and setup procedures will be explained in **Chapter 4**. For now, just understand the flow.',
            jp: '具体的なGitコマンドやセットアップ手順については、次の**第4章**で詳しく解説します。まずは全体の流れを理解してください。'
          },
          variant: 'info'
        },
        {
          type: 'callout',
          title: { en: 'The Professional Loop', jp: 'プロフェッショナル・ループ' },
          text: {
            en: 'AI Studio (Prototype) -> Download -> VSCode (Refine) -> GitHub (Save/Share) -> Clone (Scale). This is the standard pipeline for modern creators.',
            jp: 'AI Studio（試作）→ ダウンロード → VSCode（調整）→ GitHub（保存・共有）→ Clone（展開）。これが現代のクリエイターの標準的なパイプラインです。'
          },
          variant: 'success'
        },
        {
          type: 'text',
          text: {
            en: 'This flow—**Generate, Sync, and Collaborate**—turns a simple experiment into a production-ready software project.',
            jp: 'この **「生成・同期・共有」** の流れを身につけることで、単なる実験レベルのコードが、本番品質のソフトウェアプロジェクトへと進化します。'
          }
        }
      ]
    }
  ]
};
