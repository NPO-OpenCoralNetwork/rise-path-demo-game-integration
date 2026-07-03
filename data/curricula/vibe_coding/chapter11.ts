import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_11_DATA: DocChapter = {
  id: 'vibe-ch11',
  title: { en: 'Chapter 11 | The Future of Learning', jp: '第11章｜これからの学び方' },
  subtitle: { 
    en: 'What to learn, what to ignore, and how to evolve as a developer in the AI era.', 
    jp: '何を学び、何を捨てるべきか。AI時代の開発者として進化し続けるための羅針盤。' 
  },
  readingTime: { en: '15 min read', jp: '15分で読める' },
  sections: [
    {
      id: '11-1',
      title: { en: '11-1. What NOT to Learn', jp: '11-1. プログラミングをどう学ぶか（学ばなくていい範囲）' },
      content: [
        {
          type: 'text',
          text: {
            en: 'The era of memorizing syntax is over. Do not spend time memorizing API parameters or CSS class names. AI can recall them in milliseconds.',
            jp: '構文を暗記する時代は終わりました。APIのパラメータやCSSのクラス名を覚えることに時間を使わないでください。AIはそれらをミリ秒で思い出せます。'
          },
          style: 'lead'
        },
        {
          type: 'list',
          style: 'check',
          items: [
            { en: '**Don\'t Memorize**: Regex, Date formatting, Boilerplate code.', jp: '**暗記しない**: 正規表現、日付のフォーマット、ボイラープレート（定型コード）。' },
            { en: '**Focus On**: "How it works" (Architecture), "Why it matters" (Business Logic), and "Is it secure?" (Security).', jp: '**理解する**: 「どう動くのか（アーキテクチャ）」、「なぜ必要なのか（ビジネスロジック）」、「安全か（セキュリティ）」。' }
          ]
        },
        {
          type: 'callout',
          title: { en: 'Deep Dive vs Broad View', jp: '深堀りと俯瞰' },
          text: {
            en: 'You don\'t need to know *how to write* a sorting algorithm, but you must know *when to use* it and *which one is faster*. Shift from "Writer" to "Selector".',
            jp: 'ソートアルゴリズムの「書き方」を知る必要はありませんが、「いつ使うべきか」「どれが速いか」は知っている必要があります。「書き手」から「選び手」にシフトしましょう。'
          },
          variant: 'info'
        }
      ]
    },
    {
      id: '11-2',
      title: { en: '11-2. Cultivating Tool Selection Eyes', jp: '11-2. AIツールの選別力を育てる' },
      content: [
        {
          type: 'text',
          text: {
            en: 'New AI tools appear every day. If you jump on every trend, you will drown. Develop an "Eye" for tools.',
            jp: '新しいAIツールは毎日登場します。すべてのトレンドに飛びついていては溺れてしまいます。「選球眼」を養いましょう。'
          }
        },
        {
          type: 'table',
          headers: [
            { en: 'Criteria', jp: '判断基準' },
            { en: 'Question to Ask', jp: '自分への問いかけ' }
          ],
          rows: [
            [
              { en: 'Integration', jp: '統合性' },
              { en: 'Does it fit into my current workflow (VSCode/Git)? Or does it force me to use a new platform?', jp: '今のワークフロー（VSCode/Git）に馴染むか？それとも独自のプラットフォームを強制してくるか？' }
            ],
            [
              { en: 'Lock-in', jp: 'ロックイン' },
              { en: 'Can I export the code? If the tool dies tomorrow, does my project survive?', jp: 'コードをエクスポートできるか？明日そのツールが消えても、プロジェクトは生き残れるか？' }
            ],
            [
              { en: 'Value', jp: '本質的価値' },
              { en: 'Does it solve a problem I actually have, or is it just a cool demo?', jp: 'いま抱えている課題を解決してくれるか？それとも単なる「すごいデモ」か？' }
            ]
          ]
        }
      ]
    },
    {
      id: '11-3',
      title: { en: '11-3. From Solo to Team', jp: '11-3. 個人開発・チーム開発への展開' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Vibe Coding scales. In a team, AI acts as a "Junior Developer" for everyone. But be careful with Code Reviews.',
            jp: 'バイブコーディングはスケールします。チーム開発において、AIは全員にとっての「専属ジュニア開発者」になります。ただし、コードレビューには注意が必要です。'
          }
        },
        {
          type: 'text',
          text: {
            en: 'Do not just copy-paste AI code into a Pull Request. You are responsible for the code you commit. "AI wrote it" is not an excuse for bugs.',
            jp: 'AIのコードをそのままプルリクエストに貼り付けないでください。コミットした時点で、そのコードの責任者はあなたです。「AIが書いたから」はバグの言い訳になりません。'
          }
        }
      ]
    },
    {
      id: '11-4',
      title: { en: '11-4. The Developer of 2026', jp: '11-4. 2026年以降の開発者像' },
      content: [
        {
          type: 'mindmap',
          root: {
            text: { en: 'The Future Developer', jp: '未来の開発者' },
            children: [
              {
                text: { en: 'Architect', jp: 'アーキテクト' },
                details: { en: 'Designing systems, connecting APIs, ensuring scalability.', jp: 'システムの全体像を描き、APIを繋ぎ、スケーラビリティを担保する。' }
              },
              {
                text: { en: 'Product Owner', jp: 'プロダクトオーナー' },
                details: { en: 'Understanding user needs and translating them into technical requirements.', jp: 'ユーザーのニーズを理解し、それを技術要件に翻訳する。' }
              },
              {
                text: { en: 'AI Conductor', jp: 'AI指揮者' },
                details: { en: 'Managing multiple AI agents to build software faster than ever.', jp: '複数のAIエージェントを指揮し、かつてない速度でソフトウェアを構築する。' }
              }
            ]
          }
        },
        {
          type: 'text',
          text: {
            en: 'You are no longer just a "Coder". You are a **Creator** who uses Code and AI as tools to build value. Welcome to the new era.',
            jp: 'あなたはもはや単なる「コーダー」ではありません。コードとAIを道具として使い、価値を生み出す **「クリエイター」** です。ようこそ、新時代へ。'
          },
          style: 'lead'
        }
      ]
    }
  ]
};
