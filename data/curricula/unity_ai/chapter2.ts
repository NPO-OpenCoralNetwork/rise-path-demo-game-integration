import { DocChapter } from '../../../types';

const JP_DATA: DocChapter = {
  id: 'unity-ch2-jp',
  title: '第2章｜MonoBehaviourとC#最低限',
  subtitle: 'AIコードを「怖がらず読む」ための技術。スクリプトもただのComponentである。',
  readingTime: '30 min read',
  sections: [
    {
      id: '2-1',
      title: '2-1. Unityスクリプトの正体',
      content: [
        {
          type: 'text',
          text: 'プログラミングと聞くと「黒い画面に文字を打ち込む」イメージがあるかもしれません。しかしUnityにおいて、**スクリプトはComponentの一種**です。RigidbodyやLightと同じく、GameObjectにくっつけないと動きません。'
        },
        {
          type: 'callout',
          title: 'MonoBehaviour（モノビヘイビア）',
          text: 'Unityで作るスクリプトの99%は、`MonoBehaviour` というクラスを継承しています。これは「UnityのComponentとして振る舞うための契約書」のようなものです。これがあるおかげで、Inspectorに表示されたり、毎フレーム処理が走ったりします。',
          variant: 'info'
        },
        {
          type: 'text',
          text: 'AIにコードを書かせると、必ず `void Start()` や `void Update()` という単語が出てきます。これらは **Lifecycle (ライフサイクル)** と呼ばれる、Unityが決めたタイミングで自動的に呼ばれる関数です。'
        },
        {
          type: 'list',
          items: [
            '**Awake()**: ゲーム開始時、**叩き起こされた瞬間**に1回だけ呼ばれる。自分自身の準備に使う。',
            '**Start()**: Awakeの後、**出番が来る直前**に1回だけ呼ばれる。他の人（Object）との連携準備に使う。',
            '**Update()**: **毎フレーム**（1秒間に60回など）ずっと呼ばれ続ける。移動や入力チェックなど「動き」に使う。'
          ]
        },
        {
          type: 'callout',
          title: '🧪 やってみよう：最初のスクリプト',
          text: '1. Projectウィンドウで右クリック > Create > C# Script。\n2. 名前を `HelloUnity` にする（※作ってからリネームすると壊れるので注意！）。\n3. ダブルクリックして開き、Startの中に `Debug.Log("Hello!");` と書く。\n4. 保存してUnityに戻り、このスクリプトをCubeなどのGameObjectにドラッグ＆ドロップ。\n5. 再生すると「Console」タブに "Hello!" と出るのを確認。',
          variant: 'success'
        }
      ]
    },
    {
      id: '2-2',
      title: '2-2. AIコードを読むためのC#',
      content: [
        {
          type: 'text',
          text: 'AIにコードを書かせた時、中身がブラックボックスだと修正や調整ができません。「書けなくてもいいから、読める」レベルを目指します。注目すべきは変数の「属性」です。'
        },
        {
          type: 'code',
          language: 'csharp',
          filename: 'PlayerController.cs',
          code: `public class PlayerController : MonoBehaviour
{
    // これはダメな例（危険）
    public int hp = 100;

    // これが良い例（安全で便利）
    [SerializeField] private float speed = 5.0f;

    void Update() {
        // ...
    }
}`
        },
        {
          type: 'list',
          items: [
            '**public**: 誰でも触れる状態。他のスクリプトから勝手に書き換えられるリスクがあるため、実はあまり推奨されません。',
            '**private**: 自分専用。外部からは隠されます。',
            '**[SerializeField]**: 「privateだけど、Unityのエディタ（Inspector）からは調整したい」という時に使う魔法。**AI開発ではこれを徹底させましょう。**'
          ]
        },
        {
          type: 'callout',
          title: 'なぜ SerializeField が重要か',
          text: 'ゲームバランス（スピードやHPなど）は、コードを書き換えるのではなく、**プレイしながらInspectorのスライダーで調整する**のがUnity流です。そのために `[SerializeField]` が必須なのです。',
          variant: 'tip'
        }
      ]
    },
    {
      id: '2-3',
      title: '2-3. 基本構文の「形」だけ覚える',
      content: [
        {
          type: 'text',
          text: '詳細な文法はAIに聞けばいいですが、「これは何をしているブロックか」を瞬時に見抜くための形（パターン）だけ覚えましょう。'
        },
        {
          type: 'table',
          headers: ['構文', '形', '意味'],
          rows: [
            ['if文', 'if (条件) { ... }', 'もし〜なら、中の処理をする'],
            ['for文', 'for (...) { ... }', '指定回数だけ繰り返す（敵全員に攻撃など）'],
            ['関数', 'void Jump() { ... }', '「ジャンプ」という処理の塊を定義する']
          ]
        },
        {
          type: 'text',
          text: 'AIが書いたコードを見て、「ああ、ここでif文を使ってHPが0かチェックしているんだな」と構造が見えれば合格です。'
        }
      ]
    }
  ]
};

