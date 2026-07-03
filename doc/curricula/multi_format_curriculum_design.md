# マルチフォーマット・カリキュラム・アーキテクチャ設計書

## 1. 目的
現在の「全チャプターがスライド形式」という一律的な構成を脱却し、学習内容（Topic）と学習者の性格（Big5）に応じて、最適な**「学習フォーマット（Learning Blocks）」**を動的に組み合わせるアーキテクチャを確立する。

例：「Blender入門」チャプターの場合
1. **Intro (Dialogue)**: キャラクター同士の掛け合いで興味付け
2. **Concept (Slide)**: 3D空間の概念を視覚的に解説
3. **Setup (Checklist)**: インストール手順をTODOリストで消化
4. **Practice (Quest)**: 「立方体を消す」等のハンズオン課題
5. **Review (Quiz)**: 理解度チェック

## 2. 新データ構造: `LearningBlock`
従来の `slides[]` 配列を廃止（または包含）し、多態性を持つ `blocks[]` 配列を導入する。

### JSON Schema Definition (Draft)
```typescript
type BlockType = 'slide_deck' | 'dialogue' | 'checklist' | 'quiz' | 'coding_quest';

interface Chapter {
  id: string;
  title: string;
  // ...既存メタデータ
  blocks: LearningBlock[]; // 複数のフォーマットが順に並ぶ
}

type LearningBlock = 
  | SlideDeckBlock 
  | DialogueBlock 
  | ChecklistBlock 
  | QuizBlock;

// A. 従来のスライド（視覚的解説）
interface SlideDeckBlock {
  type: 'slide_deck';
  slides: Slide[]; // 既存のSlide構造
}

// B. 対話・ポッドキャスト（聴覚的・文脈的）
// ★ Kokoro TTS: 発話行ごとに voice_id を指定し、合成後に結合
interface DialogueBlock {
  type: 'dialogue';
  characters: ['Rise Path', 'User' | 'Guest'];
  script: {
    speaker: string;
    text: string;
    voice_id?: string;  // e.g. jf_tebukuro (Rise Path), jm_kumo (Guest)
    emotion?: string;    // UI演出用。TTSには渡さない
  }[];
  audioUrl?: string; // 生成された音声ファイルへのパス
}

// C. チェックリスト・手順書（実用的・体系的）
interface ChecklistBlock {
  type: 'checklist';
  title: string;
  items: {
    id: string;
    label: string;
    description?: string; // 補足説明
    isCompleted: boolean; // ユーザーの状態保存用
  }[];
}

// D. クイズ・ソクラテス式問答（内省的・確認）
interface QuizBlock {
  type: 'quiz';
  question: string;
  options?: string[]; // 選択式の場合
  correctAnswer?: string;
  explanation: string; // 解説
  mode: 'selection' | 'reflection'; // 選択式か、思考を促すだけか
}
```

## 3. Big5に基づくブロック選択ロジック (AI生成戦略)

Geminiへのプロンプトにおいて、各セクションをどのブロックで表現するかをBig5スコアに基づいて決定させる。

| Big5 特性 | 推奨ブロック構成比率 | 理由 |
| :--- | :--- | :--- |
| **Openness (高)** | **Dialogue** (40%), **Slide** (Conceptual) | 概念的な議論や「なぜ？」という問いかけを好むため。 |
| **Conscientiousness (高)** | **Checklist** (50%), **Slide** (Structured) | 明確なゴール、ステップバイステップの手順、効率を好むため。 |
| **Extraversion (高)** | **Dialogue** (Talk show style), **Quiz** (Interactive) | 賑やかな雰囲気や、インタラクティブな反応を好むため。 |
| **Neuroticism (高)** | **Checklist** (Detailed), **Quiz** (Confirmation) | 不安を取り除くための詳細な手順と、理解を確認できる安心感を求めるため。 |
| **Agreeableness (高)** | **Dialogue** (Empathetic), **Slide** (Warm visuals) | 共感的なストーリーテリングや、優しいガイドを好むため。 |

## 4. UI実装イメージ

`LessonView.tsx` を改修し、`blocks` 配列をmapしてレンダリングする「Block Renderer」を実装する。

```tsx
// 概念コード
const LessonView = ({ chapter }) => {
  return (
    <div className="flex flex-col gap-8">
      {chapter.blocks.map((block, index) => {
        switch (block.type) {
          case 'slide_deck': return <SlideDeckViewer data={block} />;
          case 'dialogue':   return <PodcastPlayer data={block} />;
          case 'checklist':  return <InteractiveChecklist data={block} />;
          case 'quiz':       return <QuizCard data={block} />;
          default: return null;
        }
      })}
    </div>
  );
};
```

## 5. 開発ロードマップ

### Phase 1: データ構造の拡張とプロンプトエンジニアリング
- [ ] `types.ts` に `LearningBlock` 定義を追加。
- [ ] `geminiService.ts` のプロンプトを改修し、スライドだけでなく「対話」や「クイズ」もJSONに含めるよう指示。

### Phase 2: 新規ブロックのコンポーネント実装
- [ ] **Dialogue Block**: チャット風UI + 音声再生ボタン（Kokoro TTS 連携、行ごと合成→結合）。
- [ ] **Quiz Block**: 正解/不正解のアニメーション付きカード。
- [ ] **Checklist Block**: クリックで完了線が引けるシンプルなリスト。

### Phase 3: レンダリングエンジンの統合
- [ ] 既存の `GeneratedLessonView` を、ブロックベースのレンダリングに移行。

## 6. ユースケース例：Blenderコース「Chapter 1」

**ユーザー**: 誠実性が低く（飽きっぽい）、開放性が高い（好奇心旺盛）タイプ。

1. **Dialogue (Ice Break)**
   - Rise Path: 「さあ、今日から3Dの世界へ飛び込むわよ！準備はいい？」
   - User役: 「難しそうだけど...」
   - Rise Path: 「大丈夫、最初は粘土遊びと同じ。まずは画面を触ってみましょ！」
   - *（音声再生でラジオ感覚で聞かせる）*

2. **Checklist (Setup - Quick Win)**
   - [ ] Blender 4.0をダウンロード
   - [ ] 言語設定を日本語に変更
   - *（サクサク完了させて達成感を与える）*

3. **Slide (Visual Impact)**
   - タイトル: 「これが "神の視点"」
   - 画像: 3Dビューポートの各要素を強調した画像
   - *（視覚的なインパクトで惹きつける）*

4. **Quiz (Challenge)**
   - 「視点を回転させる魔法のボタンはどれ？」
   - [ ] 左クリック
   - [ ] マウス中ボタン (正解)
   - *（ゲーム感覚で知識を定着させる）*
