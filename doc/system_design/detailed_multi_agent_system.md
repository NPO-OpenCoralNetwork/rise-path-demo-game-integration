# マルチエージェント・システム詳細設計書: Rise Path Orchestrator

## 1. システム概要
本システムは、4つの専門エージェントをオーケストレートし、ユーザーの性格特性（Big5）に最適化された学習コンテンツを生成する。単一プロンプトの限界を超え、論理性、パーソナライズ、技術的正確性の3つを同時に担保する。

## 2. アーキテクチャ図

### 2.1 データフロー図
```mermaid
graph TD
    User[ユーザー要件 + Big5] --> Orch[Orchestrator]
    Orch --> Arch[Architect: 構造設計]
    Arch -- "Syllabus JSON" --> Styl[Stylist: パーソナライズ]
    Styl -- "Block Plan JSON" --> Creat[Creator: コンテンツ生成]
    Creat -- "Draft JSON" --> Crit[Critic: 検証・修正]
    Crit -- "修正指示" --> Creat
    Crit -- "承認済みJSON" --> DB[(Database / Frontend)]

    subgraph "Gemini API Layer"
        Arch -.-> G3P[Gemini 3.0 Pro]
        Styl -.-> G2F[Gemini 2.5 Flash]
        Creat -.-> G2F
        Crit -.-> G3P
    end
```

### 2.2 エージェント間インターフェース（データ型）

エージェント間は、厳密に定義されたJSONスキーマで通信する（Geminiの `responseMimeType: "application/json"` を活用）。

#### A. Syllabus Blueprint (Architect -> Stylist)
```json
{
  "topic": "Blender Basics",
  "learningObjectives": ["3D座標の理解", "基本操作の習得"],
  "essentialConcepts": [
    { "id": "coords", "title": "X/Y/Z軸", "dependency": null },
    { "id": "grab", "title": "Gキーでの移動", "dependency": "coords" }
  ]
}
```

#### B. Block Plan (Stylist -> Creator)
```json
{
  "personalityTarget": "Explorer",
  "sequence": [
    { "type": "quest", "id": "grab_exp", "logic": "先に触らせて好奇心を刺激" },
    { "type": "slide", "id": "coords_theory", "logic": "体験の後に理屈を補完" }
  ]
}
```

## 3. 各エージェントの技術仕様

### 3.1 Architect (Gemini 3.0 Pro)
*   **役割**: 教育学的な整合性の維持。
*   **制約**: 性格特性は一切考慮せず、「そのトピックを学ぶために欠かせない要素」を網羅することに集中する。

### 3.2 Stylist (Gemini 2.5 Flash)
*   **役割**: UXの最適化。
*   **戦略**: Big5の各スコアに基づき、ブロックの順序を動的に入れ替える。
    *   `High Openness`: 好奇心を煽る「問いかけ」や「抽象的メタファー」を増やす。
    *   `Low Conscientiousness`: 長いテキストを避け、短い「クエスト」に分割する。

### 3.3 Creator (Gemini 2.5 Flash)
*   **役割**: 高品質な執筆と読み上げ原稿（`speechScript` / `tts_script`）の生成。
*   **技術**: 箇条書きを自然な口語に整形し、Kokoro 向けに 50〜150 文字/スライドに収める。演技は `voice_id` 選択で表現する（5-Element Prompting は廃止）。

### 3.4 Critic (Gemini 3.0 Pro)
*   **役割**: ガードレール。
*   **監査項目**:
    1.  **事実確認**: Blender等のソフトウェアの操作方法は正確か？
    2.  **安全性**: 差別的、あるいは学習意欲を削ぐ表現はないか？
    3.  **フォーマット**: システムがパース可能な完全なJSONか？

## 4. エラーハンドリングと再試行 (Retry Strategy)
*   Criticがエラー（不合格）を出した場合、最大3回までCreatorに差し戻す。
*   差し戻し時には、Criticが具体的な「修正案」を提示し、Creatorがそれを反映する。