const EN_DATA: DocChapter = {
  id: 'unity-ch2-en',
  title: 'Chapter 2: MonoBehaviour & C# Basics',
  subtitle: 'The skill to read AI code without fear. Scripts are just Components.',
  readingTime: '30 min read',
  sections: [
    {
      id: '2-1',
      title: '2-1. What is a Unity Script?',
      content: [
        {
          type: 'text',
          text: 'You might imagine programming as typing text into a black screen. But in Unity, **a script is a type of Component**. Just like a Rigidbody or Light, it won\'t work unless attached to a GameObject.'
        },
        {
          type: 'callout',
          title: 'MonoBehaviour',
          text: '99% of scripts made in Unity inherit from a class called `MonoBehaviour`. This is like a "contract to behave as a Unity Component". Thanks to this, it appears in the Inspector and processes run every frame.',
          variant: 'info'
        },
        {
          type: 'text',
          text: 'When you have AI write code, words like `void Start()` and `void Update()` always appear. These are functions called **Lifecycle**, automatically called by Unity at determined timings.'
        },
        {
          type: 'list',
          items: [
            '**Awake()**: Called once at the very beginning, the moment the object is "woken up". Used for self-initialization.',
            '**Start()**: Called once after Awake, just before the "act begins". Used to prepare coordination with others.',
            '**Update()**: Called **every frame** (e.g., 60 times a second). Used for "movement" like walking or checking inputs.'
          ]
        },
        {
          type: 'callout',
          title: '🧪 Try it: First Script',
          text: '1. Right-click in Project window > Create > C# Script.\n2. Name it `HelloUnity` (Note: Don\'t rename after creation!).\n3. Double-click to open, and write `Debug.Log("Hello!");` inside Start.\n4. Save, go back to Unity, and drag & drop this script onto a GameObject like a Cube.\n5. Play and check the "Console" tab to see "Hello!".',
          variant: 'success'
        }
      ]
    },
    {
      id: '2-2',
      title: '2-2. C# for Reading AI Code',
      content: [
        {
          type: 'text',
          text: 'If the code AI writes is a black box, you can\'t fix or adjust it. Aim for the level where "you don\'t have to write it, but you can read it". Pay attention to variable "attributes".'
        },
        {
          type: 'code',
          language: 'csharp',
          filename: 'PlayerController.cs',
          code: `public class PlayerController : MonoBehaviour
{
    // Bad example (Risky)
    public int hp = 100;

    // Good example (Safe & Convenient)
    [SerializeField] private float speed = 5.0f;

    void Update() {
        // ...
    }
}`
        },
        {
          type: 'list',
          items: [
            '**public**: Accessible by anyone. Risky because other scripts can change it unexpectedly. Not recommended.',
            '**private**: For internal use only. Hidden from outside.',
            '**[SerializeField]**: Magic to say "It\'s private, but I want to adjust it from the Inspector". **Enforce this in AI development.**'
          ]
        },
        {
          type: 'callout',
          title: 'Why SerializeField is Crucial',
          text: 'The Unity way is to adjust game balance (like speed or HP) **using sliders in the Inspector while playing**, not by rewriting code. `[SerializeField]` is essential for this.',
          variant: 'tip'
        }
      ]
    },
    {
      id: '2-3',
      title: '2-3. Recognizing the "Shapes"',
      content: [
        {
          type: 'text',
          text: 'You can ask AI for syntax details, but remember the "shapes" (patterns) to instantly recognize what a block is doing.'
        },
        {
          type: 'table',
          headers: ['Syntax', 'Shape', 'Meaning'],
          rows: [
            ['if', 'if (condition) { ... }', 'If condition is true, do the inside'],
            ['for', 'for (...) { ... }', 'Repeat specific times (e.g., attack all enemies)'],
            ['function', 'void Jump() { ... }', 'Define a chunk of processing named "Jump"']
          ]
        },
        {
          type: 'text',
          text: 'If you can look at AI code and see, "Ah, it\'s using an if-statement here to check if HP is 0," you pass.'
        }
      ]
    }
  ]
};

export const UNITY_CHAPTER_2_DATA = {
    jp: JP_DATA,
    en: EN_DATA
};
