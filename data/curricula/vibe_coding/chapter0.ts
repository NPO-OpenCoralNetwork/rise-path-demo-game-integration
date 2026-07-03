import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_0_DATA: DocChapter = {
  id: 'vibe-ch0',
  title: { en: 'Chapter 0 | Sharing the Premise', jp: '第0章｜この時代の前提を共有する' },
  subtitle: { 
    en: 'Understanding why "No-Code" development is now possible and what our roles are.', 
    jp: 'なぜ今「コードを書かない開発」が可能なのか。そして私たちの役割は何かに迫る。' 
  },
  readingTime: { en: '10 min read', jp: '10分で読める' },
  sections: [
    {
      id: '0-1',
      title: { en: '0-1. The Paradigm Shift (Mind Map)', jp: '0-1. パラダイムシフトの全体像' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Before we dive into the how-to, let\'s look at the big picture. Click each node to see details.',
            jp: '具体的な方法に入る前に、まずは全体像を俯瞰しましょう。各トピックをクリックすると詳細が表示されます。'
          },
          style: 'lead'
        },
        {
          type: 'mindmap',
          root: {
            text: { en: 'Vibe Coding', jp: 'バイブコーディング' },
            children: [
              {
                text: { en: 'Why Now?', jp: 'なぜ今成立するのか' },
                details: { 
                  en: 'Massive improvement in LLM reasoning (Gemini 3 Pro) and the shift from "Instruction" to "Orchestration.".',
                  jp: 'LLM（Gemini 3 Proなど）の推論能力が劇的に向上し、「一行ずつ命令する」から「意図を指揮する」への転換が起きたため。' 
                },
                children: [
                  { 
                    text: { en: 'Long Context', jp: 'ロングコンテキスト' }, 
                    details: { en: 'AI can read your whole project at once.', jp: 'AIがプロジェクト全体を一気に理解できる。' } 
                  },
                  { 
                    text: { en: 'Native Speed', jp: 'ネイティブな速度' }, 
                    details: { en: 'Near-instant generation cycle.', jp: '思考の速度でコードが形になる。' } 
                  }
                ]
              },
              {
                text: { en: 'Human Role', jp: '人間の新しい役割' },
                details: { 
                  en: 'No more fighting with syntax. Your job is Vision, UX, and Validation.',
                  jp: '構文と戦う時間は終わり。あなたの仕事は「ビジョンの提示」「体験(UX)の設計」「正しいかどうかの判断」です。'
                }
              },
              {
                text: { en: 'AI Role', jp: 'AIの役割' },
                details: { 
                  en: 'Execution, syntax management, and tedious implementation.',
                  jp: '実装の実行、構文の管理、そして地道なルーチンワークの完遂。'
                }
              }
            ]
          }
        }
      ]
    },
    {
      id: '0-2',
      title: { en: '0-2. What we "Don\'t Do" in this course', jp: '0-2. このカリキュラムで“やらないこと”' },
      content: [
        {
          type: 'text',
          text: {
            en: 'To master Vibe Coding, you must let go of some old habits.',
            jp: 'バイブコーディングを習得するために、あえて「捨てる」習慣があります。'
          }
        },
        {
          type: 'list',
          style: 'check',
          items: [
            { en: 'Memorizing tags and syntax', jp: 'タグや構文の暗記（AIに任せる）' },
            { en: 'Debugging line-by-line manually', jp: '一行ずつの手動デバッグ（ログをAIに食わせる）' },
            { en: 'Building everything from scratch', jp: 'ゼロからのスクラッチ開発（叩き台はAIに作らせる）' }
          ]
        }
      ]
    }
  ]
};
