import { DocChapter } from '../../../types';

export const VIBE_CHAPTER_3_DATA: DocChapter = {
  id: 'vibe-ch3',
  title: { en: 'Chapter 3 | The Development Cockpit', jp: '第3章｜開発環境コックピット（VSCode）' },
  subtitle: { 
    en: 'Setting up Visual Studio Code, the ultimate weapon for modern developers.', 
    jp: '最強の武器「VSCode」を導入し、AI開発に最適化されたコックピットを構築する。' 
  },
  readingTime: { en: '20 min read', jp: '20分で読める' },
  sections: [
    {
      id: '3-1',
      title: { en: '3-1. Why Not Notepad?', jp: '3-1. なぜ「メモ帳」ではダメなのか' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Programming is not just writing text. It involves file management, terminal commands, git operations, and debugging. You need a tool that does it all in one window.',
            jp: 'プログラミングは単なる文字入力ではありません。ファイル管理、ターミナル操作、Git連携、デバッグ...これら全てを1つのウィンドウで完結できるツールが必要です。'
          },
          style: 'lead'
        },
        {
          type: 'text',
          text: {
            en: '**Visual Studio Code (VSCode)** is the industry standard. It is lightweight, free, and has an endless ecosystem of extensions.',
            jp: '**Visual Studio Code (VSCode)** は、現代の業界標準エディタです。軽量で無料、そして無限の拡張機能エコシステムを持っています。'
          }
        },
        {
          type: 'callout',
          title: { en: 'Installation', jp: 'インストール' },
          text: {
            en: 'Download from https://code.visualstudio.com/. It supports Windows, Mac, and Linux.',
            jp: 'https://code.visualstudio.com/ からダウンロードしてください。Windows, Mac, Linuxすべてに対応しています。'
          },
          variant: 'info'
        }
      ]
    },
    {
      id: '3-2',
      title: { en: '3-2. Anatomy of the Cockpit', jp: '3-2. 画面の見方（コックピットの計器類）' },
      content: [
        {
          type: 'text',
          text: {
            en: 'Understanding your tool is the first step to speed.',
            jp: 'ツールの各部名称を覚えることが、スピードへの第一歩です。'
          }
        },
        {
          type: 'list',
          items: [
            { en: '**Explorer (Left)**: Your project files. `Ctrl/Cmd + B` to toggle.', jp: '**エクスプローラー (左)**: プロジェクトのファイル一覧。`Ctrl/Cmd + B` で開閉できます。' },
            { en: '**Editor (Center)**: Where you write code. You can split screens to see multiple files.', jp: '**エディタ (中央)**: コードを書く場所。画面を分割して複数のファイルを同時に見ることができます。' },
            { en: '**Terminal (Bottom)**: Where you talk to the system. `Ctrl/Cmd + J` (or `~`) to toggle.', jp: '**ターミナル (下)**: システムに命令を送る場所。`Ctrl/Cmd + J` (または `~`) で開閉します。' },
            { en: '**Command Palette (Top)**: The magic search bar. `Ctrl/Cmd + Shift + P` to do ANYTHING.', jp: '**コマンドパレット (上)**: 魔法の検索バー。`Ctrl/Cmd + Shift + P` を押せば、マウスを使わずにあらゆる操作が可能です。' }
          ]
        }
      ]
    },
    {
      id: '3-3',
      title: { en: '3-3. Essential Extensions', jp: '3-3. 必須の拡張機能' },
      content: [
        {
          type: 'text',
          text: {
            en: 'VSCode is just a skeleton. You need to equip it with armor (Extensions).',
            jp: '初期状態のVSCodeは「素体」です。拡張機能という「装備」を整えましょう。'
          }
        },
        {
          type: 'table',
          headers: [{ en: 'Extension', jp: '拡張機能名' }, { en: 'Why you need it', jp: '役割' }],
          rows: [
            [{ en: 'Prettier', jp: 'Prettier' }, { en: 'Automatically formats your messy code on save.', jp: '汚いコードを保存時に自動で整形してくれます。必須。' }],
            [{ en: 'ESLint', jp: 'ESLint' }, { en: 'Finds bugs and errors before you run the code.', jp: '実行前にバグやエラーを見つけて警告してくれます。' }],
            [{ en: 'Tailwind CSS', jp: 'Tailwind CSS' }, { en: 'Gives autocomplete for Tailwind classes.', jp: 'Tailwindのクラス名を補完してくれます。' }],
            [{ en: 'GitLens', jp: 'GitLens' }, { en: 'Visualizes who wrote which line of code and when.', jp: '「誰がいつこの行を書いたか」を行ごとに表示してくれます。' }]
          ]
        }
      ]
    },
    {
      id: '3-4',
      title: { en: '3-4. The AI-Native Alternative: Cursor', jp: '3-4. AIネイティブな選択肢：Cursor' },
      content: [
        {
          type: 'text',
          text: {
            en: 'If you want to go all-in on AI, try **Cursor**. It is a fork of VSCode with built-in AI capabilities like "Command K" to generate code inline.',
            jp: 'もしAI開発にフルコミットするなら、**Cursor** という選択肢もあります。VSCodeをベースに作られており、`Cmd + K` でエディタ内に直接AIコードを生成できる機能などが標準搭載されています。'
          }
        },
        {
          type: 'callout',
          title: { en: 'Migration is Easy', jp: '移行は簡単' },
          text: {
            en: 'Since Cursor is built on VSCode, you can import all your VSCode extensions and settings with one click.',
            jp: 'CursorはVSCodeがベースなので、VSCodeで使っていた拡張機能や設定をワンクリックで引き継ぐことができます。'
          },
          variant: 'success'
        }
      ]
    }
  ]
};
