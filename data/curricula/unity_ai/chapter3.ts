import { DocChapter } from '../../../types';

const JP_DATA: DocChapter = {
  id: 'unity-ch3-jp',
  title: '第3章｜AIにUnityコードを書かせる',
  subtitle: '「動かないコード」を書かせないための、Unity特化型プロンプト設計。',
  readingTime: '25 min read',
  sections: [
    {
      id: '3-1',
      title: '3-1. Unity向けプロンプト設計',
      content: [
        {
          type: 'text',
          text: 'AIは優秀ですが、Unity開発においては「前提」を共有しないと時代遅れのコードを書くことがあります（古いAPIを使ったり、非効率な書き方をしたり）。'
        },
        {
          type: 'callout',
          title: '❌ 悪い指示',
          text: '「ブロック崩しのコードを書いて」\n→ AIは詳細を勝手に埋めてしまいます。変数はpublicまみれ、カメラは固定、物理挙動も適当になります。',
          variant: 'warning'
        },
        {
          type: 'callout',
          title: '⭕ 良い指示（構成要素）',
          text: '1. **コンテキスト**: 「Unity C#で、スマホ向けのブロック崩しを作ります」\n2. **やりたいこと**: 「プレイヤーの移動処理を書いてください」\n3. **手段（重要）**: 「Rigidbodyを使い、物理演算で移動させたいです」\n4. **制約（Constraint）**: 「変数は[SerializeField]を使い、Update内での重い処理は避けてください」',
          variant: 'success'
        }
      ]
    },
    {
      id: '3-2',
      title: '3-2. 実践：AIと作る最小ゲーム',
      content: [
        {
          type: 'text',
          text: '実際にAIを使って、シンプルな「ボール転がし」を作ってみましょう。'
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'プロンプト例',
          code: `Unity C#でプレイヤーの移動スクリプトを作成してください。
- 矢印キーでXZ平面を移動します。
- RigidbodyのAddForceを使って物理的に動かしたいです。
- 移動速度はInspectorで調整できるように、[SerializeField]を使ってください。
- ジャンプ機能は不要です。`
        },
        {
          type: 'text',
          text: 'こう指示すると、AIは素直に `AddForce` を使ったコードを出してくれます。これをコピペして動かし、「なんか遅いな」と思ったらInspectorでSpeedの数値を上げる。これがバイブコーディングです。'
        }
      ]
    },
    {
      id: '3-3',
      title: '3-3. AIコードあるある事故',
      content: [
        {
          type: 'text',
          text: 'AIが書いたコードを鵜呑みにすると、後で痛い目を見ることがあります。以下の「危険信号」を見逃さないでください。'
        },
        {
          type: 'list',
          items: [
            '**Update地獄**: 毎フレーム `GameObject.Find` や `GetComponent` をしている。\n→ **対策**: 「重い処理はStartでキャッシュして」と指示する。',
            '**巨大スクリプト**: 移動も攻撃も音もUIも、全部1つのファイルに書いている。\n→ **対策**: 「移動処理はMoveController、攻撃はAttackManagerに分けて」と分割を指示する。',
            '**謎の定数**: `speed = 5.0f` のようにコード内に数字が埋め込まれている。\n→ **対策**: 「パラメータはInspectorで設定したい」と指示する。'
          ]
        },
        {
          type: 'callout',
          title: '動いた＝完成ではない',
          text: 'AIのコードが動いても、上記の「事故」がないかざっと目を通すのが人間の仕事（コードレビュー）です。「動くからヨシ！」で進むと、プロジェクトが大きくなった時に破綻します。',
          variant: 'tip'
        }
      ]
    }
  ]
};

const EN_DATA: DocChapter = {
  id: 'unity-ch3-en',
  title: 'Chapter 3: Generating Unity Code with AI',
  subtitle: 'Prompt design specifically for Unity to prevent AI from writing "broken code".',
  readingTime: '25 min read',
  sections: [
    {
      id: '3-1',
      title: '3-1. Prompt Design for Unity',
      content: [
        {
          type: 'text',
          text: 'AI is smart, but in Unity development, if you don\'t share the "premises", it might write outdated code (using old APIs or inefficient methods).'
        },
        {
          type: 'callout',
          title: '❌ Bad Prompt',
          text: '"Write code for a block breaker game."\n→ AI will fill in the details arbitrarily. Variables will be all public, camera fixed, physics random.',
          variant: 'warning'
        },
        {
          type: 'callout',
          title: '⭕ Good Prompt (Components)',
          text: '1. **Context**: "I\'m making a block breaker for mobile in Unity C#."\n2. **Goal**: "Please write the player movement logic."\n3. **Method (Important)**: "Use Rigidbody and move it via physics."\n4. **Constraint**: "Use [SerializeField] for variables, and avoid heavy processing inside Update."',
          variant: 'success'
        }
      ]
    },
    {
      id: '3-2',
      title: '3-2. Practice: Minimal Game with AI',
      content: [
        {
          type: 'text',
          text: 'Let\'s actually create a simple "Ball Roller" using AI.'
        },
        {
          type: 'code',
          language: 'markdown',
          filename: 'Example Prompt',
          code: `Create a player movement script in Unity C#.
- Move on the XZ plane using arrow keys.
- I want to move physically using Rigidbody.AddForce.
- Please use [SerializeField] so I can adjust movement speed in the Inspector.
- No jump function needed.`
        },
        {
          type: 'text',
          text: 'With this instruction, AI will produce code using `AddForce`. Copy-paste this, run it, and if you think "it\'s too slow", increase the Speed value in Inspector. This is Vibe Coding.'
        }
      ]
    },
    {
      id: '3-3',
      title: '3-3. Common AI Code Accidents',
      content: [
        {
          type: 'text',
          text: 'If you blindly trust AI code, you might suffer later. Don\'t miss these "Danger Signals".'
        },
        {
          type: 'list',
          items: [
            '**Update Hell**: Doing `GameObject.Find` or `GetComponent` every frame.\n→ **Fix**: Tell AI to "Cache heavy operations in Start".',
            '**Giant Scripts**: Writing movement, attack, sound, and UI all in one file.\n→ **Fix**: Tell AI to "Split movement into MoveController and attack into AttackManager".',
            '**Magic Numbers**: Numbers like `speed = 5.0f` buried in the code.\n→ **Fix**: Tell AI "I want to set parameters in Inspector".'
          ]
        },
        {
          type: 'callout',
          title: 'Working ≠ Complete',
          text: 'Even if the AI code works, it is the human\'s job (Code Review) to glance through and check for the above "accidents". If you proceed with "It works, so it\'s fine!", the project will collapse as it grows.',
          variant: 'tip'
        }
      ]
    }
  ]
};

export const UNITY_CHAPTER_3_DATA = {
    jp: JP_DATA,
    en: EN_DATA
};
