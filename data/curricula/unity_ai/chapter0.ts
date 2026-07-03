import { DocChapter } from '../../../types';

const JP_DATA: DocChapter = {
  id: 'unity-ch0-jp',
  title: '第0章｜AI時代のゲーム開発思想',
  subtitle: 'なぜ今、AIを使ってゲームを作るのか？ 「判断」と「構造」の時代へ',
  readingTime: '10 min read',
  sections: [
    {
      id: '0-1',
      title: '0-1. AI時代に「書ける人」が減る理由',
      content: [
        {
          type: 'text',
          text: 'AIの進化により、プログラミングコードを人間がゼロから書く必要性は急速に低下しています。しかし、それは「開発者」が不要になるという意味ではありません。役割が大きく変わるのです。',
          style: 'lead'
        },
        {
          type: 'table',
          headers: ['項目', 'AIが得意なこと', 'AIが苦手なこと（人間の役割）'],
          rows: [
            ['コーディング', '定型的なコード生成、エラー修正', '目的の定義、面白さの判断'],
            ['設計', '既存パターンの提案', 'プロジェクト全体の整合性維持'],
            ['メンテナンス', '単純作業の高速化', '未知のバグへの創造的な対処']
          ]
        },
        {
          type: 'callout',
          title: '人間の新しい役割',
          text: 'これからのクリエイターに求められるのは、コードを書く力よりも、AIが生成したものが「目的に合っているか」を**判断**する力、そしてAIが迷わないように全体の**構造（アーキテクチャ）**を設計する「指揮官」としての力です。',
          variant: 'info'
        }
      ]
    },
    {
      id: '0-2',
      title: '0-2. バイブコーディングとは何か',
      content: [
        {
          type: 'text',
          text: '完璧な設計図を書いてから作り始める時代は終わりました。これからは「バイブコーディング」の時代です。'
        },
        {
          type: 'list',
          items: [
            '**動く仮説**: 細部にとらわれず、AIを使って「とりあえず動くもの」を高速で作る。',
            '**バイブス（直感）重視**: 頭で悩み続けるより、動くものを触って「なんか違う」「もっとこうしたい」という直感を頼りに改善する。',
            '**失敗ログも資産**: エラー解決プロセスや対話ログは、全てあなただけの知識資産になります。'
          ]
        },
        {
          type: 'callout',
          title: 'マインドセット',
          text: '「一発で成功させよう」と思わず、AIと一緒に試行錯誤するプロセスそのものを楽しみましょう。あなたが上司（ディレクター）、AIは優秀な部下（プログラマー）。部下が働きやすい環境を作るのが、あなたの仕事です。',
          variant: 'tip'
        }
      ]
    }
  ]
};

const EN_DATA: DocChapter = {
  id: 'unity-ch0-en',
  title: 'Chapter 0: AI Era Game Dev Philosophy',
  subtitle: 'Why build games with AI now? The era of "Judgment" and "Structure".',
  readingTime: '10 min read',
  sections: [
    {
      id: '0-1',
      title: '0-1. Why "Coders" Are Decreasing',
      content: [
        {
          type: 'text',
          text: 'With the evolution of AI, the need for humans to write code from scratch is rapidly declining. However, this does not mean "developers" are becoming obsolete. The role is shifting significantly.',
          style: 'lead'
        },
        {
          type: 'table',
          headers: ['Item', 'What AI is Good At', 'What AI is Bad At (Human Role)'],
          rows: [
            ['Coding', 'Boilerplate generation, Error fixing', 'Defining purpose, Judging fun'],
            ['Design', 'Proposing existing patterns', 'maintaining project consistency'],
            ['Maintenance', 'Speeding up simple tasks', 'Creative solutions to unknown bugs']
          ]
        },
        {
          type: 'callout',
          title: 'The New Human Role',
          text: 'What is required of future creators is not the ability to write code, but the ability to **judge** whether what AI has generated fits the purpose, and the ability to act as a "commander" who designs the overall **structure (architecture)** so that AI does not get lost.',
          variant: 'info'
        }
      ]
    },
    {
      id: '0-2',
      title: '0-2. What is Vibe Coding?',
      content: [
        {
          type: 'text',
          text: 'The era of writing perfect blueprints before building is over. This is the era of "Vibe Coding".'
        },
        {
          type: 'list',
          items: [
            '**Working Hypothesis**: Don\'t get hung up on details; use AI to build "something that works" quickly.',
            '**Vibes (Intuition) First**: Instead of overthinking, touch the working prototype and improve it based on intuition like "this feels off" or "I want it more like this".',
            '**Failure Logs are Assets**: Error resolution processes and dialogue logs become your personal knowledge assets.'
          ]
        },
        {
          type: 'callout',
          title: 'Mindset',
          text: 'Don\'t try to succeed in one go; enjoy the process of trial and error with AI. You are the boss (director), and AI is the capable subordinate (programmer). It is your job to create an environment where your subordinate can work easily.',
          variant: 'tip'
        }
      ]
    }
  ]
};

export const UNITY_CHAPTER_0_DATA = {
    jp: JP_DATA,
    en: EN_DATA
};