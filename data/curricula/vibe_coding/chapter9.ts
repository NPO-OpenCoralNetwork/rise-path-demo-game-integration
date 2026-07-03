import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_9_DATA: DocChapter = {
  id: 'vibe-ch9',
  title: { en: 'Chapter 9 | Debugging & Error Handling', jp: '第9章｜失敗と修正を前提にした開発' },
  subtitle: { 
    en: 'AI will break your code. Learning how to fix it is the true skill of Vibe Coding.', 
    jp: 'AIは必ずコードを壊します。その直し方を知ることこそが、バイブコーディングの真髄です。' 
  },
  readingTime: { en: '40 min read', jp: '40分で読める' },
  sections: [
    {
      id: '9-1',
      title: { en: '9-1. AI is a "Liar"', jp: '9-1. AIは平気で嘘をつく（ハルシネーション）' },
      content: [
        {
          type: 'text',
          text: {
            en: 'First, accept this fact: AI does not "know" the code. It predicts the next likely word. Sometimes, it confidently invents libraries that don\'t exist.',
            jp: 'まずこの事実を受け入れてください。AIはコードを「理解」しているわけではありません。確率的にありそうな次の単語を予測しているだけです。時として、存在しないライブラリを自信満々にimportしてくることさえあります。'
          },
          style: 'lead'
        },
        {
          type: 'callout',
          title: { en: 'The "Confidence" Trap', jp: '「自信満々」の罠' },
          text: {
            en: 'AI will apologize politely ("I apologize for the confusion...") and then give you another broken solution. Do not trust its tone. Trust the code execution.',
            jp: 'AIは丁寧に謝罪し（「混乱を招き申し訳ありません...」）、そしてまた別の壊れたコードを提示してきます。AIの「丁寧さ」を信じないでください。コードの「実行結果」だけを信じてください。'
          },
          variant: 'warning'
        }
      ]
    },
    {
      id: '9-2',
      title: { en: '9-2. The Taxonomy of AI Errors', jp: '9-2. AIが起こすエラーの分類図鑑' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Not all errors are equal. Knowing which type of error you are facing tells you how to fix it.',
            jp: 'すべてのエラーが同じわけではありません。直面しているエラーの種類を知ることで、対処法が決まります。'
          }
        },
        {
          type: 'table',
          headers: [
            { en: 'Error Type', jp: 'エラーの種類' },
            { en: 'Symptom', jp: '症状' },
            { en: 'AI Fixability', jp: 'AIでの修正' }
          ],
          rows: [
            [
              { en: 'Syntax Error', jp: '構文エラー' },
              { en: 'Red squiggly lines. App crashes immediately.', jp: '赤い波線が出る。アプリが即座にクラッシュする。' },
              { en: 'High (Paste the error)', jp: '高（エラー文を貼れば直る）' }
            ],
            [
              { en: 'Reference Error', jp: '参照エラー' },
              { en: '\'undefined is not a function\'. Using things that don\'t exist.', jp: '「undefined is not a function」。存在しない変数や関数を使おうとしている。' },
              { en: 'Medium (Need to check imports)', jp: '中（import漏れが多い）' }
            ],
            [
              { en: 'Logic Error', jp: '論理エラー' },
              { en: 'No crash, but the result is wrong (e.g. 1+1=11).', jp: 'クラッシュしないが、結果が間違っている（例：1+1=11になる）。' },
              { en: 'Low (Need to explain logic)', jp: '低（ロジックを説明する必要あり）' }
            ],
            [
              { en: 'Hallucination', jp: '幻覚' },
              { en: 'Importing "react-super-button" (doesn\'t exist).', jp: '「react-super-button」など、実在しない謎のライブラリを使ってくる。' },
              { en: 'Zero (AI made it up)', jp: 'ゼロ（AIの妄想。人間が止めるしかない）' }
            ]
          ]
        }
      ]
    },
    {
      id: '9-3',
      title: { en: '9-3. The Debugging Workflow', jp: '9-3. 黄金のデバッグ・フロー' },
      content: [
        {
          type: 'text',
          text: {
            en: 'When you hit an error, do not panic. Follow this flowchart.',
            jp: 'エラーが出てもパニックにならないでください。このフローチャートに従ってください。'
          }
        },
        {
          type: 'mermaid',
          chart: `flowchart TD
    Error[Error Occurs] --> Check{Is it simple?}
    Check -- Yes --> Paste[Paste Error to AI]
    Check -- No --> Log[Check Logs (F12/Terminal)]
    Log --> Context[Add Context to AI]
    Context --> Paste
    Paste --> Fix[Apply Fix]
    Fix --> Verify{Fixed?}
    Verify -- Yes --> Commit[Git Commit]
    Verify -- No --> Retry{Tried 3 times?}
    Retry -- No --> Revert[Git Revert (Undo)]
    Retry -- Yes --> Human[Human Intervention]`,
          caption: { en: 'The Vibe Debugging Flow', jp: 'バイブデバッグ・フロー' }
        },
        {
          type: 'text',
          text: {
            en: 'The most important step is **"Tried 3 times? -> Git Revert"**. If AI can\'t fix it in 3 tries, it\'s likely stuck in a loop. Undo changes and try a different approach.',
            jp: '最も重要なのは **「3回試した？ → Git Revert」** の分岐です。AIが3回修正しても直らない場合、AIはループに陥っています。潔く変更を破棄（Undo）し、別のアプローチを試すべきです。'
          }
        }
      ]
    },
    {
      id: '9-4',
      title: { en: '9-4. How to Read Logs', jp: '9-4. 「ログを見る」という行為' },
      content: [
        {
          type: 'text',
          text: {
            en: 'AI cannot see your screen. You are the AI\'s eyes. You must feed it the "Logs".',
            jp: 'AIはあなたの画面を見ることができません（スクリーンショットを貼らない限り）。あなたがAIの「目」になる必要があります。AIに「ログ」という餌を与えてください。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Browser Console (F12)**: For Frontend errors (React crashing, UI not updating).', jp: '**ブラウザコンソール (F12)**: フロントエンドのエラー（Reactのクラッシュ、UIが更新されない等）。' },
            { en: '**Terminal**: For Build errors and Backend errors.', jp: '**ターミナル**: ビルドエラーや、バックエンド（サーバー側）のエラー。' },
            { en: '**Network Tab**: For API communication errors (404 Not Found, 500 Server Error).', jp: '**ネットワークタブ**: API通信のエラー（404が見つからない、500サーバーエラー等）。' }
          ]
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'Good Debug Prompt',
          code: `I got an error when clicking the Login button.
Here is the error log from the Browser Console:

\`Uncaught TypeError: Cannot read properties of undefined (reading 'token')\

And here is the relevant code in \`auth.ts\`:
(Paste code here)

Please analyze why 'token' might be undefined.`
        }
      ]
    },
    {
      id: '9-5',
      title: { en: '9-5. The Human Boundary', jp: '9-5. 人間が判断すべき境界線' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Finally, know when to stop using AI. There are moments when writing code yourself is faster.',
            jp: '最後に、「AIを使うのをやめるタイミング」を知っておきましょう。自分で書いたほうが早い瞬間があります。'
          }
        },
        {
          type: 'list',
          style: 'check',
          items: [
            { en: 'Changing a specific color code (Just CSS it)', jp: '特定の色コードの変更（CSSを直接いじる方が早い）' },
            { en: 'Typo in a text (Just backspace it)', jp: 'テキストの誤字脱字（バックスペースで消す方が早い）' },
            { en: 'Sensitive Logic (Payments, Security)', jp: '重要なロジック（決済、セキュリティ周りはAI任せにせず、一行ずつ人間が確認する）' }
          ]
        },
        {
          type: 'callout',
          title: { en: 'The Vibe Coder\'s Credo', jp: 'バイブコーダーの信条' },
          text: {
            en: '"I am the Pilot. AI is the Engine. If the Engine stalls, I fix it with my wrench."', // Corrected escaped quote here
            jp: '「私はパイロット。AIはエンジン。エンジンが止まったら、私がレンチで直す。」この気概が、最強のAI使いを作ります。'
          },
          variant: 'success'
        }
      ]
    }
  ]
};
