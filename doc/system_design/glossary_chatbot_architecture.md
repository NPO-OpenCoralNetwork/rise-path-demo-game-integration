# インタラクティブ用語辞典 & AIチューター連携 アーキテクチャ

## 1. 概要
学習コンテンツ（ドキュメント）内の専門用語をユーザーがクリックした際、簡易的な定義を表示（Tooltip/Popover）し、さらに深い理解が必要な場合はワンクリックで右下のAIチャットボット（Rise Path）を起動して対話学習を開始できる仕組みを構築する。

## 2. システム構成図 (Mermaid)

```mermaid
graph TD
    Data[Content Data<br>(Chapter JSON)] --> Parser[Text Parser Component]
    GlossaryDB[(Glossary Database<br>Key/Definition/Prompt)] --> Parser
    
    Parser --> |Match & Highlight| RenderedView[Rendered Document]
    
    User((User)) --> |Click Term| Popover[Term Popover UI]
    Popover --> |Show Definition| User
    
    Popover --> |Click 'Ask AI'| ChatBridge[Chat Context Bridge]
    ChatBridge --> |Open & Send Context| Chatbot[Rise Path Chatbot]
    
    Chatbot --> |Interactive Dialogue| User
```

## 3. データ構造設計

### 3.1. 用語データベース (Glossary Store)
用語の定義と、AIに投げかける際の「特製プロンプト」を管理する。

```typescript
// data/glossary/terms.ts

export interface GlossaryTerm {
  id: string;
  term: string;          // マッチさせる単語 (例: "Rigidbody")
  synonyms?: string[];   // 同義語 (例: ["リジッドボディ", "剛体"])
  definition: string;    // ポップアップで表示する短い説明 (140文字以内)
  category: 'unity' | 'code' | 'concept' | 'general';
  
  // AIに投げかける際のコンテキスト指示（これがない場合はデフォルトの「〜について教えて」になる）
  aiContextPrompt?: string; 
}

// 例
export const TERMS: GlossaryTerm[] = [
  {
    id: 'rigidbody',
    term: 'Rigidbody',
    definition: 'Unityの物理演算コンポーネント。これをつけると重力の影響を受けたり、衝突判定が発生するようになる。',
    category: 'unity',
    aiContextPrompt: 'ユーザーはUnity初心者です。「Rigidbody」について、現実世界の「重さのあるボール」と「無重力の風船」の違いを例に出して、中学生でもわかるように説明してください。その後、理解度確認クイズを1問出してください。'
  }
];
```

### 3.2. テキスト描画コンポーネント (`TextWithGlossary`)
通常のテキストブロックを受け取り、用語辞書と照らし合わせて自動的にインタラクティブなSpanに変換する。

*   **機能**:
    *   文章をスペースや句読点でトークン化、または正規表現で用語を検索。
    *   マッチした用語を `<GlossarySpan>` コンポーネントでラップする。
    *   **工夫**: 1ページ内で同じ単語が何度も出るとうるさいので、「最初の1回だけハイライト」または「重要な箇所のみハイライト」するオプションを持たせる。

## 4. UI/UX フロー

### ステップ1: 用語の発見
*   テキスト中の専門用語（例: Rigidbody, GameObject）が、点線の下線付きテキスト（または色付き）で表示される。
*   ユーザーは「これ何？」と思ったらクリック（またはホバー）。

### ステップ2: 簡易理解 (Quick Look)
*   小さなPopoverが表示される。
*   **内容**:
    *   用語名
    *   1行解説（Definition）
    *   **アクションボタン**: 「AI先生に詳しく聞く (Ask Rise Path)」

### ステップ3: AIとの対話 (Deep Dive)
*   「AI先生に詳しく聞く」をクリックすると、画面右下のチャットボットウィンドウが自動で開く（既に開いている場合はフォーカス）。
*   **システム挙動**:
    1.  チャットボットに裏で「システムプロンプト」として `aiContextPrompt` を送信。
    2.  ユーザーの入力欄に「Rigidbodyについて教えて」と自動入力＆送信（または自動で回答開始）。
*   **対話体験**:
    *   AIは単なる辞書的な回答ではなく、「インタラクティブな会話」を行う。
    *   例：「Rigidbodyは重力ですね。もしこれがないと、マリオはどうなってしまうと思いますか？（考えさせる問いかけ）」

## 5. 実装フェーズ

### Phase 1: データと基本表示
1.  `data/glossary/` ディレクトリ作成。
2.  `GlossaryContext` の作成（辞書データのロード）。
3.  `DocView` 内のテキストレンダリング部分に `TextWithGlossary` 処理を挟む。

### Phase 2: ポップアップUI
1.  `GlossaryPopover` コンポーネントの実装（Radix UIやHeadless UIの使用を推奨、あるいは自作）。
2.  クリック時の表示制御。

### Phase 3: チャットボット連携
1.  `Rise PathConcierge` コンテキストに `openAndAsk(termId: string)` メソッドを追加。
2.  Popoverのボタンと連携。
3.  チャットボット側のプロンプトエンジニアリング（解説モードの実装）。

## 6. 将来の拡張性
*   **学習ログ連携**: どの単語を調べたかを記録し、「苦手単語リスト」を自動生成する。
*   **クイズ生成**: 調べた単語を使って、章末テストをAIが自動生成する。
