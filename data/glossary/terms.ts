
export interface GlossaryTerm {
  id: string;
  term: string;          // マッチさせる主単語
  synonyms?: string[];   // 同義語
  definitions: {         // 言語ごとの定義
    en: string;
    jp: string;
  };
  category: 'unity' | 'code' | 'concept' | 'general';
  aiContextPrompts?: {   // AIへの指示も言語ごとに用意
    en: string;
    jp: string;
  }; 
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    id: 'scene',
    term: 'Scene',
    synonyms: ['シーン'],
    definitions: {
      en: 'A basic unit of Unity development, representing a "stage" like a Title screen, Game level, or Result screen.',
      jp: 'Unityの「場面」の単位。タイトル画面、ゲーム本編、リザルト画面など、1つの場面につき1つのSceneファイルを作るのが基本。'
    },
    category: 'unity',
    aiContextPrompts: {
      en: 'The user is a beginner. Explain "Scene" using an analogy of a movie or play. Why not put everything in one scene?',
      jp: 'ユーザーはUnity初心者です。「Scene（シーン）」について、演劇や映画の「場面転換」に例えて説明してください。なぜ全てを1つのシーンで作ってはいけないのかも教えてください。'
    }
  },
  {
    id: 'gameobject',
    term: 'GameObject',
    synonyms: ['ゲームオブジェクト'],
    definitions: {
      en: 'The base class for all entities in Unity scenes. Players, enemies, cameras, and lights are all GameObjects.',
      jp: 'Unityのシーン上に配置される「物体」の総称。プレイヤー、敵、カメラ、光、UI、ただの空っぽの箱、これら全てがGameObject。'
    },
    category: 'unity',
    aiContextPrompts: {
      en: 'Explain "GameObject" as an "empty box" that needs components to do anything.',
      jp: 'ユーザーはUnity初心者です。「GameObject」について、「ただの箱」であるという性質を強調して説明してください。Componentがつかないと何もしないことを例えてください。'
    }
  },
  {
    id: 'component',
    term: 'Component',
    synonyms: ['コンポーネント'],
    definitions: {
      en: 'Functional blocks attached to GameObjects, like Transform (position), MeshRenderer (look), or Rigidbody (physics).',
      jp: 'GameObjectにくっつける「機能」や「部品」。Transform（位置）、MeshRenderer（見た目）、Rigidbody（物理）などがある。'
    },
    category: 'unity',
    aiContextPrompts: {
      en: 'Analogy for Component: equipment, clothing, or skills for a human (GameObject).',
      jp: 'ユーザーはUnity初心者です。「Component」について、GameObjectを人間に例えるなら「服」や「道具」や「スキル」にあたるものとして説明してください。'
    }
  },
  {
    id: 'rigidbody',
    term: 'Rigidbody',
    synonyms: ['リジッドボディ'],
    definitions: {
      en: 'A physics component that makes a GameObject subject to gravity and collision forces.',
      jp: '物理演算Component。これをつけると重力で落ちたり、物にぶつかって跳ね返ったりするようになる。'
    },
    category: 'unity'
  },
  {
    id: 'prefab',
    term: 'Prefab',
    synonyms: ['プレハブ'],
    definitions: {
      en: 'A reusable template for GameObjects. Editing the Prefab asset updates all instances in all scenes.',
      jp: 'GameObjectを「型（テンプレート）」として保存したもの。これをコピーして大量の敵や弾丸を作る。大元のPrefabを修正すると、全てのコピーに反映される。'
    },
    category: 'unity',
    aiContextPrompts: {
      en: 'Analogy for Prefab: a "rubber stamp" or "mold". Contrast it with manual manual editing of 100 objects.',
      jp: 'ユーザーはUnity初心者です。「Prefab（プレハブ）」について、「ハンコ」や「金型」に例えて説明してください。Prefabを使わずに100体の敵を配置した時の絶望的な修正作業と比較してください。'
    }
  },
  {
    id: 'monobehaviour',
    term: 'MonoBehaviour',
    synonyms: ['モノビヘイビア'],
    definitions: {
      en: 'The base class from which every Unity script derives, allowing use of Start() and Update() methods.',
      jp: 'Unityスクリプトの基本となるクラス。これを継承することで、Start()やUpdate()などのUnityの魔法が使えるようになる。'
    },
    category: 'code'
  },
  {
    id: 'update',
    term: 'Update',
    synonyms: ['Update関数'],
    definitions: {
      en: 'A function called every frame. Use this for continuous actions like movement or input checking.',
      jp: '毎フレーム（1秒間に60回など）繰り返し呼ばれ続ける関数。移動や入力のチェックなどはここに書く。'
    },
    category: 'code'
  },
  {
    id: 'serializefield',
    term: 'SerializeField',
    synonyms: ['シリアライズフィールド'],
    definitions: {
      en: 'A C# attribute that makes private variables editable in the Unity Inspector. Essential for game balancing.',
      jp: 'スクリプト内の変数を、UnityエディタのInspectorから設定・変更できるようにする魔法の言葉（属性）。private変数のまま扱えるので安全。'
    },
    category: 'code'
  },
  
  // --- AI & Prompting ---
  {
    id: 'prompt',
    term: 'Prompt',
    synonyms: ['プロンプト', '指示文'],
    definitions: {
      en: 'The instructions given to AI. The quality of the prompt determines the quality of the generated code.',
      jp: 'AIに対する指示のこと。この質が、出力されるコードの質を左右する。「AIへの発注書」。'
    },
    category: 'general'
  },
  {
    id: 'constraint',
    term: 'Constraint',
    synonyms: ['制約', '制約条件'],
    definitions: {
      en: 'Rules set for AI to prevent bugs or messy code (e.g., "Use Rigidbody", "Do not use Find").',
      jp: 'AIが変なコードを書かないようにあらかじめ決めておくルールのこと。「Rigidbodyを使って」「Findは使わないで」など。'
    },
    category: 'general'
  },
  {
    id: 'find',
    term: 'GameObject.Find',
    synonyms: ['Find関数', 'Find'],
    definitions: {
      en: 'A heavy function that searches for objects by name. Avoid using this in Update() as it causes lag.',
      jp: '名前でオブジェクトを探す関数。非常に処理が重いため、Updateの中で使うとゲームがカクつく原因になる。「検索」ではなく「参照」を使うべき。'
    },
    category: 'code'
  },

  // --- Python Basics ---
  {
    id: 'variable',
    term: 'Variable',
    synonyms: ['variable', 'variables', '変数'],
    definitions: {
      en: 'A name that references an object in memory rather than storing the value itself.',
      jp: '値そのものではなく、メモリ上のオブジェクトを参照する「名前」。'
    },
    category: 'code'
  },
  {
    id: 'object',
    term: 'Object',
    synonyms: ['object', 'objects', 'オブジェクト'],
    definitions: {
      en: 'A value with type and identity stored in memory (e.g., list, string, number).',
      jp: '型とID（同一性）を持つメモリ上の実体（例: リスト、文字列、数値）。'
    },
    category: 'code'
  },
  {
    id: 'reference',
    term: 'Reference',
    synonyms: ['reference', 'references', '参照'],
    definitions: {
      en: 'A link from a name to an object. Multiple names can reference the same object.',
      jp: '名前からオブジェクトへ向かうリンク。複数の名前が同じオブジェクトを指せる。'
    },
    category: 'concept'
  },
  {
    id: 'mutable',
    term: 'Mutable',
    synonyms: ['mutable', 'ミュータブル', '可変'],
    definitions: {
      en: 'An object that can be changed in place (e.g., list, dict).',
      jp: 'オブジェクト自体をその場で変更できる性質（例: リスト、辞書）。'
    },
    category: 'concept'
  },
  {
    id: 'immutable',
    term: 'Immutable',
    synonyms: ['immutable', 'イミュータブル', '不変'],
    definitions: {
      en: 'An object that cannot be changed in place (e.g., int, str).',
      jp: 'その場で変更できず、変更時は新しいオブジェクトになる性質（例: int, str）。'
    },
    category: 'concept'
  },
  {
    id: 'shallow-copy',
    term: 'Shallow copy',
    synonyms: ['shallow copy', '浅いコピー'],
    definitions: {
      en: 'Copies only the outer container; nested objects are still shared.',
      jp: '外側だけを複製し、内側の参照は共有されたままのコピー。'
    },
    category: 'concept'
  },
  {
    id: 'deep-copy',
    term: 'Deep copy',
    synonyms: ['deep copy', 'deepcopy', '深いコピー'],
    definitions: {
      en: 'Copies the full structure recursively so nested objects are independent.',
      jp: 'ネストも含めて再帰的に複製し、内側も独立させるコピー。'
    },
    category: 'concept'
  },
  {
    id: 'identity',
    term: 'Identity',
    synonyms: ['identity', '同一性'],
    definitions: {
      en: 'Whether two names reference the exact same object (checked with `is`).',
      jp: '2つの名前が同一オブジェクトを指しているかどうか（`is` で判定）。'
    },
    category: 'concept'
  },
  {
    id: 'equality',
    term: 'Equality',
    synonyms: ['equality', '等価性'],
    definitions: {
      en: 'Whether two values are equal in content (checked with `==`).',
      jp: '値の内容が等しいかどうか（`==` で判定）。'
    },
    category: 'concept'
  },
  {
    id: 'ref-count',
    term: 'Reference count',
    synonyms: ['reference count', 'ref count', '参照カウント'],
    definitions: {
      en: 'The number of references pointing to an object; when it reaches zero, the object can be freed.',
      jp: 'オブジェクトを参照している数。0になると解放対象になる。'
    },
    category: 'concept'
  },
  {
    id: 'garbage-collection',
    term: 'Garbage collection',
    synonyms: ['garbage collection', 'GC', 'ガーベジコレクション'],
    definitions: {
      en: 'Automatic memory cleanup for objects that are no longer referenced.',
      jp: '参照されなくなったオブジェクトを自動回収する仕組み。'
    },
    category: 'concept'
  },

  // --- List Comprehensions ---
  {
    id: 'list-comprehension',
    term: 'List comprehension',
    synonyms: ['list comprehension', 'list comprehensions', '内包表記', 'リスト内包表記'],
    definitions: {
      en: 'A compact Python syntax to map and filter data in one line.',
      jp: '1行でデータの変換と抽出を行うPythonの記法。'
    },
    category: 'code'
  },
  {
    id: 'mapping',
    term: 'Mapping',
    synonyms: ['mapping', 'map', '変換'],
    definitions: {
      en: 'Transform each item into a new value (e.g., f(x) for x in data).',
      jp: '各要素を別の値に変換する処理。'
    },
    category: 'concept'
  },
  {
    id: 'filtering',
    term: 'Filtering',
    synonyms: ['filtering', 'filter', 'フィルタ', 'フィルタリング', '抽出'],
    definitions: {
      en: 'Keep only items that satisfy a condition.',
      jp: '条件を満たす要素だけを残す処理。'
    },
    category: 'concept'
  },
  {
    id: 'flattening',
    term: 'Flattening',
    synonyms: ['flattening', 'flatten', 'フラット化'],
    definitions: {
      en: 'Convert nested lists into a single list.',
      jp: 'ネストしたリストを1つのリストにまとめる処理。'
    },
    category: 'concept'
  },
  {
    id: 'iterable',
    term: 'Iterable',
    synonyms: ['iterable', 'イテラブル'],
    definitions: {
      en: 'An object you can loop over (e.g., list, tuple, range).',
      jp: '繰り返し処理できるオブジェクト（リスト、タプル、range など）。'
    },
    category: 'concept'
  },
  {
    id: 'loop',
    term: 'Loop',
    synonyms: ['loop', 'for loop', 'for文', 'ループ'],
    definitions: {
      en: 'A control structure that repeats an operation for each item.',
      jp: '各要素に対して処理を繰り返す制御構造。'
    },
    category: 'concept'
  },

  // --- AI Agents ---
  {
    id: 'ai-agent',
    term: 'AI Agent',
    synonyms: ['AI agent', 'AI agents', 'AIエージェント', 'エージェント'],
    definitions: {
      en: 'A system that uses a model plus tools to plan and act toward a goal, not just chat.',
      jp: 'モデルとツールを使って目標達成のために計画・実行するシステム。会話だけでなく行動まで行う。'
    },
    category: 'concept'
  },
  {
    id: 'tool-use',
    term: 'Tool Use',
    synonyms: ['tool use', 'tool-use', 'tool calling', 'function calling', 'ツール利用', '関数呼び出し'],
    definitions: {
      en: 'Calling external tools (APIs/functions) to get data or take actions as part of a task.',
      jp: '外部ツール（API/関数）を呼び出して情報取得や実行を行うこと。'
    },
    category: 'concept'
  },
  {
    id: 'reasoning',
    term: 'Reasoning',
    synonyms: ['reasoning', '推論'],
    definitions: {
      en: 'The decision process used to choose the next step or derive an answer.',
      jp: '次の手順や回答を導くための思考プロセス。'
    },
    category: 'concept'
  },
  {
    id: 'planning',
    term: 'Planning',
    synonyms: ['planning', '計画'],
    definitions: {
      en: 'Breaking a goal into steps and deciding the order of actions.',
      jp: '目標を複数ステップに分解し、行動の順序を決めること。'
    },
    category: 'concept'
  },
  {
    id: 'state',
    term: 'State',
    synonyms: ['state', '状態'],
    definitions: {
      en: 'The current context or status an agent maintains while working.',
      jp: 'エージェントが作業中に保持する現在の文脈や進捗状態。'
    },
    category: 'concept'
  },
  {
    id: 'memory',
    term: 'Memory',
    synonyms: ['memory', 'メモリ', '記憶'],
    definitions: {
      en: 'Information kept across steps or sessions to preserve context.',
      jp: 'ステップやセッションを跨いで文脈を保持するための情報。'
    },
    category: 'concept'
  },
  {
    id: 'autonomy',
    term: 'Autonomy',
    synonyms: ['autonomy', '自律性'],
    definitions: {
      en: 'How independently an agent can act without human approval.',
      jp: '人間の承認なしでどれだけ独立して行動できるかの度合い。'
    },
    category: 'concept'
  },
  {
    id: 'rag',
    term: 'RAG',
    synonyms: ['Retrieval-Augmented Generation', 'RAG', '検索拡張生成'],
    definitions: {
      en: 'A pattern that retrieves external data and uses it in generation for more grounded answers.',
      jp: '外部データを検索し、その情報を使って回答を生成する手法。'
    },
    category: 'concept'
  },
  {
    id: 'grounding',
    term: 'Grounding',
    synonyms: ['grounding', 'グラウンディング'],
    definitions: {
      en: 'Linking outputs to verifiable sources to reduce unsupported claims.',
      jp: '検証可能な情報源に結び付け、根拠のない出力を減らすこと。'
    },
    category: 'concept'
  },
  {
    id: 'context-window',
    term: 'Context Window',
    synonyms: ['context window', 'context length', 'コンテキストウィンドウ', 'コンテキスト長'],
    definitions: {
      en: 'The amount of text a model can consider at one time.',
      jp: 'モデルが一度に扱える文脈量（入力の上限）。'
    },
    category: 'general'
  },
  {
    id: 'token',
    term: 'Token',
    synonyms: ['token', 'tokens', 'トークン'],
    definitions: {
      en: 'A chunk of text used for model input/output and billing.',
      jp: 'モデルの入出力や課金で使われるテキストの単位。'
    },
    category: 'general'
  },
  {
    id: 'latency',
    term: 'Latency',
    synonyms: ['latency', 'レイテンシ', 'レイテンシー'],
    definitions: {
      en: 'The time between a request and the response.',
      jp: 'リクエストから応答までの遅延時間。'
    },
    category: 'general'
  },
  {
    id: 'hallucination',
    term: 'Hallucination',
    synonyms: ['hallucination', 'Hallucination', '幻覚'],
    definitions: {
      en: 'A confident but incorrect model output.',
      jp: '自信があるように見えて実は誤っている出力。'
    },
    category: 'concept'
  },
  {
    id: 'guardrails',
    term: 'Guardrails',
    synonyms: ['guardrails', 'ガードレール'],
    definitions: {
      en: 'Rules, constraints, and approvals that keep systems safe.',
      jp: '安全性を保つためのルール、制約、承認フロー。'
    },
    category: 'concept'
  },
  {
    id: 'routing',
    term: 'Routing',
    synonyms: ['routing', 'ルーティング'],
    definitions: {
      en: 'Choosing which model or tool handles a task.',
      jp: 'タスクに応じて使うモデルやツールを振り分けること。'
    },
    category: 'concept'
  },
  {
    id: 'fallback',
    term: 'Fallback',
    synonyms: ['fallback', 'フォールバック'],
    definitions: {
      en: 'A backup path used when the primary choice fails.',
      jp: '主要な手段が失敗したときに使う代替手段。'
    },
    category: 'concept'
  },
  {
    id: 'evaluation',
    term: 'Evaluation',
    synonyms: ['evaluation', '評価'],
    definitions: {
      en: 'Measuring model performance with defined metrics and test sets.',
      jp: '定義した指標やテストセットで性能を測定すること。'
    },
    category: 'concept'
  },
  {
    id: 'agentops',
    term: 'AgentOps',
    synonyms: ['AgentOps', 'エージェント運用'],
    definitions: {
      en: 'Operational practices for deploying, monitoring, and improving agent systems.',
      jp: 'エージェントの運用・監視・改善を行う実践的な取り組み。'
    },
    category: 'concept'
  },
  {
    id: 'orchestration',
    term: 'Orchestration',
    synonyms: ['orchestration', 'オーケストレーション'],
    definitions: {
      en: 'Coordinating multiple steps, tools, or agents to complete a workflow.',
      jp: '複数のステップ・ツール・エージェントを連携させてワークフローを完遂すること。'
    },
    category: 'concept'
  },
  {
    id: 'monitoring',
    term: 'Monitoring',
    synonyms: ['monitoring', 'モニタリング'],
    definitions: {
      en: 'Tracking performance and issues in production.',
      jp: '本番環境の性能や問題を継続的に監視すること。'
    },
    category: 'general'
  }
];
