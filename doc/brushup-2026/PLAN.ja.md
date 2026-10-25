# Rise Path ブラッシュアップ計画（PLAN.ja）

作成日: 2026-10-18 ／ 対象: このリポジトリ（`rise-path-demo-game-integration`。React 19 + Vite 6 + TS + Tailwind v4 ／ Express `server.js` :3006 ／ MCP `mcp-server/`）
根拠資料: [`research/`](research/) 配下の 8 レポート（+ critique.md）（code-content, code-llm, features, ui-shell, ui-lessons, research-apps, research-pedagogy, research-claude）と、各レポートのスクリーンショット
デザインモック（今回作成）: [`assets/mocks/sunrise-mock.html`](assets/mocks/sunrise-mock.html) / [`landing-mock.html`](assets/mocks/landing-mock.html)、スクリーンショット [`assets/mocks/dashboard.png`](assets/mocks/dashboard.png) / [`landing.png`](assets/mocks/landing.png)
読書画面のプロトタイプ: [`assets/mocks/reader-mock.html`](assets/mocks/reader-mock.html)（[`reader-desktop.png`](assets/mocks/reader-desktop.png) / [`reader-mobile.png`](assets/mocks/reader-mobile.png)）／ 改修前のスクリーンショット: [`assets/before/`](assets/before/)

ベースライン（2026-10-18 実測）: `npm run typecheck` は通過（16秒）、`npm test` は 333 件すべて通過、`vite build` は通過（45秒。ただし `PSchoolView` が 4.3MB、`GlossaryText` が 1.0MB のチャンクになっている）。

---

## 0. TL;DR

1. **良いところ:** 素材は良いです。Vibe Coding 12章は日英そろっていて、ほかに Unity 4章、Blender、Art、P-School、Kokoro TTS、19 ツールの MCP サーバー、Hermes エージェントがあります。
   **問題:** 見せ方・つなぎ方・安全性が壊れています。
   - 教材の表示部品（リーダー）が 7 種類バラバラです。
   - モバイルではすべての画面が崩れます。
   - Gemini の API キーがブラウザに配信されるコードに入っています。
   - 偽の数字が並んでいます。
   - 保存処理のうち 2 系統が、存在しない DB の列（カラム）に書き込んでいます。
2. **目指す姿:** 「AIと人がつくった教材を、日本語でいちばん気持ちよく学べるスタジオ」。中心は次の 3 つです。
   - **Lesson Reader**: 読む・確かめる・AI先生を、1 つの画面と 1 つの部品で提供する。
   - **教材フォーマットの統一**（`risepath.lesson/v1`）: Claude Code、MCP、アプリ内生成のどこで作っても同じ形式にし、検証・プレビュー・レビューを通す。
   - **Worlds**: Vibe Coding を旗艦トラックとし、P-School を手を動かす演習として位置づける。
3. **デザイン:** 「Sunrise Studio」。温かい紙色の背景に、操作用のインディゴ 1 色と、達成専用のアンバー（朝日）を組み合わせます。各トラックは本文エリアのアクセント色だけを変えます。和文フォントは Inter と Noto Sans JP を組み合わせ、日本語用の組版ルールを入れます。
4. **LLM 連携:**
   - LLM の呼び出しはすべてサーバー側の 1 つの窓口（`server/llm/` のゲートウェイ）にまとめます。Anthropic（`claude-opus-5-5`）、Gemini、Hermes、mock を切り替えられるようにします。
   - 出力は structured outputs で形式を固定し、zod で検証します。失敗したら 1 回だけ修復を試みます。
   - 生成物はすべて下書きとして保存し、自動では公開しません。
5. **このセッションで実装するもの:** WP-01〜WP-10（§9）。データベースも API キーも不要です。デザイントークン、アプリシェル、統一スキーマとバリデータ、LessonReader とリッチブロック、Claude Code 用キット、MCP 教材ツール、LLM ゲートウェイ、ダッシュボードとランディングの刷新、旧リーダーの安全化が対象です。

---

## 1. 現状診断サマリー

### 1.1 残すべき強み

| 強み | 根拠 | 活かし方 |
|---|---|---|
| 日英対訳の実教材がある | `data/curricula/vibe_coding/*.ts`（12章、1,883行）、`unity_ai/`（4章） | 新スキーマへ機械的に移行し、第1章を手で磨いて「お手本教材」にする |
| `DocChapter` / `LocalizedDocBlock` 型が良い出発点 | `types.ts:345-383` | `risepath.lesson/v1` の土台として、旧データとの互換を保つ |
| Blender の読書体験が最も良い | `BlenderLessonView.tsx`：ステップ目次、ホットキー表示、Before/After スライダー、進捗保存 | `steps` と `compare` ブロックの手本にする |
| 用語から AI に質問できる仕組みがある | `GlossaryText.tsx:59-75` が `open-rise-path-chat` イベントを発火する | 段落単位で AI先生 に質問する仕組みの起点にする |
| Art の「美術館」デザイン | `ArtIntroView.tsx`、`ArtPeriodDetailView.tsx` | リーダーの `museum` 表示バリアントにする |
| 学習基盤 | Kokoro TTS（`/api/v2/tts`）、MCP 19 ツール（`get-generation-kit`、`validate-intake` など）、Hermes、P-School（Phaser + Blockly） | 音声ナレーション、外部 LLM による教材制作、エージェント型コーチ、インタラクティブ演習に使う |
| テストとビルドの健全さ | 333 テスト通過、型チェック通過 | すべての作業パッケージ（WP）の受け入れ条件にする |

### 1.2 重大な問題（すべて実機・コードで確認済み）

| # | 問題 | 証拠 | 重要度 |
|---|---|---|---|
| 1 | モバイルで全画面が崩れる。390px 幅で本文が 163px に縮み、1 文字ずつ改行される | `components/common/Layout.tsx:280-284`（`fixed md:relative … relative` の最後の `relative` が `fixed` を上書き） | P0 |
| 2 | Gemini の API キーがブラウザ向けバンドルに埋め込まれる | `vite.config.ts:51-53` の `define`。ダミーキーでビルドすると `const envKey="SENTINEL_LEAK_123"` が出力された（`<session-scratchpad>/keyleak/`） | P0 |
| 3 | AI 生成 API に認証がなく、ユーザー ID の変数名も誤っている | `server.js:100`、`server/routes/ai.js:45,275`（`req.user?.id` と書かれているが、実際に設定されるのは `req.userId`） | P0 |
| 4 | 教材表示が壊れている（詳細は下の箇条書き） | `VibeChapterOneView.tsx:19-25`、`VibeDocView.tsx:41,218,665-770,750`、`.gitignore:34` | P0 |
| 5 | ナビゲーションが黙ってダッシュボードに戻る。Vibe・Unity・Blender のカードやデザインサンプル 7 項目が該当。ログアウトボタンも反応しない | `App.tsx:200-279` の `default` 分岐、`VibePathView.tsx:372`、`UnityPathView.tsx:234`、`BlenderCurriculum.tsx:126`、`Layout.tsx:485-500` | P0 |
| 6 | 偽のデータが表示されている | ダッシュボードの「今週 2.5h」「第3章75%」（`MissionControlDashboard.tsx:342,395,527,551,677,773`）、「¥4,500」（`MyContent.tsx:194`）、作り物の生成ログ（`server/routes/ai.js:172-177`）、中身が同じ定型文の水増しコース 10 本・72 レッスン（`services/curriculumApi.ts:27-78`） | P0 |
| 7 | 保存処理 3 系統のうち 2 系統が存在しない列に書き込む | `ai.js:153`、`tools/core/curriculum.js:248,274` が `curriculum_data` などに書き込むが、`001_core_curriculum.sql` にその列はない | P1（DB 導入時に P0） |
| 8 | 廃止済み・存在しないモデル ID を使っている | `text-embedding-004`（教材検索の埋め込み処理が全滅）、`gemini-2.0-flash`、存在しない `gemini-3.0-pro`（`services/geminiService.ts:101,150,554`） | P1 |
| 9 | 図表描画（Mermaid）に XSS の経路がある | `securityLevel:'loose'` で生成した SVG を `dangerouslySetInnerHTML` で埋め込んでいる（`GeneratedDocView.tsx:338,1577`、`VibeDocView.tsx:74,654`） | P0（外部 LLM の教材を受け入れる前提では必須） |
| 10 | デザインの一貫性がない（詳細は下の箇条書き） | `Layout.tsx:56-110`、`index.css:5-7`、`index.html:8`、`ExperienceLandingView.tsx:172` | P1 |
| 11 | 学習効果の仕組みが弱い。読書中の確認問題がなく、復習機能もない。AI チューターは今読んでいる教材を知らない | `FloatingChatbot.tsx:100-107` はタイムゾーンと言語しか送っていない | P1 |
| 12 | リポジトリが約 1.6GB と重い | Blender マニュアル HTML が 1.2GB / 5,243 ファイル、`public/` に画像コピー 244MB | P2 |

#4 教材表示の壊れ方:
- 日本語 UI なのに本文が英語で表示される（`VibeChapterOneView.tsx:19-25`、`VibeDocView.tsx:41`）。
- 表が消える。Vibe と Unity に表が 12 個あるが表示されない（`VibeDocView.tsx:665-770`）。
- スライドタブが全滅している。`*.pdf` が `.gitignore:34` で除外されているため。
- 番号付きリストに番号が出ない（`VibeDocView.tsx:750`）。
- どの章でも「CHAPTER 1」と表示される（`VibeDocView.tsx:218`）。

#10 デザインの一貫性のなさ:
- ロゴが 3 種類ある。
- 画面ごとに 5 種類のビジュアル言語がある。
- デザイントークンは `--font-serif` の 1 つだけ（`index.css:5-7`）。
- 色の直書き（hex）が 145 箇所、角丸が 15 種類ある。
- `text-slate-400` が 310 箇所あり、白背景とのコントラスト比は 2.56:1（AA 不合格）。
- 日本語フォントを読み込んでいない（`index.html:8`）。
- 日本語に疑似イタリックがかかっている（`ExperienceLandingView.tsx:172`）。
- ダークモード（`dark:`）とキーボードフォーカス表示（`focus-visible`）がどちらも 0 箇所。

### 1.3 問題の根本原因

1. **教材の形式が 9 種類、表示部品が 6〜7 種類、生成経路が 4 種類あり、互いに整合していない。** そのため、どこを直しても別の場所が壊れたまま残ります。
2. **画面遷移を `ViewState` の巨大な `switch` で管理している。** 対応のない値はすべてダッシュボード（`/`）へ送られます。
3. **デザイントークンがない。** 結果として、ページごとに色・角丸・文字サイズを手書きしています。
4. **LLM をブラウザから直接呼んでいる。** その結果、キーの漏洩、コストが見えないこと、不正なモデル ID が見過ごされることが起きています。

---

## 2. 競合リサーチの要点とポジショニング

### 2.1 競合比較（research-apps / research-pedagogy / ui-lessons より、2026年10月時点）

| サービス | 教材の見せ方 | AI チューター | 定着・継続の仕組み | Rise Path が取り入れるもの |
|---|---|---|---|---|
| Google Learn Your Way | 1 つの素材を Immersive Text / Slides & Narration / Audio / Mindmap で見せる。段落の横に「?」マーカーがあり、問題はサイドドロワーで出る（`competitors/lyw_inline_q.png`） | 素材に基づいて答える | 各セクションに「Take quiz to complete」。3日後の定着率は 78% 対 67% | 1 つのブロック列から表示形式を切り替える、段落の横に問題、確認問題をクリアしてセクション完了 |
| NotebookLM（Gemini Notebook） | 学習者自身の資料から学習ガイド・マインドマップ・音声概要を作る | 資料に基づいて答える | フラッシュカードとクイズ（進捗を保存） | 教材からカードを自動生成、出典の表示 |
| ChatGPT Study Mode / Gemini Guided Learning / Claude Learning mode | 対話型 | ソクラテス式で、答えではなくヒントを出す | クイズ | AI先生は既定でヒント優先。確認問題では 2 回挑戦するまで答えを言わない |
| Khanmigo | 演習と一体 | いま解いている問題を知っている | マスタリー（習熟） | チューターにレッスン ID・段落・選んだ答えを渡す |
| Brilliant（Koji） | 1 画面に 1 アイデア。インタラクティブな図 | 画面上で一緒に考える | レベル、連続記録 | Steps モード、ウィジェット登録の仕組み |
| Duolingo | 3〜5 分のレッスン | 会話の後にフィードバック | 連続記録（Streak Freeze で DAU が +0.38%） | 休んでも途切れにくい連続記録。ただしバッジやリーダーボードは効果の根拠が弱い |
| Scrimba / Boot.dev / Codecademy | レッスン内でコードを実行できる | Boot.dev の Boots は学習者のコードを見る | ステージ制 | `sandbox` ブロック、P-School のステージ連携 |
| Oboe | 1 つのプロンプトから約 9 形式のコースを作る | 対話で教える | 正確性チェック用のエージェント | 生成後の検証エージェント、実写の画像 |
| Progate（日本） | スライドの後にエディタ | — | 月額 ¥990 / ¥2,490 | 日本の初心者に慣れた導線。Claude Code や Codex を使う講座を始めており、Vibe Coding の直接の競合 |
| Schoo / Studyplus / スタディサプリ / Monoxer / paiza | ライブ授業、学習ログ、10 分レッスン、忘却に合わせた出題、スキルランク | — | — | 短いレッスン、学習ログ、忘却曲線に合わせた復習 |
| Anki（FSRS） | — | — | 目標保持率 0.9 で復習時期を最適化 | 復習キューのスケジューリング方式 |

**教育研究から得た原則:**
- **確認テストと分散学習**は、効果が高いと評価された唯一の 2 手法です（Dunlosky 2013）。
- **AI に答えを丸投げすると試験成績が下がります。** 制限のない GPT-4 では試験成績が 17% 低下し、ガードレール付きのチューターでは悪影響がありませんでした（Bastani, PNAS 2025）。
- **教授法を組み込んだ AI チューターは、アクティブラーニング授業の約 2 倍の学習効果**を示しました（Kestin 2025）。
- **「学習スタイルに合わせる」ことには根拠がありません**（Pashler 2008）。Big5 の結果は「学習スタイル」ではなく、チューターの口調・ペース・声かけに使うべきです。

### 2.2 ポジショニング：Rise Path は何になるべきか

> **「AIが“答え”ではなく“教材”をつくる。読む・確かめる・聞く・つくるが 1 つのリーダーで完結する、日本語ファーストの学習スタジオ」**

**学習者向けの約束:**
- 1 行約 38 字の読みやすい日本語組版で読めます。
- 段落ごとに AI先生 に質問できます。AI先生 はすぐに答えを言わず、ヒントから一緒に考えます。
- 2 セクションごとに確認問題があり、間違えた所は復習カードになります。

**作り手（教育者・クリエイター）向けの約束:**
- Claude Code、ChatGPT、Gemini のどこで書いても、同じスキーマで検証・レビュー・プレビューを通り、そのまま公開前レビューに進めます。

**旗艦トラックは Vibe Coding** です。各章を「ストーリー → 概念 → 確認 → Claude Code でのミッション」で構成します。Progate の AI 駆動開発講座に対して差別化できる唯一の領域です。

**やらないこと:**
- 「プロンプト 1 つで講座を自動生成」を主役にしない。今やどこでも無料でできます。作り手の下書き支援に格下げします。
- Big5 で学習スタイルを最適化すると謳わない。
- 学習者にモデル名やエンジン名を見せない。
- バッジの壁やリーダーボードを作らない。

---

## 3. 足す機能 ／ 削る機能 ／ 統合する機能

### 3.1 足すべき機能

| 機能 | 理由 | 優先度 |
|---|---|---|
| 統一教材スキーマ `risepath.lesson/v1` とバリデータ（検証 CLI） | 9 種類の形式を 1 つにまとめ、どの作成経路でも同じ検証を通すため | P0 |
| LessonReader（1 つのリーダー、目次、進捗、続きから読む、次のレッスン） | 7 つのリーダーの統合、現在地の明示、モバイル対応 | P0〜P1 |
| 読書中の確認問題「確認しよう」（選択肢ごとの解説、ヒント、再挑戦） | 確認テストの効果が最も高いため（Dunlosky、Learn Your Way） | P1 |
| 学習目標カード、まとめ、終了ブロック | 学習目標と確認問題の対応づけ、復習の起点 | P1 |
| コードのハイライト、コピー、`prompt` ブロック | Vibe Coding の主役である「AIへの指示文」をきちんと見せるため | P1 |
| 段落アンカー付きの AI先生（ソクラテス式） | 教材の文脈を知ったチューターが最も効果的だから | P1〜P2 |
| 正直な進捗（既読・回答済み・習熟）と再開機能 | 偽の進捗を廃止するため | P1 |
| FSRS による復習キュー（「今日の復習 n 枚」） | 分散学習の仕組み。現状は存在しない | P2 |
| ブロックから自動で作るスライドとナレーション（Kokoro） | PDF に依存したスライドが全滅しているため | P2 |
| 練習モード（間違えた問題だけ解き直す） | 確認テストの集約 | P2 |
| Claude Code 用の制作キット（skill、subagent、hook、プレビュー） | 差別化の核 | P0〜P1 |
| スキーマ付きの MCP 教材ツール（`lesson-*`） | ChatGPT・Gemini・Cursor からも同じ品質の教材を作れるようにするため | P1 |
| サーバー側 LLM ゲートウェイ（Anthropic、Gemini、mock、Hermes） | キー漏洩の根絶、構造化出力、モデル切り替え、コスト管理 | P0〜P1 |
| デザイントークン、日本語組版、フォーカスリング、ダークモード | 一貫性、可読性、アクセシビリティ | P0（ダークモードは P2） |
| モバイル用の下部バーとボトムシート | 現状、モバイルでは何も使えないため | P1 |
| HTML/JS サンドボックス、その後 Python（Pyodide） | 手を動かす学習。コードの実行機能は現在どれも偽物 | P2 / P3 |
| P-School のステージへのリンクブロック | 根拠のあるゲーム要素（ステージ制） | P3 |
| MCP Apps によるプレビュー（`ui://`） | Claude や ChatGPT の中で教材を表示できるようにするため | P3 |

### 3.2 削るべき機能

| 対象 | 理由 | 優先度 |
|---|---|---|
| サイドバーの「デザインサンプル」（7 項目） | 開発用の残骸。開いてもダッシュボードに戻る。代わりに `/dev/blocks` を作る | P0 |
| ダッシュボードの偽データ、赤い未読ドット、「¥4,500」、作り物の生成ログ、「Gemini 3.0 Pro」バッジ、学習者向けのモデル選択 | 信頼を損なうため | P0 |
| ブラウザ側の Gemini 呼び出し、ユーザー入力の API キー保存 UI、`vite.config.ts` の `define` | キーが漏洩しているため | P0 |
| ランディングの疑似科学的なコピー（「Neuro-Adaptive v2.0」「ミリ秒単位」「Cognitive Fingerprinting」）と、何もしない「デモを見る」 | 誇大表示だから | P0 |
| FR の選択肢（翻訳が完成するまで） | FR を選んでも英語が表示されるため（`LanguageContext.tsx:27`） | P0（非表示にする） |
| 12 個の `VibeChapter*View` ラッパーと `VIBE_CHAPTER_*` の `ViewState` | 移行後は不要 | P1 |
| PDF スライドと `react-pdf` | 動いていない。ブロックから生成するスライドで置き換える | P1 |
| 用語の全文自動リンク（Unity の用語が数学の教材にもリンクされる） | 誤ったリンクとノイズ。`[[term]]` 記法とコース単位の用語集に置き換える | P1 |
| 水増しコース 10 本 | 定型文の使い回しだから | P1（オーナー判断） |
| どこからも使われていないコード：`GeneratedLessonView`、`RisePathConciergeView`、`LoginView`、`LoginModal`、`LandingView`、`StatsCard`、`ProfilePlaceholder` | 死んだコード | P1 |
| 英語学習アプリの名残：`/library`、`/course/:id`、`/lesson/:id` | 別プロダクトの残骸 | P2 |
| `ai-personal-insights-pro/`、`ai-learning-diagnosis/` | 古いサブアプリ（3 ファイルを移した後で削除） | P2 |
| 生成プロンプトのブロック数ノルマ、「人は視覚学習者」という前提、雑学的なフック | 学習研究に反するため | P1 |
| 各ページにある個別の言語切り替え | サイドバーと重複している | P1 |
| Blender マニュアル 1.2GB の git 管理 | 重いため | P2（オーナー判断） |

### 3.3 統合すべき機能

| 統合元 | 統合先 | 優先度 |
|---|---|---|
| `VibeDocView`、`GeneratedDocView`、`MultiFormatLessonView`、`BlenderLessonView`、HTML/CSS ビュー | **LessonReader** と共通のブロック登録の仕組み（Art は `museum` バリアントとして） | P1〜P3 |
| 教材の形式 3 種類（`BLOCK:@@@` 形式、DocChapter JSON、MCP 用のフラットな形式）と保存経路 3 系統 | `risepath.lesson/v1` と 1 つの `saveDraft()` | P1 |
| `/learning-hub`、`/courses`、`/profile/generated` | `/learn`（ライブラリ） | P2 |
| コース生成、マイコンテンツ、生成物、MCP の下書き | 「つくる」ハブ（下書きの受信箱と JSON 取り込み） | P2 |
| AI 診断、Learning Mirror、AI キャラクター | プロフィールの「タイプ」タブ | P2 |
| フローティングチャットボット | 文脈を知る `AskAI` サイドシート（レッスン中は LessonBar から呼び出す） | P1〜P2 |
| P-School 独自の XP | アプリ共通の XP | P3 |

---

## 4. デザイン方針

### 4.1 ビジュアルの方向性：「Sunrise Studio」

- **コンセプト:** 朝の光が入る書斎。温かい紙色（`#F7F7F4`）に墨色の文字。操作はインディゴ 1 色、達成（連続記録・XP・バッジ）にはアンバーの「朝日」だけを使います。ブランド名 Rise Path の「上る道」と「朝日」をロゴにします（モックの `BrandMark`：上っていく線と太陽の点）。
- **なぜこの方向か:** ui-shell の 3 案から A（Calm Studio）と Worlds の組み合わせを選びました。
  - B（Night Lab、ダーク基調）は日本語の長文が読みにくく、現行ランディングの誇大な印象を引きずります。
  - C（Quest Path、ゲーム的）は、主な対象である大人の学習者には合わず、効果の根拠も弱いです。
- **Worlds:** トラックごとの世界観は本文エリアの `data-world` のアクセント色（とアートワーク）だけで表現します。シェル、目次、進捗、確認問題、AI先生は全トラック共通です。暗い世界観（Vibe、Sonic、P-School）は、明るい枠の中に暗いパネルを置くのではなく、そのページ全体をダークテーマにします（Phase 2）。
- **目標の見た目:** `shots-before/extra/design/dashboard-desktop.png`（ホーム）、`landing-desktop.png`（ランディング）、`shots-before/extra/lessons/mock-desktop-1.png`（リーダー）。

### 4.2 デザイントークン（`styles/tokens.css`。テキストの組み合わせはすべて WCAG AA を確認済み）

| トークン | ライト | ダーク | 用途 |
|---|---|---|---|
| `--rp-canvas` | `#F7F7F4` | `#0D0D12` | アプリ背景 |
| `--rp-surface` | `#FFFFFF` | `#15151C` | カード、サイドバー |
| `--rp-sunken` | `#F0F0EB` | `#1C1C25` | 凹んだ領域、統計タイル、コード背景 |
| `--rp-border` | `#E4E4DE` | `#2A2A35` | 区切り線（装飾） |
| `--rp-border-strong` | `#8A8A96` | `#62626F` | 入力欄・チェックボックスの枠（3:1 以上） |
| `--rp-fg` / `-fg-2` / `-fg-3` | `#16161D` / `#454552` / `#676774` | `#ECECF1` / `#B6B6C2` / `#8C8C9A` | 本文 / 補助 / キャプション（`slate-400` の代わり。5.6:1） |
| `--rp-primary`（hover） | `#4F46E5`（`#4338CA`） | `#8C86FF`（`#A29DFF`） | 操作、リンク、フォーカス |
| `--rp-on-primary` | `#FFFFFF` | `#0D0D12` | primary の上の文字 |
| `--rp-primary-soft` / `-text` | `#EEF0FF` / `#4338CA` | `#23224A` / `#A9A4FF` | 選択中のナビ、淡いチップ |
| `--rp-sun` / `-soft` / `-text` | `#F59E0B` / `#FFF4DB` / `#A34A06` | `#FBBF24` / `#2E2410` / `#FBBF24` | **達成専用**（XP、連続記録） |
| `--rp-success` / `danger` / `info` | `#137A3A` / `#B91C1C` / `#0369A1` | `#4ADE80` / `#F87171` / `#38BDF8` | 状態表示 |
| `--rp-focus` | `#4F46E5` | `#A9A4FF` | フォーカスリング |

**World アクセント（`[data-world=…]` の `--world-accent`）:** art `#B4532A`、vibe `#22C55E`、unity / ai `#8B5CF6`、sonic `#06B6D4`、pschool `#F97316`、blender `#EA7600`、web `#0EA5E9`

**タイポグラフィ:**
- 書体は 4 系統に絞ります。
  - Sans: `"Inter","Noto Sans JP","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",system-ui`
  - 読書用（Aa 設定で選べる UD フォント）: `"BIZ UDPGothic","Noto Sans JP"`
  - Serif（Art と引用だけ）: `"Newsreader","Noto Serif JP"`
  - Mono（コードだけ）: `"JetBrains Mono"`
- **Playfair はシェルから外します。**

| 段階 | サイズ / 行送り（英語） | 日本語の行間 | ウェイト | 用途 |
|---|---|---|---|---|
| display | 40 / 48 | 1.35 | 700 | ヒーロー |
| h1 | 30 / 38 | 1.4 | 700 | ページタイトル |
| h2 | 22 / 30 | 1.45 | 700 | セクション |
| h3 | 18 / 26 | 1.5 | 600 | カードタイトル |
| body-lg | 17 / 28 | 1.85〜1.9 | 400 | 教材本文 |
| body | 15 / 24 | 1.75 | 400 | 通常の UI |
| small | 13 / 20 | 1.6 | 400〜500 | メタ情報 |
| caption | 12 / 16 | 1.5 | 500 | 最小サイズ（**12px 未満は禁止**） |

**日本語の組版ルール（`:lang(ja)`）:**
- 本文: `line-height:1.75`（教材本文は 1.9）、`letter-spacing:.02em`、`line-break:strict`
- 見出し・ボタン・目次: `font-feature-settings:"palt"`、`word-break:auto-phrase`、`text-wrap:balance`
- 和文の斜体は禁止（`em, i` は `font-style:normal; font-weight:600` にする）
- 大文字化と広い字間は日本語に適用しない（overline は和文では字間 0）
- 数値は等幅数字（`.tabular`）
- 1 行の長さ: 教材は `max-width:40em`（日本語 36〜40 字、英語で約 70 字）

**寸法・角丸・影・動き:**
- 余白: 4px 単位（0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80）
- ページの左右余白: 16px（モバイル）、24px（640px 以上）、32px（1024px 以上）
- コンテンツ幅: 読書 720px、フォーム 640px、ページ 1200px、ワイド 1440px
- シェル: サイドバー 248px、折りたたみ時のレール 64px、上部バー 56px、モバイルの下部バー 64px + セーフエリア
- 角丸: `6 / 10 / 14 / 20 / full` の 5 種類だけ（チップ / ボタン・入力欄 / カード / ヒーロー・モーダル / ピル）
- 影: 3 段階（`--shadow-1/2/3`）。ダークモードでは、影の代わりに面の明度（surface → sunken → `#22222C`）と枠線で高さを表す
- フォーカス: グローバルな `:focus-visible { box-shadow: 0 0 0 2px var(--rp-surface), 0 0 0 4px var(--rp-focus) }`
- 動き: 120ms / 200ms / 320ms、`cubic-bezier(.22,.61,.36,1)`。ページ遷移は不透明度と 4px のスライドだけで、拡大縮小はしない。`prefers-reduced-motion` を尊重する

**Tailwind v4 との接続（`index.css`）:**
- `@theme inline` で `bg-canvas`、`bg-surface`、`bg-sunken`、`text-fg`、`text-fg-2`、`text-fg-3`、`border-line`、`border-line-strong`、`bg-primary`、`bg-primary-soft`、`text-primary-text`、`text-sun-text`、`bg-sun-soft`、`text-world`、`rounded-sm/md/lg/xl`、`shadow-1/2/3`、`font-sans/serif/mono` を生成する。
- `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))` を定義する。
- 既存コンポーネントは白背景を前提に書かれているため、**OS 設定（`prefers-color-scheme`）による自動ダークモードは、当面リーダー内だけに適用します。** アプリ全体への適用は Phase 2 です。

### 4.3 コンポーネントの原則（10 か条）

1. 1 画面の主要な操作（primary ボタン）は 1 つ。アンバーは達成表示にしか使わない。
2. `components/` で色の直書き（`[#hex]`）、`rounded-[…]`、`text-[9-11px]`、`text-slate-400` を新たに使うことを禁止する（Phase 2 で lint 化）。
3. 共通部品を使う。
   - ページ見出し、カード、空状態、進捗: `PageHeader`、`CourseCard`、`EmptyState`、`ProgressCluster`
   - 一覧行、ボタン、AI への質問: `ListRow`、`Button`、`AskAI`
4. 実データだけを見せ、ゼロ状態には励ましの文言を出す（例:「今日の1レッスンで連続記録スタート」）。
5. AI は本文を覆わない。本文の横（余白パネル）か下（ボトムシート）に出す。浮遊ボタン（FAB）と偽の未読ドットは廃止する。
6. 色だけで意味を伝えない（アイコン + テキスト）。タッチ領域は 44px 以上、最低 24px。
7. 全トラックで同じ目次、進捗、確認問題、AI先生を使う。トラックごとに変えるのはアクセント色だけ。
8. 教材内の画像は「教えるもの」だけにする（スクリーンショット、図解、比較）。装飾画像は表紙 1 枚まで。
9. モデル名やエンジン名を学習者に見せない。
10. 文言は日英で 1 つの辞書から引く。FR は辞書が埋まるまで隠す。

---

## 5. 教材表示（Lesson Reader）の理想設計

### 5.1 原則

- **1 つのリーダーで多くの世界観。** 全トラックで同じ部品を使い、アクセント色だけを変えます。
- **主役は教材、AI は補助。**
- **確認は読書の流れの中で行う。** 2 セクションに 1 回以上の確認問題を置きます。
- **いつも現在地がわかる。** パンくず、目次の状態表示、進捗、再開、次のレッスンを用意します。
- **日本語ファースト。**
- **ブロックは契約付きの部品にする。** そのため、Claude Code・MCP・Gemini のどこで作った教材も同じように表示でき、lint で検証できます。

### 5.2 デスクトップ（1280px 以上）

```
┌────┬──────────────────────────────────────────────────────────────────────────────────┐
│ R  │ ←  Vibe Coding › 第1章 最低ライン   [読む|スライド|練習 1/3]   ◔38%   Aa   ✦AI先生 │ LessonBar 56px（main内でsticky、サイドバーに被らない）
│ ▢  │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ 3px 読書進捗ライン（world accent） ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│
│ ▣  │ このレッスン·15分     │ モジュール1·レッスン1                   │ ┌ ✦ AI先生 · この段落 ┐ │
│rail│ ✓ 1-1 3層の関係       │ 第1章｜人間が理解すべき最低ライン         │ │ ▌引用された段落      │ │
│64px│ ● 1-2 UIとAPI         │ AIに指示を出すために…                   │ │ Q/A（ヒント優先）    │ │
│    │ ! 確認しよう 未回答   │ ⏱15分 · 初級 · 前提: 第0章              │ │ [簡単に][別の例]     │ │
│    │ ○ 1-3 デプロイ        │ ┌ このレッスンでできるようになること ┐  │ │ [クイズ][カードにする]│ │
│    │ ○ まとめ              │ └──────────────────────────┘  │ └─────────────────┘ │
│    │ ┌ 次: 第2章 ┐         │ 02 UIとAPI                             │ ┌ 用語 · このコース ┐  │
│    │ └─────────┘         │ ¶ 本文 17px / 行間1.9 / 40em   [✦]←hover │ │ API …             │  │
│    │ outline 232px sticky  │ ┌ 🏷 たとえるなら ┐ ┌ 図2-1 + 説明 ┐     │ └────────────┘  │
│    │                       │ ┌ prompt.md [{{目的}}] [コピー][Claude Codeで使う] ┐ │ margin 300px     │
│    │                       │ ┌ ◎ 確認しよう 1/3 ─ 選択肢1-4 ─ ヒント ─ 再挑戦 ┐ │                   │
│    │                       │ … まとめ · 自己評価 · 復習カード追加 · 次のレッスン → │                   │
└────┴──────────────────────────────────────────────────────────────────────────────────┘
```

画面幅による切り替え:
- 1024〜1279px: 目次は LessonBar の「目次 2/6」プルダウンに、余白パネルは右ドロワー（420px）にします。
- 1024px 未満: 本文 1 カラムだけにします。

### 5.3 モバイル（768px 未満）

```
┌──────────────────────────────┐
│ ←  第1章 最低ライン      ◔38% │ 52px（アプリ側のモバイルヘッダーは隠す）
│▔▔▔▔▔▔▔▔ 進捗ライン              │
│ タイトル 26px / 目標(折りたたみ) │
│ ¶ 16.5px / 行間1.85 / 余白16px │ 段落を長押しすると [AI先生に聞く][コピー][メモ][カードにする]
│ ┌ code (横スクロール) [✦][⧉] ┐ │
│ ┌ ◎ 確認しよう（44pxの選択肢） ┐ │
├──────────────────────────────┤
│ ‹前へ  ☰目次  ✦AI先生  ◎練習  次へ› │ 60px + safe-area。押すとボトムシート（85%）
└──────────────────────────────┘
```

### 5.4 ブロックライブラリ（`risepath.lesson/v1`）

lint ルールは `lessons:lint` が機械的に検査します。

| ブロック | 見た目と操作 | lint ルール |
|---|---|---|
| `objectives`（レッスンの項目） | 冒頭のカード「このレッスンでできるようになること」。終了時にもう一度確認する | 2〜4 個。観察可能な動詞で書く（説明できる / 書ける / 見抜ける） |
| `markdown` | 段落、インラインコード、リンク、`[[用語]]`。ホバーで ✦ を表示 | 1 段落 160 字以内（日本語） |
| `callout`（tip / warning / info / analogy / pitfall / note / success） | アイコン列 + 本文と同じサイズの文字。見出しを大文字化しない | 1 セクションに 2 個まで。たとえ話は正式な定義より前に置く |
| `list`（bullet / number / check） | 本物の `ol` / `ul` | 7 項目以内 |
| `definitions` | `dl` を grid で並べる。用語は折り返さない | 「ラベル：説明」形式のリストはこちらに置き換える |
| `table` | 1px の罫線、キャプション、モバイルでは先頭列を固定 | 6 列以内 |
| `code` | ファイル名・言語・[✦説明][コピー]、Shiki ハイライト、強調行、25 行を超えたら折りたたむ | `filename` 推奨。インラインは 25 行以内 |
| `prompt` | 入力欄風のカード。`{{変数}}` を編集できるチップにして、[コピー][Claude Codeで使う] ボタン、「期待される結果」の開閉 | AI への指示文の例は必ずこのブロックで書く |
| `diagram`（mermaid） | キャプション「図n」、`securityLevel:'strict'`、ラベル 13px 以上、拡大、文章による説明 | ノード 12 個以内、`caption` と `alt` 必須 |
| `image` | 最大高さ 420px、キャプション、ライトボックス | `alt` 必須。装飾画像は表紙だけ |
| `quiz`（inline = 確認しよう / exam） | 選択 → 送信 → 不正解なら選んだ選択肢への解説 + ヒント + 再挑戦 → 2 回目で答えと解説（中立的な色）。1〜4 キーで操作、`aria-live` | 2 セクションに 1 個以上。誤答の選択肢それぞれに `feedback`。`objectiveId` |
| `flashcards` | めくれるカード、[覚えた / もう一度] → 復習キュー | 1 レッスン 4〜8 枚 |
| `steps` | 番号付きのレール、`kbd` チップ、期待される結果、「うまくいかない？」の開閉、完了チェック | 1 ブロック 8 ステップ以内。各ステップに期待される結果 |
| `checklist` | 達成数 n/m、状態を保存 | — |
| `summary` | 「まとめ」3〜5 点 | 最後のセクションに必須 |
| `askTutor` | 「よくある質問」チップ → AI先生 | 任意 |
| （Phase 2 以降）`compare`、`codeTabs`、`terminal`、`sandbox`、`dialogue`、`reflection`、`exercise`、`gameLink`、`mindmap` | 比較スライダー（Blender から）、実行環境、誤解を正す会話、P-School への連携 | — |

### 5.5 モード

モードは「1 つのブロック列を 3 通りに見せる」もので、表示位置を共有します（`?mode=read|slides|practice#b-<id>`）。

- **読む:** 正式な表示です。確認問題を本文中に置きます。
- **スライド:** 自動生成します。セクションごとの表紙に加え、`slide !== false` の図・コード・たとえ話・まとめ・確認問題を 1 枚ずつ並べます。ナレーションは `block.narration`、なければ本文から Kokoro TTS で作ります。手作りのデッキがあればそれを優先し、PDF は廃止します。
- **練習:** 全部の確認問題、フラッシュカード、試験問題を集め、「間違えたものだけ」解き直せるようにします。
- **（後日）聴く:** 連続ナレーションに合わせて本文をハイライトします。

### 5.6 進捗モデル

**ブロック単位で記録すること:**
- `seen`: 60% 以上が 1.5 秒以上見えた
- `answered`
- `correctFirstTry`
- `done`

**レッスンの状態遷移:** `not_started` → `in_progress` → `read`（必須ブロックの 90%）→ `checked`（確認問題をすべて回答）→ `mastered`（試験 80% 以上）

**再開:** `lastBlockId` を保存します。

**保存先:**
- 当面: localStorage（すべて try/catch で囲む）
- Phase 2: `/api/v2/user/progress`

**XP:** `checked`・`mastered`・サンドボックス合格のときだけ付与します。スクロールでは付与しません。

### 5.7 インラインの AI先生

**入口:**
- 段落の ✦
- コードの「✦説明」
- 誤答の解説にある「なぜ？をAIに聞く」
- 用語ポップオーバー
- LessonBar の「✦AI先生」

**送る情報:**
```ts
{ message, lesson:{courseId, lessonId, title, objectives, level},
  anchor:{sectionId, blockId, blockType, excerpt(≤1,500字), codeLang?, highlightedLines?},
  learner:{attemptsOnBlock?, chosenOptionId?, questionId?, answerShown?}, mode:'explain'|'socratic' }
```

**振る舞い:**
- 確認問題とサンドボックスでは、2 回挑戦するまで答えを言いません（ソクラテス式）。
- 既定の回答は 120 字程度で、「詳しく」で展開します。
- レッスンの範囲外のことは「範囲外ですが…」と明示します。
- 回答の根拠をブロック ID で示します（「根拠: §2」のチップを押すと本文がそこへスクロールする）。
- 「カードにする」で回答をフラッシュカード化できます。

### 5.8 Aa 設定とレッスンの終わり

**Aa 設定:**
- 文字サイズ S / M / L（15 / 17 / 19px）
- 書体: 標準 / UD
- 行間: 標準 / ゆったり
- テーマ: ライト / セピア / ダーク（リーダー内だけ）
- 集中モード（F キー）

**終了ブロック（教材に書かなくても自動で出る）:**
- まとめ
- 学習目標ごとの自己評価（まだ不安 / だいたいOK / 説明できる）
- 「復習カード n 枚を追加」
- 次のレッスン

---

## 6. LLM 連携アーキテクチャ

### 6.1 構成

```
Browser ──(apiFetch, JWT/guest)──► /api/v2/llm/*  (optionalAuth + aiLimiter + zod body)
                                      │
                               server/llm/index.js  createGateway()
                 ┌──────────────┬─────┴──────┬──────────────┬─────────────┐
            anthropic.js     gemini.js     openai.js(P2)   hermes.js      mock.js
           (@anthropic-ai/sdk) (@google/genai)            (agent runtime) (no-key dev/test)
                                      │
            structured.js（zod検証 → 1回修復） / budget.js（llm_calls台帳, P2） / prompts/*
```

- **リクエストの形:** `{task, userId, system, messages, schema?, locale, signal, override?}`
- **イベントの形:** 正規化した `text.delta`、`usage`、`done`、`error`
- **モデル ID は `server/llm/models.config.js` だけに書きます。** タスクごとの割り当ては環境変数 `LLM_TASK_<TASK>=provider:model` で上書きできます。

### 6.2 タスクとモデルの対応（既定値。環境変数で変更可）

既定は品質優先で `claude-opus-5-5`（$4 / $20 per MTok）に統一し、深さは effort で調整します。

| タスク | 既定 | effort | 備考・代替案（コストと速度はオーナーが判断） |
|---|---|---|---|
| `course.outline` | anthropic `claude-opus-5-5` | high | 計画の質を重視。出力は小さい |
| `lesson.author` | anthropic `claude-opus-5-5` | medium | 1 レッスンにつき 1 呼び出し、ストリーミング + `finalMessage()` で切り詰めを防ぐ |
| `lesson.judge`（13 項目のルーブリック） | anthropic `claude-opus-5-5` | medium | 代替: `claude-sonnet-5-5`（$2 / $10）を審査役に |
| `tutor.chat` | anthropic `claude-opus-5-5` | low | 速度が問題なら `claude-haiku-5-5`（$0.10 / $0.50）か `gemini-3.8-flash` |
| `writing.feedback` / `assessment.insight` | anthropic `claude-opus-5-5` | low | 現在ブラウザで行っている呼び出し 3 つを置き換える |
| `lesson.translate` | anthropic `claude-opus-5-5` | low | 一括処理は Batch API（半額）。代替: Haiku 5.5 |
| `embed` | gemini `gemini-embedding-001`（768 次元） | — | `text-embedding-004` は廃止済みのため全件を再埋め込みする |
| `image` | gemini `gemini-3-pro-image` | — | 生成は公開時に 1 回だけ。読むたびに生成しない |
| `agent.*` | hermes | — | ツールを使うコーチとして残す |
| （キーがない場合） | `mock` | — | 開発・テスト・デモ用。スキーマ通りの決まった出力を返す |

**Anthropic 側の実装要点（claude-api skill 2026-10 版で確認）:**
- **JSON 出力:** `client.messages.parse({ output_config:{ format: zodOutputFormat(Schema), effort } })` を使います。
  - 古い `output_format` は使いません。
  - 再帰スキーマ、`minLength`、数値制約は使えません。LLM 用のスキーマは再帰なし・`anyOf` で作り、細かい制約は zod 側で検証します。
- **長い出力:** `client.messages.stream(...)` に `.finalMessage()` を組み合わせます（`max_tokens` は 64k 前後）。
- **Opus 5.5 の思考とツール指定:** 思考は無効化できません（`budget_tokens` も 400 エラー）。effort の既定値は `medium` なので、明示的に指定します。ツールの強制指定（`tool_choice` の `any` / `tool`）は 400 エラーになるので、structured outputs を使います。
- **プロンプトキャッシュ:** `system` の固定部分（スタイルガイド、スキーマ、お手本教材）に `cache_control:{type:'ephemeral'}` を付けます。可変の値（日時や ID）は後ろに置きます。`usage.cache_read_input_tokens` で効いているかを確認します。
- **拒否への対応:** 応答を読む前に `stop_reason` が `refusal` / `max_tokens` かどうかを判定します。サーバー側のフォールバックとして `fallbacks:"default"` とベータ `server-side-fallback-2026-07-01` を既定で付けます（beta クライアント経由）。
- **引用（citations）と structured outputs は同時に使えません**（400 エラー）。そのため、チューターの「根拠: §2」は citations 付きのテキスト応答で実装し、JSON 出力とは分けます。
- **zod のバージョン:** 現在入っている `zod@3.25.76` には `zod/v4` が同梱されています。SDK（0.135）の peer 依存は `^3.25 || ^4` です。`@anthropic-ai/sdk/helpers/zod` が受け付ける import が合わない場合は、`z.toJSONSchema()` で作った JSON Schema を `output_config.format` に直接渡し、検証は自前の zod で行います。

**Gemini 側の実装要点:**
- `systemInstruction` は `config` の中に書きます（`geminiBackendService.js:326,372,601` は外に書いていて無視されています）。
- `responseMimeType:'application/json'` と `responseJsonSchema` で JSON 出力を固定します。
- `abortSignal` と `httpOptions.timeout` を設定します（現在の `timeout` 指定は SDK のオプションに存在しません）。
- `new GoogleGenAI({apiKey})` の形で生成します（`ragService.js:24` の形は誤り）。

### 6.3 生成パイプライン（`/ai/generate` の内部を置き換える。3 ステップの承認 UX は残す）

1. 要件整理（会話履歴付き。「修正」で元の要求が消えるバグもここで直す）
2. アウトライン（学習目標・Bloom レベル・前提・所要分数）
3. レッスンごとの生成（同時実行 3、ストリーミング）
4. zod 検証。失敗したら 1 回だけ修復を試みる
5. `lint`
6. ルーブリックで審査（平均 3.3 以上、全項目 3 以上）
7. 弱い項目だけ 1 回修正
8. **下書きとして保存**（`curriculum_versions.content_json`）
9. 翻訳は別工程
10. 人が公開する

進捗表示は実際のイベント（SSE）で出し、作り物のログは廃止します。

### 6.4 セキュリティ修正（優先順）

1. `vite.config.ts` の `define` を削除し、ブラウザ側の Gemini 呼び出しとキー入力 UI をなくす。キーはすぐにローテーションする。
2. `/api/v2/ai` に `requireAuth` を付け、`req.userId` を使う。日次上限はロードマップ生成とカリキュラム生成の段階にも適用する。
3. Mermaid は `strict` にする（さらに SVG をサニタイズする）。教材内の生 HTML は禁止する（react-markdown を `skipHtml` で使う）。
4. `/api/generate-audio` に認証を付け、ファイルパスを検証する。CORS は許可リスト方式にし、ボディ上限を 50MB から 2MB にする（アップロードは別途）。エラーメッセージを外部にそのまま返さない。
5. 学習者プロファイルの所有者チェック（`chatgptCurriculum.js:89,160,245,653`）、トークンの定数時間比較、MCP ツール登録を既定で拒否する方式に変更（`isToolAllowed` は済み、未登録ツールの扱いを確認する）。
6. ユーザーの文章やアップロード資料をプロンプトに入れるときは、区切りタグで囲み、「指示ではなくデータ」と明示する。
7. 生成物は常に下書きにする。公開は人のレビューを経た後だけ。

### 6.5 コストと観測

- **P2:** `llm_calls` 台帳にプロバイダ、モデル、タスク、入出力トークン、キャッシュ読み込み、USD、ユーザーを記録し、ユーザーごとの月額上限を設ける。
- **このセッション:** ゲートウェイがログに `usage` を出し、`/api/v2/llm/status` で設定状況を確認できるところまで。

---

## 7. Claude Code 連携による教材制作パイプライン

### 7.1 統一スキーマ `risepath.lesson/v1`（決定事項）

サブレポートで名前と言語キーが割れていました（`risepath.lesson/v1` と `{jp}`、`rp.lesson/v1` と `{ja}`）。次のように決めます。

- **名前は `risepath.lesson/v1` / `risepath.course/v1`、言語キーは既存データに合わせて `jp|en|fr` にします。** BCP-47 の `ja` へは、HTML の `lang` 属性と LLM プロンプトに渡すときだけ変換します。
- **定義はただ 1 つ:** `shared/lesson/schema.js`（zod、`zod/v4` を JSDoc で型付け）。サーバー、MCP、CLI、Vite / TS（`allowJs`）のすべてから import します。JSON Schema は `content/schema/lesson.schema.json`（完全版）と `lesson.llm.schema.json`（LLM 用：再帰なし、mindmap なし）に書き出します。
- **構造:** Course → modules → lessons（ファイル単位）→ sections（`role`: hook / concept / example / practice / check / pitfalls / summary / reflection）→ blocks。すべてに ID を付けます。
- **テキスト型:** `string | {jp?,en?,fr?}`（string は `lesson.locale` の言語として扱う）。
- **レッスンの必須項目:** `objectives[{id,text,bloom}]`、`estMinutes`、`provenance{author,model?,skill?,generatedAt?,reviewedBy?,migratedFrom?}`、`quiz.questions[].objectiveId`
- **ファイルの置き場所:**
  - レッスン: `content/courses/<slug>/course.json`、`content/courses/<slug>/lessons/<lessonId>.lesson.json`
  - 下書き: `content/courses/<slug>/drafts/`
  - 補助資料: `briefs/`、`reports/`
  - Vite が `import.meta.glob` で読み込み、`/learn/:course/:lesson` で表示します。

### 7.2 レッスン契約（教育設計のルール。生成プロンプト、skill、MCP で共通）

**構成:**
`objectives(2–4)` → `hook`（課題 + 予想問題。採点しない）→ `segments 3–5 × [説明 300字以内 ／ 図（目的があるときだけ）／ 例題 3–6 ステップ ／ 確認 1–2 問 ／ よくある間違い（1 つまで）]` → `try_it`（ヒント 3 段階 + 模範解答）→ `recap`（全目標を網羅、1 問以上は応用）→ `summary`（3 点）→ `reflection`（1 問）→ `flashcards`（4–8 枚）

**分量の上限:**
- 1 文 60 字以内
- 1 段落 160 字以内
- 本文合計 1,200〜2,400 字
- 1 セグメントで新しく出す用語は 3 つまで
- 装飾画像は 0

**問題の作り方:**
- 誤答の選択肢には、それぞれ実在する誤解を対応させ、2 文以内で正す解説を付ける。
- たとえ話や雑学そのものは出題しない。

**文体:**
- です・ます調
- カタカナ用語は初出で英語を併記する（例: 参照（reference））
- 「簡単です」「誰でも」は禁止

### 7.3 Claude Code 側の構成

```
AGENTS.md                         # どのエージェントでも使える規約（Codex/Cursor/Gemini CLIも読む）
CLAUDE.md                         # @AGENTS.md + Claude固有（skills, preview, hook）
.mcp.json                         # rise-path MCP (stdio, RISE_PATH_MCP_PROFILE=curriculum-builder)
.claude/rules/content.md          # paths: content/** のときだけ読み込む教材ルール
.claude/skills/author-lesson/     # SKILL.md + references/{lesson-contract, block-cookbook, style-guide.ja, rubric}.md + templates/brief.md
.claude/skills/review-lesson/     # context: fork, agent: pedagogy-reviewer → review.v1 JSON
.claude/agents/{pedagogy-reviewer, ja-editor, visual-qa}.md  # (P1で curriculum-researcher, fact-checker)
.claude/hooks/validate-lesson.mjs # PostToolUse: *.lesson.json を書いたら検証、失敗時 exit 2 → Claudeが自分で直す
.claude/settings.json             # hook配線（※オーナー承認後にコミット）
scripts/lessons/{validate,lint,export-schema,migrate-legacy,preview,catalog}.mjs
content/schema/{lesson.schema.json, lesson.llm.schema.json, rubric.v1.json, review.v1.json}
```

**`/author-lesson <course> <lessonId> "<依頼>"` の流れ:**
1. 依頼内容を整理する。不足があれば 1 回だけ質問する。
2. 調査（任意のサブエージェント）。
3. アウトラインを確認する（対話モードなら Go / No-Go を聞く）。
4. セクションごとに執筆する。
5. hook と `lessons:validate`、`lessons:lint` で検証する。
6. `pedagogy-reviewer` と `ja-editor` が並列でルーブリック JSON を出す。「必ず直す」項目を直す（最大 2 往復）。
7. `lessons:preview` でデスクトップとモバイル、日本語と英語の画面を撮り、`visual-qa` が PNG を確認する。
8. 翻訳する。
9. レポートを書き、PR を出す。**公開はしません。**

**ルーブリック（0〜4 点、全項目 3 以上かつ平均 3.3 以上で合格）:** 次の 13 項目です。
- `align`（目標と確認問題の対応）、`hook`（導入）、`prior`（既有知識の活性化）
- `load`（認知負荷）、`worked`（例題）、`active`（能動的な確認）
- `miscon`（誤解への対処）、`visual`（図の質）、`practice`（演習）
- `meta`（振り返り・まとめ）、`accuracy`（正確さ）、`voice`（日本語の文体）、`a11y_l10n`（アクセシビリティと多言語）

### 7.4 MCP（他の LLM からの制作）

**このセッションで追加するツール**（stdio、`curriculum-builder` プロファイル）:

| ツール | 内容 |
|---|---|
| `lesson-schema-get` | LLM 用スキーマ、レッスン契約、お手本教材を返す |
| `lesson-validate` | 保存せずに検証し、パス付きのエラーと lint 警告を返す |
| `lesson-get` | レッスンを読み出す |
| `lesson-upsert-draft` | 下書きのみ書き込む。楽観ロック付き |
| `lesson-preview-url` | プレビュー URL を返す |

あわせて、リソース `rp://schema/lesson/v1` と、プロンプト `author-lesson`（skill の本文と同じ）を公開します。

**P2 で行うこと:**
- 通信方式を Streamable HTTP（`/mcp`）+ OAuth 2.1（Supabase が ID プロバイダ）にし、スコープを `lessons:read` / `lessons:write` / `lessons:publish` に分ける。共有 bridge ユーザーは廃止する。
- `save-curriculum-draft` は `lesson-upsert-draft` の別名にする。
- `content:pull` で DB の下書きを PR 用のファイルにする。

**P3 で行うこと:** MCP Apps の `ui://risepath/lesson-preview` で、Claude や ChatGPT の中に本物のリーダー表示を出す。長時間かかるコース生成は MCP の Task にする。

**他のエージェントからの接続:**
- ChatGPT（リモート MCP）、Gemini CLI と Cursor（`mcpServers` 設定）、Codex（`AGENTS.md`）が同じ手順を共有します。
- ローカルモデルは出力形式が保証されないため、チューターと翻訳だけに使います。

### 7.5 品質ゲート

| 段階 | このセッション | P1 以降 |
|---|---|---|
| 構造 | `npm run lessons:validate`（zod + 意味チェック：ID の重複、正解 ID、objectiveId、ロケールの欠け） | CI で PR に注釈を付ける（`--format github`） |
| 教育設計 | `npm run lessons:lint`（警告。`--strict` で失敗扱い。ただし移行したままの章の警告は参考扱い。下記） | 新しいレッスンは CI で `--strict` |
| 判断 | subagent によるレビュー | `claude -p --json-schema review.v1.json` で CI 審査、アプリ内生成でも同じ judge を使う |
| 見た目 | `npm run lessons:preview`（PNG + `metrics.json`：横はみ出し、コンソールエラー、Mermaid のエラー、1 行の文字数） | 視覚的な回帰テスト（`/dev/blocks`） |

**移行したままの章の扱い（2026-10-19 オーナー判断、案 A）:** 機械的に移行し、まだ作り直していない章は既知の状態として受け入れ、完了の条件に含めません。
- 判定: `provenance.migratedFrom` があり、`provenance.author` が `migration` か `migration+…` で、`reviewedBy` がないレッスン（`shared/lesson/lint.js` の `isMigratedUnreviewed`）。
- `lessons:lint --strict` は、これらの警告を advisory（参考）として件数付きで表示し、終了コード 0 にします。検証エラー、下書き（`drafts/`）、それ以外のレッスンの警告は、これまでどおり失敗です。
- `/author-lesson` で作り直すと `provenance.author` が新しい作者に変わり、その章は厳格に判定されます。`--include-migrated` を付けると、移行したままの章も失敗扱いにします。

---

## 8. 実装ロードマップ

| フェーズ | 期間の目安 | 内容 | 完了の定義 |
|---|---|---|---|
| **Phase 0：土台**（このセッション） | 約 1 週間分の作業。WP-01〜10 を並行実施 | 下記 | §9 の受け入れ条件をすべて満たす |
| **Phase 1：教材体験を完成させる** | 2 週 | 下記 | 全旗艦コンテンツが新リーダーで動く。偽データ 0。モバイル Lighthouse のアクセシビリティ 95 以上 |
| **Phase 2：定着と制作** | 3〜4 週 | 下記 | 復習 → 再開の循環が実データで回る。外部 LLM が OAuth 経由で下書きを作れる |
| **Phase 3：差別化** | 継続 | 下記 | — |

**Phase 0 の内容:**
- トークンと日本語組版、シェルの P0 修正
- スキーマ、バリデータ、Vibe 12 章の移行
- LessonReader とリッチブロック
- Claude Code キット、MCP の lesson ツール
- LLM ゲートウェイ（キー漏洩の修正）
- ダッシュボードとランディングの刷新
- 旧リーダーの安全化

**Phase 1 の内容:**
- コンテンツ移行: Unity 4 章、生成コースは読み込み時に `normalizeLesson()` で v1 に変換、Blender は `steps` / `compare` に移行
- モバイルの下部バーとボトムシート
- AskAI サイドシート（`/llm/tutor` をストリーミングで使い、FAB を廃止）
- レッスン単位の生成パイプラインと保存経路の統一（`curriculum_data` のバグ修正）
- 不要物の整理: 死んだコードの削除、水増しコースの撤去、各種フラグの追加（Sonic、AIDJ、Teacher Bot、Subscription、Encyclopedia）
- 画像の自前ホスティングと `onError` での代替表示
- CI に教材チェックを追加

**Phase 2 の内容:**
- モード: スライド（自動生成 + Kokoro）と練習
- 定着: FSRS 復習キュー、DB 保存の進捗 API
- ナビゲーションと画面:
  - ナビを 5 項目に（ホーム / 学ぶ / つくる / ふりかえり / AIパートナー）
  - `/learn` と「つくる」ハブ
  - アプリ全体のダークモード、Cmd+K
- MCP v3（Streamable HTTP + OAuth）
- LLM 運用: `llm_calls` 台帳と予算上限、埋め込みの移行
- 審査とランディング: CI でのルーブリック審査、実際の画面を使ったランディング
- Blender マニュアルを git から外す

**Phase 3 の内容:**
- MCP Apps によるプレビュー
- サンドボックス（HTML/JS → Pyodide）
- P-School のステージ連携と XP の統一
- Art の `museum` バリアント
- FR 翻訳（または削除）
- 聴くモード
- 作り手向けの分析（ブロックごとの質問数）
- Managed Agents の outcomes による「深い制作」
- 興味やレベルのピルによる例の個別化

**成功指標（Phase 2 から計測）:**
- レッスン完了率（`checked` まで）
- 確認問題の初回正答率
- 7 日後の復習実施率
- D7 継続率
- 制作パイプラインのルーブリック合格率
- 1 レッスンあたりの LLM コスト

**オーナー判断が必要な事項:**
1. 既定モデル: Opus 5.5 に統一するか、チューターと翻訳を Haiku 5.5 / Gemini にするか（環境変数で後から切り替え可能）
2. FR: 非表示にするか（推奨）、翻訳するか
3. 水増しコース 10 本: 削除するか（推奨）、再生成するか
4. Life Journal の位置づけ（オプトイン機能のまま残すことを推奨）
5. Blender マニュアル: 追跡を外すだけか、履歴も書き換えるか
6. `.claude/settings.json` の hook をコミットするか
7. Sonic / AIDJ / Teacher Bot を「Labs」に移すか
8. 旗艦トラックの選定（Vibe Coding を推奨。次点で Blender と Unity）

---

## 9. このセッションの実装バックログ（最重要）

### 9.0 全 WP 共通の受け入れ条件（Definition of Done）

- **コマンドがすべて通ること:** `npm run typecheck`、`npm run build`、`npm test`。WP-03 以降は `npm run lessons:validate` も対象です。
- **スクリーンショットで確認すること:** dev サーバー（:3007、:3006）を起動した状態で、次を撮影します。
  - コマンド: `node .shots/shoot.mjs <scratchpad>/shots-after/<wp> <routes…>`（デスクトップ）と `MOBILE=1`（390px）
  - 撮影は日本語 UI で行う
  - 対象ルート: 少なくとも `/`、`/learning-hub`、`/vibe` と、その WP が触ったルート
  - **出力で `page errors` が出ないこと**
- **書き方のルール:**
  - 新しいコードで色の直書き（`[#hex]`）、`rounded-[…]`、`text-[9-11px]`、`text-slate-400` を使わない。
  - 学習者向けの文言を足すときは EN と JP を両方用意する。
- **依存パッケージの扱い:** 追加は `npm install <pkg>` で行います。`package.json` と `package-lock.json` を手でマージしてはいけません（衝突しやすいファイルです）。このセッションで追加した 6 つは承認済みです（§9.3）。これから追加するものは、引き続きオーナーの承認が必要です（`AGENTS.md`）。

### 9.1 依存関係と実施の順番（ウェーブ）

```
Wave 1（並行）: WP-01 tokens ─┐   WP-03 schema ─┐   WP-08 LLM gateway   WP-10 legacy hardening
Wave 2        : WP-02 shell ◄─┘   WP-07 MCP  ◄──┤
Wave 3        : WP-04 reader ◄── WP-01, WP-02, WP-03
Wave 4（並行）: WP-05 rich blocks ◄─ WP-04 │ WP-06 Claude Code kit ◄─ WP-03, WP-04 │ WP-09 dashboard/landing ◄─ WP-01, WP-02, WP-04
```

**複数の WP が触るファイル（順番に作業すること）:**

| ファイル | 触る WP | 対処 |
|---|---|---|
| `package.json` / `package-lock.json` | WP-03（zod、MCP SDK、scripts）、WP-05（shiki）、WP-06（scripts）、WP-08（@anthropic-ai/sdk） | `npm install` で 1 つずつ追加する。scripts の追記は WP-03 → WP-06 の順 |
| `App.tsx` | WP-02（ログアウト、遷移の補完）、WP-04（`/learn` / `/preview` / `/dev/blocks` ルート、`/vibe/chapter-N` のリダイレクト） | WP-02 の後に WP-04 |
| `navigation/viewPaths.ts` | WP-02 が作成、WP-04 が `VIBE_CHAPTER_*` の行を変更 | 同上 |
| `components/lesson/blocks/registry.tsx` | WP-04 が作成、WP-05 が追記 | WP-04 の後に WP-05 |
| `components/common/Layout.tsx`、`FloatingChatbot.tsx` | WP-02 だけ（レッスン用のレール表示と AI先生 の文脈受け取りも WP-02 で行う） | — |
| `index.css`、`index.html` | WP-01 だけ（リーダーの CSS は WP-04 で別ファイルにする） | — |
| `server.js` | WP-08 だけ | — |
| `mcp-server/index.js`、`tool-registry.json`、`tools/core/curriculum.js` | WP-07 だけ | — |
| `GeneratedDocView.tsx`、`VibeDocView.tsx` | WP-10 だけ | — |
| `MissionControlDashboard.tsx`、`ExperienceLandingView.tsx`、`MyContent.tsx` | WP-09 だけ | — |
| `services/geminiService.ts`、`components/features/settings/*`、`ProfilePassport.tsx`、`vite.config.ts` | WP-08 だけ | — |

**WP 間の取り決め（インターフェース契約）:**
- **AI先生 への質問イベント:** `services/tutorBridge.ts`（WP-02 が作成）
  ```ts
  export type AskTutorDetail = { message: string; mode?: 'explain'|'socratic';
    lesson?: { courseId: string; lessonId: string; title: string; objectives: string[]; level?: string };
    anchor?: { sectionId: string; blockId: string; blockType: string; excerpt: string; codeLang?: string; highlightedLines?: number[] };
    learner?: { attemptsOnBlock?: number; chosenOptionId?: string; questionId?: string; answerShown?: boolean } };
  export function openTutor(detail: AskTutorDetail): void; // window 'open-rise-path-chat'
  ```
  WP-08 のサーバー側 `/llm/tutor` は、これと同じ形を zod で検証します。
- **進捗の保存:** `components/lesson/progressStore.ts`（WP-04 が作成）
  - キー: `rp:progress:<courseSlug>:<lessonId>`。中身は `{v:1, seen:string[], answers:Record<blockId,{attempts,correct,chosen}>, checks:Record<id,boolean>, lastBlockId, updatedAt}`
  - キー: `rp:lastLesson`。中身は `{courseSlug, lessonId, title, pct, at}`
  - `getLastLesson()` を export します。WP-09 のダッシュボードが使います。
- **教材の読み込み:** `content/index.ts`（WP-04 が作成）が `listCourses()`、`getCourse(slug)`、`loadLesson(slug, id)` を提供します。WP-09 のトラックカードで使います。

---

### WP-01　デザイントークンと日本語タイポグラフィの基盤
- **規模:** S〜M（0.5 日）
- **依存:** なし
- **衝突:** なし（index.css と index.html はこの WP が単独で担当）
- **目的:** §4.2 のトークンを 1 か所で定義し、Tailwind のユーティリティとして使えるようにする。日本語フォントと組版ルール、フォーカスリングを全体に適用する。
- **作成するファイル:**
  - `styles/tokens.css`
    - `:root` にライト値、`:root[data-theme=dark], [data-theme=dark]` にダーク値を置く。
    - `[data-world=art|vibe|unity|ai|sonic|pschool|blender|web]` にアクセント色を置く。
    - **`prefers-color-scheme` による自動ダークは `[data-theme=system]` の要素の内側だけ**にする（アプリ全体にはまだ適用しない）。
  - `styles/typography.css`
    - `:lang(ja)` のルール一式（§4.2）、`.tabular`、`.overline`
    - 日本語のとき `em, i, .italic` を正体にする
    - 移行措置として `:lang(ja) :is(.uppercase,[class*="tracking-"])` の字間を中和し、「ミ ッ シ ョ ン」のような詰まりを解消する
  - `doc/design/design-system.md`（トークン表、使い方、禁止事項）
- **変更するファイル:**
  - `index.css`
    - `@import "tailwindcss"` の直後に tokens と typography を import する。
    - `@theme inline` で色・角丸・影・フォントを対応づけ、`@custom-variant dark` を定義する。
    - `--font-serif` を `"Newsreader","Noto Serif JP",serif` に置き換える。
    - 全体に `:focus-visible` のリングを付ける。
    - `body { background: var(--rp-canvas); color: var(--rp-fg); font-family: var(--font-sans) }` にする。
    - スクロールバーの色をトークンにする。
    - `.page-transition` から scale を外し、4px のスライドだけにする。
  - `index.html`
    - Google Fonts を `Inter:wght@400..700`、`Noto+Sans+JP:wght@400..700`、`JetBrains+Mono:wght@400;600`、`Newsreader:opsz,wght@6..72,400..600`、`Noto+Serif+JP:wght@400;600` にする（`display=swap`、preconnect）。
    - Playfair を削除する。
    - `<body>` のクラスを `bg-canvas text-fg antialiased` にする。
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - JP 表示で `/` と `/vibe/chapter-1` の和文が Noto Sans JP で描画される（Playwright の `document.fonts.check('16px "Noto Sans JP"')` が true）。
  - ランディング（ログアウト状態、`/`）の「本能的になる」が斜体ではない（`getComputedStyle(...).fontStyle === 'normal'`）。
  - Tab キーでサイドバーのボタンにフォーカスリングが見える（スクリーンショット）。
  - 主要画面（`/`、`/learning-hub`、`/art`、`/vibe`）でフォント以外の崩れがない（`shots-before/jp` と並べて比較）。

### WP-02　アプリシェルの整理とナビゲーションの修正
- **規模:** M（1 日）
- **依存:** WP-01
- **衝突:** App.tsx（WP-04 より先に行う）
- **目的:** モバイルの崩れ（P0）を直し、ナビゲーションの迷子をなくし、開発用の残骸と偽の未読ドットを消す。リーダー画面ではサイドバーをレール表示にする。
- **作成するファイル:**
  - `navigation/viewPaths.ts`
    - `ViewState` → パスの完全な対応表を作る。`VIBE_CHAPTER_0..11` → `/vibe/chapter-N`、`VIBE_PROLOGUE` → `/vibe/prologue`、`UNITY_CHAPTER_0..3` → `/unity/chapter-N`、`BLENDER_PATH` → `/blender/path` など。
    - `pathToNavKey(pathname)`: URL からナビのハイライトを決める。
  - `config/features.ts`
    - `devSamples`（`import.meta.env.DEV && ?dev=1`。localStorage に try/catch で保存）、`frLocale`、`labs`（Sonic、Teacher Bot、AIDJ）を定義する。
  - `components/common/BrandMark.tsx`（上る線 + 朝日の SVG。モックと同じ）
  - `services/tutorBridge.ts`（§9.1 の契約）
- **変更するファイル:**
  - `components/common/Layout.tsx`
    1. 280-284 行の末尾の `relative` を削除する。
    2. トークン化する（`bg-surface border-line text-fg-2`、選択中は `bg-primary-soft text-primary-text`）。
    3. ナビを整理する。トップレベルは ダッシュボード / 学習コンテンツ（`/learning-hub` へ）/ AIカリキュラム生成 / AI学習診断 / ライフジャーナル。アカウントの下に 学生証・履歴・バッジ・生成物・マイコンテンツ・AIキャラクター をまとめ、「ドキュメント」グループは削除する。「デザインサンプル」は `features.devSamples` が有効なときだけ、既定で閉じた状態で出す。
    4. ハイライトは `pathToNavKey` で決め、`aria-current="page"` を付ける。グループには `aria-expanded` を付ける。
    5. アイコンだけのボタン（ハンバーガー、折りたたみ）に `aria-label` を付ける。
    6. `nav` を `flex flex-col` にし、ログアウトに `onLogout` を配線する。
    7. FR ボタンは `features.frLocale` のときだけ出す。
    8. `/learn/`、`/preview/`、`/dev/blocks` では 64px レールにし、全幅表示にし、モバイルのヘッダーを隠す。
    9. ロゴを `BrandMark` にする。
  - `App.tsx`
    - `handleNavigate` の `default` で `VIEW_PATHS[view]` を引いてから警告を出すようにする。
    - `Layout` に `onLogout={() => { logout(); navigate('/'); }}` を渡す。
  - `components/common/FloatingChatbot.tsx`
    - 未読ドットは実際に未読があるときだけ出す（193 行目）。
    - レッスン系のルートではランチャーボタンを隠す。ただしパネルは `open-rise-path-chat` イベントで開けるように残す。
    - `detail.lesson`、`detail.anchor`、`detail.mode`、`detail.learner` を受け取り、`context` に入れて送る（100-107 行目）。
  - `public/favicon.svg`（「D」から新しいマークへ）
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `MOBILE=1` で `/`、`/learning-hub`、`/vibe` を表示したとき、`main` の幅が 380px 以上。サイドバーは画面外にあり、ハンバーガーで開閉できる（Playwright で計測）。
  - 次の遷移が正しく動く（`<session-scratchpad>/scripts/navcheck.mjs` で確認）。
    - `/vibe` で章カードを押すと `/vibe/chapter-N` に移る。
    - `/unity` の章カードで `/unity/chapter-N` に移る。
    - `/blender` のプロジェクトカードで `/blender/path` に移る。
  - `?dev=1` なしでは「デザインサンプル」が出ない。
  - ログアウトでランディングに戻る。
  - `/learning-hub` を開くと「学習コンテンツ」がハイライトされ、`aria-current` が付く。
  - `openTutor({...lesson})` を呼ぶとチャットパネルが開き、送信内容の `context.lesson.lessonId` が入っている（fetch をモックして確認）。

### WP-03　統一教材スキーマ、検証 CLI、既存教材の移行
- **規模:** L（1〜1.5 日）
- **依存:** なし
- **衝突:** package.json
- **目的:** `risepath.lesson/v1` を 1 か所で定義し、JSON Schema の書き出し、検証、lint、旧形式からの変換を用意する。Vibe 12 章を JSON に移行し、第 1 章を「お手本教材」に磨く。
- **作成するファイル:**
  - `shared/lesson/schema.js`
    - `zod/v4` を使い、JSDoc で型付けする。
    - export: `Locale`、`LText`、`Md`、`Block`（§5.4 のうち MVP の 16 種類。`markdown`、`callout`、`list`、`definitions`、`table`、`code`、`prompt`、`diagram`、`image`、`quiz`、`flashcards`、`steps`、`checklist`、`summary`、`askTutor`、`mindmap`）、`Section`、`Lesson`、`Course`
    - 各ブロックの共通項目: `id`（`^[a-z0-9][a-z0-9._-]*$`、必須）、`slide?`、`narration?`、`cite?`
  - `shared/lesson/text.js`: `t(text, locale, fallback)`、`hasLocale()`
  - `shared/lesson/validate.js`
    - `validateLesson(json, {course?})` → `{ok, errors:[{path,message}], lesson}`
    - 意味チェック: ID がレッスン全体で一意、`answer ⊂ options.id`、`objectiveId` が実在する、`locales` で宣言した言語に欠けがない、図に `code` / `alt` がある、`next.lessonId` が実在する
  - `shared/lesson/lint.js`
    - 警告を出す項目: 学習目標 2〜4 個、2 セクションに 1 個以上の inline quiz、`summary` あり、誤答に `feedback` がある、段落 160 字以内（英語は 80 語）、コードに `filename`、1 セクションの callout が 2 個以内、`lang:markdown` のコードは `prompt` にすべき、禁止語
    - 結果は `{warnings:[{rule,path,message}]}`
  - `shared/lesson/fromDocChapter.js`: `DocChapter` と `QuizData` を v1 に変換する
    - `text` → `markdown`（lead はそのまま）
    - `list` の `key` スタイル → `definitions`（`**ラベル**：` で分割）
    - `mermaid` → `diagram`（`alt` はキャプションで補う）
    - プロンプト的な `code` → `prompt`
    - クイズ → 最後に置く `role:'check'` のセクション（`quiz.mode:'exam'`）
    - ID は `s{n}-b{m}`、`provenance.migratedFrom` を付ける
  - `scripts/lessons/validate.mjs`
    - 引数なしなら `content/courses/**/*.lesson.json` を全部検査し、ファイルを引数に取ることもできる。
    - `--format text|json|github`。エラーがあれば exit 1。
  - `scripts/lessons/lint.mjs`（`--strict` で警告も exit 1。ただし移行したまま未レビューのレッスン（migrated-unreviewed、§7.5）の警告は表示のみ。`--include-migrated` を付けると、それも exit 1 にする）
  - `scripts/lessons/export-schema.mjs`: `z.toJSONSchema` で `content/schema/lesson.schema.json` と `lesson.llm.schema.json` を書き出す。LLM 用は再帰なし、`mindmap` なし、`additionalProperties:false`。
  - `scripts/lessons/migrate-legacy.mjs`: `data/curricula/vibe_coding/chapterN.ts` を esbuild（vite の依存として入っている）でメモリ上でバンドルして import し、JSON に変換する。
  - `content/courses/vibe-coding/course.json`: `world:'vibe'`、モジュール構成、各レッスンの `next`
  - `content/courses/vibe-coding/lessons/vibe-ch0.lesson.json` 〜 `vibe-ch11.lesson.json`（機械的な移行）
  - **`vibe-ch1.lesson.json` は手で磨く:**
    - 学習目標を 3 つ（Bloom 付き）
    - 導入の予想問題
    - 1-1 と 1-2 の後に `chapter1_quiz.ts` から作った inline の確認問題（誤答ごとの解説を新しく書く）
    - プロンプト例を `prompt` ブロックに置き換える
    - `summary`、`flashcards` を 5 枚
    - `provenance.author:'human+claude-code'`
  - `server/tests/lessonSchema.test.js`
- **変更するファイル:**
  - `package.json`
    - `zod@^3.25.76` と `@modelcontextprotocol/sdk@^1.29.0` を明示的な依存にする（現在は推移的に入っているだけ）。
    - scripts に `lessons:validate`、`lessons:lint`、`lessons:schema`、`lessons:migrate` を追加する。
- **（ストレッチ）** Unity 4 章：`{jp, en}` の DocChapter の組を、構造が同じならブロック単位で突き合わせて 1 つにする。
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `npm run lessons:validate` が 12 ファイルで exit 0。
  - `npm run lessons:lint -- content/courses/vibe-coding/lessons/vibe-ch1.lesson.json --strict` が exit 0。
  - 正解 ID を壊した複製を `lessons:validate` にかけると exit 1 になり、`sections[2].blocks[0].questions[0].answer[0]` のようなパスを含むエラーが出る（テストで確認）。
  - 移行後の表の数が元データと一致する（テストで確認）。
  - `content/schema/*.json` が生成され、コミットされている。

### WP-04　LessonReader 本体（シェル、コアブロック、ルート、進捗）
- **規模:** L（1.5 日）
- **依存:** WP-01、WP-02、WP-03
- **衝突:** App.tsx、`viewPaths.ts`
- **目的:** v1 の教材を表示する唯一のリーダーを作る。Vibe 12 章をこのリーダーに切り替える。
- **作成するファイル（すべて `components/lesson/` 配下）:**
  - `LessonReader.tsx`: 3 カラムのグリッド、`data-world`、`data-theme` はリーダー内だけ
  - `LessonBar.tsx`
    - main 内で sticky にする（`position:fixed` は禁止）。
    - 戻る、パンくず、モードタブ（「読む」だけ有効、スライドと練習は「準備中」で無効）、進捗リング、Aa、✦AI先生
  - `Outline.tsx`: ○●✓! の状態表示、`word-break:auto-phrase`、次のレッスンカード。1279px 以下ではドロワーにする
  - `LessonHeader.tsx`: タイトル、サブタイトル、メタ情報、学習目標カード
  - `LessonEnd.tsx`: まとめ、自己評価チップ 3 つ、次のレッスン
  - `ReaderSettings.tsx`: Aa（サイズ S/M/L、UD 書体、行間、ライト/セピア/ダーク）。localStorage に try/catch で保存する
  - `reader.css`: ui-lessons §5.5 の `.rp-prose` 一式。`LessonReader` から import する
  - `blocks/registry.tsx`: `BlockView` と型付きの登録表
  - コアブロック: `blocks/MarkdownBlock.tsx`（react-markdown、`skipHtml`、外部リンクは `target=_blank rel=noopener`）、`CalloutBlock.tsx`、`ListBlock.tsx`（本物の `ol` / `ul`）、`DefinitionsBlock.tsx`、`TableBlock.tsx`、`ImageBlock.tsx`、`SummaryBlock.tsx`、`UnknownBlock.tsx`（開発時だけ警告を出す）
  - `AskAnchor.tsx`: 段落のホバーかフォーカスで ✦ を出し、`openTutor({lesson, anchor})` を呼ぶ
  - `progressStore.ts`、`useLessonProgress.ts`: IntersectionObserver の root はスクロールしている `main`。`seen`、`lastBlockId`、確認問題の記録 API
  - `useScrollContainer.ts`: `window.scrollTo` を使わずに `main` をスクロールする
- **その他の作成ファイル:**
  - `content/index.ts`: course.json は `import.meta.glob` の eager、レッスンは lazy で読み込む。開発時は `validateLesson` の結果を画面に出す
  - `components/routes/LearnRoute.tsx`: `/learn/:courseSlug/:lessonId`。`/preview/:courseSlug/:lessonId` は開発専用で、検証レポートのパネルを付ける
- **変更するファイル:**
  - `App.tsx`: `/learn` と `/preview` のルートを追加し、`/vibe/chapter-N` を `/learn/vibe-coding/vibe-chN` にリダイレクトする（`Navigate replace`）
  - `navigation/viewPaths.ts`: `VIBE_CHAPTER_*` の行き先を `/learn/...` にする
  - `components/routes/lazyRoutes.tsx`: `LearnRoute` を lazy にする
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - JP 表示の `/learn/vibe-coding/vibe-ch1` が日本語で表示され、EN に切り替えると英語になる。
  - 12 章すべてで `UnknownBlock` が 0、表の数が JSON と一致する（`<session-scratchpad>/scripts/readercheck.mjs`）。
  - 1440px で本文が 1 行 36〜42 字（段落の幅をフォントサイズで割って計測）。LessonBar の左端がレールの右端以上（サイドバーに被らない）。
  - 390px で `scrollWidth <= clientWidth`（横にはみ出さない）、本文 16px 以上。
  - 目次をクリックすると、該当見出しが main の上端から 80px 以内に来る。リロードすると `lastBlockId` の位置に戻る。
  - 段落の ✦ を押すと、チャットパネルが開き、`context.anchor.blockId` が入っている。
  - スクリーンショット: `shots-after/wp04/{learn_vibe-coding_vibe-ch1, …-m, …-en}.png`

### WP-05　リッチ／インタラクティブブロックと `/dev/blocks`
- **規模:** L（1.5 日）
- **依存:** WP-04
- **衝突:** `registry.tsx`、package.json
- **目的:** 「素晴らしい教材」を作るためのブロックを揃える。全ブロックを並べたギャラリーを、視覚的な回帰テストと Claude Code のセルフチェックに使う。
- **作成するファイル（`components/lesson/blocks/` 配下）:**
  - `CodeBlock.tsx`
    - Shiki を動的 import で遅延読み込みする（`shiki` 4.x。言語は ts/tsx/js/json/bash/python/html/css/sql/yaml/markdown/csharp、テーマは github-light / github-dark-dimmed）。
    - 読み込みに失敗したら素の `pre` で表示する。
    - ヘッダー（ファイル名・言語）、コピー（`aria-live` で「コピーしました」）、`highlight` 行、5 行を超えたら行番号、25 行を超えたら折りたたむ。
    - ✦説明 から `openTutor`（コードと強調行を渡す）。
  - `PromptBlock.tsx`
    - `{{var}}` を編集できるチップにし、埋めた結果をコピーできるようにする。
    - 「Claude Codeで使う」は、シェルでエスケープした `claude "<prompt>"` をコピーする。
    - `expect` は開閉式にする。
  - `DiagramBlock.tsx`
    - mermaid を遅延読み込みする。`securityLevel:'strict'`、トークンから作った `themeVariables`、`fontSize` 14 以上。
    - `role="img"` と `aria-label` に `alt` を入れる。`<details>` で図の説明を付ける。拡大用のダイアログを付ける。
  - `QuizCheckBlock.tsx`
    - 確認しよう（single / multi / truefalse）。誤答なら選んだ選択肢の解説、ヒント、再挑戦。2 回目で正解と中立色の解説を出す。
    - 1〜4 キーと Enter で操作できる。`role=radiogroup`、`aria-live`。
    - 結果は `useLessonProgress` に記録する。「なぜ？をAIに聞く」は `openTutor({mode:'socratic', learner})`。
  - `FlashcardsBlock.tsx`: `aria-pressed`、Space でめくる、[覚えた / もう一度] を保存
  - `StepsBlock.tsx`: `kbd` チップ、期待される結果、ヒントの開閉、完了チェック
  - `ChecklistBlock.tsx`: n/m 表示、状態を保存
  - `AskTutorBlock.tsx`: 質問の候補チップ
  - 上記を `registry.tsx` に登録する。
  - 目次の「!」（未回答）表示と、LessonBar の「練習 x/y」の回答数を有効にする。
- **その他の作成ファイル:**
  - `content/examples/blocks-gallery.lesson.json`: 全ブロック種を日英で含む。`lessons:validate` の対象にする
  - `/dev/blocks` ルート（`features.devSamples` が有効なときだけ）
- **変更するファイル:** package.json（`npm install shiki`）
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `/dev/blocks` をデスクトップとモバイルで表示して `page errors` が 0。
  - Playwright でキーボードだけを使って確認問題を解ける。誤答で解説が出て、2 回目で正解が表示される。
  - コピーボタンでクリップボードに入り、`aria-live` で通知される。
  - クリックイベントや HTML ラベルを含む Mermaid のテスト用データが無害化される。図のラベルが 13px 以上。
  - ビルド出力で Shiki が初期読み込みチャンクに入っていない（`index-*.js` の増加が 20kB 未満）。
  - `vibe-ch1` を `--strict` の lint にかけて 0 件。

### WP-06　Claude Code 教材オーサリングキット
- **規模:** M（1 日）
- **依存:** WP-03、WP-04（プレビュー用ルート）
- **衝突:** package.json の scripts だけ
- **目的:** Claude Code（とほかのエージェント）が、依頼 → アウトライン → JSON 作成 → 検証（hook）→ lint → レビュー → スクリーンショットによる確認、までを 1 つのコマンドで回せるようにする。
- **作成するファイル:**
  - `AGENTS.md`（80 行以内。コマンド、置き場所、教材ルールの要約、禁止事項：ブラウザに鍵を置かない、公開しない、モデル ID は `server/llm/models.config.js` にだけ書く）
  - `CLAUDE.md`（`@AGENTS.md` と Claude 固有の注意。40 行以内）
  - `.mcp.json`（`{"mcpServers":{"rise-path":{"command":"node","args":["mcp-server/index.js"],"env":{"RISE_PATH_MCP_PROFILE":"curriculum-builder"}}}}`）
  - `.claude/rules/content.md`（frontmatter に `paths: ["content/**"]`）
  - `.claude/skills/author-lesson/SKILL.md`
    - frontmatter: `name`、`description`、`arguments`（または `argument-hint`。どちらを使うかは実装時に Claude Code の docs で確認）、`allowed-tools`
    - §7.3 の手順 0〜8 と、完了の定義
    - `` !`npm run -s lessons:catalog` `` で教材の目録を差し込む
  - `.claude/skills/author-lesson/references/` 配下: `lesson-contract.md`（§7.2）、`block-cookbook.md`（どの場面でどのブロックを使うか、良い例と悪い例の小さな JSON）、`style-guide.ja.md`、`rubric.md`
  - `.claude/skills/author-lesson/templates/brief.md`
  - `.claude/skills/review-lesson/SKILL.md`（`context: fork`、`agent: pedagogy-reviewer`、出力は `content/schema/review.v1.json` に沿う）
  - `.claude/agents/pedagogy-reviewer.md`、`ja-editor.md`、`visual-qa.md`（「あなたはこの教材の作者ではない」という前提を明記し、出力形式を固定する）
  - `.claude/hooks/validate-lesson.mjs`
    - 標準入力から PostToolUse の JSON を受け取り、`tool_input.file_path` が `content/**/*.lesson.json` なら `validateLesson` を実行する。
    - 失敗したら stderr にパス付きのエラーを出して exit 2、成功なら exit 0。
  - `.claude/settings.example.json`（hook の配線）。**`.claude/settings.json` にするのはオーナーの承認後**（このリポジトリを開くすべてのセッションの挙動が変わるため）
  - `content/schema/rubric.v1.json`、`content/schema/review.v1.json`
  - `scripts/lessons/preview.mjs`
    - 3007 番の起動を確認し、`/preview/<course>/<lesson>` を desktop-jp、mobile-jp、desktop-en で撮影する。
    - `.artifacts/preview/<course>/<lesson>/*.png` と `metrics.json`（`overflowX`、`consoleErrors`、`mermaidErrors`、`charsPerLine`）を出力する。
    - Chromium の場所は環境変数 `PLAYWRIGHT_CHROMIUM_PATH`、なければ Playwright の既定を使う。
    - `.artifacts/` を `.gitignore` に追加する。
  - `scripts/lessons/catalog.mjs`（常に exit 0）
  - `doc/guides/authoring-with-claude-code.ja.md`（オーナー向けの手順。Codex、Cursor、Gemini CLI、ChatGPT から MCP を使う方法も）
  - `server/tests/claudeHook.test.js`
- **変更するファイル:** package.json の scripts に `lessons:preview` と `lessons:catalog` を追加する。
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `npm run lessons:catalog` が vibe-coding の 12 レッスンを一覧表示し、exit 0。
  - `npm run lessons:preview -- vibe-coding vibe-ch1` で PNG 3 枚と、`overflowX:false`、`consoleErrors:0` の `metrics.json` が出力される。
  - hook のテスト：不正な教材で exit 2 とパス付きのエラー、正しい教材で exit 0。
  - SKILL.md と agents の frontmatter が YAML として正しく解析できる。
  - （任意）`/author-lesson vibe-coding vibe-ch1-practice "第1章の演習"` を試し、検証を通った下書きができることを確認する。

### WP-07　MCP の教材ツール
- **規模:** M（1 日）
- **依存:** WP-03
- **衝突:** なし（`mcp-server/*` と `tools/core/*` はこの WP が単独で担当）
- **目的:** どの MCP クライアントからでも、スキーマ取得 → 検証 → 読み出し → 下書き保存 → プレビュー URL 取得を行えるようにする。DB がなくてもファイル保存で動くようにする。
- **作成するファイル:**
  - `tools/core/lessons.js`（ロジックだけを置き、テストしやすくする）
    - `getLessonSchema({profile:'llm'|'full'})`: スキーマ、契約、お手本を返す
    - `validateLessonDraft(lesson)`: 検証と lint を行う
    - `getLesson({courseSlug, lessonId})`: `content/` と `drafts/` を読む。`curriculumId` が指定されれば DB から読む
    - `upsertLessonDraft({courseSlug, lesson, baseHash?})`
      - 既定（`RP_LESSON_STORE=fs`）では `content/courses/<slug>/drafts/<id>.lesson.json` に書く。
      - `baseHash` が食い違えば conflict を返す。
      - `provenance` を自動で付ける。
      - DB モードでは `curriculum_versions.content_json` に下書きとして入れる。テストはモックのコネクションプールで行う。
    - `previewUrl()`
    - slug と ID は `^[a-z0-9][a-z0-9-]*$` で検証し、パス・トラバーサルを拒否する。
  - `server/tests/mcpLessonTools.test.js`
  - `scripts/lessons/mcp-smoke.mjs`（SDK の `Client` と `StdioClientTransport` でツール一覧を取り、`lesson-validate` を呼ぶ）
- **変更するファイル:**
  - `mcp-server/index.js`
    - `policyTool` で `lesson-schema-get`、`lesson-validate`、`lesson-get`、`lesson-upsert-draft`、`lesson-preview-url` を登録する。説明は日英併記、入力は zod の shape にする。教材本体は `z.record(z.string(), z.unknown())` で受け取り、`validateLessonDraft` でパス付きのエラーを返す。
    - リソース `rp://schema/lesson/v1`、プロンプト `author-lesson` を追加する。
  - `mcp-server/tool-registry.json`: 5 ツールを追加する（`exposure_profiles:["curriculum-builder","admin"]`、upsert は `risk:"write"`、`audit:true`、`max_calls_per_session:50`）
  - `tools/core/curriculum.js:246-276`: `saveDraft` を実在する列（`curriculum_versions.content_json`）に書くよう直し、モックのプールでテストする
- **受け入れ条件:**
  - 共通の DoD を満たす（新しいテストを含む）。
  - `RISE_PATH_MCP_PROFILE=curriculum-builder node scripts/lessons/mcp-smoke.mjs` で 5 ツールが一覧に出る。
  - お手本教材の `lesson-validate` が `ok:true`、壊した教材ではパス付きのエラーを返す。
  - `lesson-upsert-draft` で `drafts/` にファイルが作られる。古い `baseHash` では conflict になる。
  - `../` を含む ID は拒否される。
  - DB がなくてもすべて動く。

### WP-08　サーバー側 LLM ゲートウェイ、Claude 対応、キー漏洩の修正
- **規模:** L（1.5 日）
- **依存:** なし（`tutor` の入力形式は §9.1 の契約に合わせる）
- **衝突:** package.json、server.js、`vite.config.ts`、settings 系の画面
- **目的:** LLM の呼び出しをすべてサーバーの窓口に集め、ブラウザからキーと SDK をなくす。Anthropic、Gemini、mock を切り替えられるようにする。
- **作成するファイル:**
  - `server/llm/index.js`: `createGateway(config)`、`getGateway()`（環境変数から組み立てる）、`generate(req)`、`stream(req)`（非同期イテレータ）
  - `server/llm/models.config.js`: §6.2 の表。`LLM_TASK_*` と `LLM_PROVIDER`（強制指定。例: `mock`）で上書きできる
  - `server/llm/providers/anthropic.js`
    - JSON 出力は `messages.parse` と `zodOutputFormat`（使えなければ JSON Schema を直接渡す）。
    - 長文は `messages.stream().finalMessage()`、`output_config.effort` はタスクごと。
    - `system` の固定部分に `cache_control` を付ける。
    - `fallbacks:"default"` とベータ `server-side-fallback-2026-07-01` を付ける。
    - `refusal` と `max_tokens` は型付きの `LlmError` にする。
    - SDK の型付き例外を、詳しいものから順に catch する。
  - `server/llm/providers/gemini.js`: `config.systemInstruction`、`responseJsonSchema`、`abortSignal`、`httpOptions.timeout`
  - `server/llm/providers/mock.js`: スキーマ通りの決まった応答を返す。テスト、デモ、キーがないときの既定
  - `server/llm/structured.js`: zod で検証し、失敗したらエラー文を添えて 1 回だけ修復を依頼する
  - `server/llm/errors.js`
  - `server/llm/prompts/{writingFeedback,personalityInsight,tutor}.js`（固定部分を先に、ユーザー入力は区切りタグで囲む）
  - `server/routes/llm.js`
    - `GET /llm/status`: 秘密情報を含まない。`{providers:{anthropic,gemini,mock}, tasks}`
    - `POST /llm/writing-feedback`
    - `POST /llm/personality-insight`
    - `POST /llm/tutor`: SSE で `text.delta` と `done`。§9.1 の形を zod で検証、`excerpt` は 1,500 字以内、`mode` が `socratic` なら答えを出さない
  - `services/llmApi.ts`（`apiFetch` を使ったラッパー）
  - `server/tests/llmGateway.test.js`（タスクの振り分け、上書き、プロバイダ障害時のフォールバック、修復の経路、キーなしで 503）
  - `server/tests/llmRoute.test.js`（mock で 3 つのエンドポイント）
- **変更するファイル:**
  - `package.json`（`npm install @anthropic-ai/sdk`、0.135 系）
  - `server.js`: `app.use('/api/v2/llm', optionalAuth, aiLimiter, llmRoutes)`。`/api/v2/ai` に `requireAuth` を付ける
  - `server/routes/ai.js:45,275`: `req.userId` を使う
  - `vite.config.ts`: `define` ブロックと、`genai` の manualChunk を削除する
  - `services/geminiService.ts`: ブラウザ側の SDK 呼び出しを削除する（型だけ残すか、ファイルを `services/llmTypes.ts` に置き換える）
  - `components/common/LessonView.tsx`、`components/features/dashboard/assessment/PersonalAssessmentView.tsx`: `llmApi` を使う。「Powered by Gemini 2.5 Flash」の表示を消す
  - キー関連の画面: `services/geminiApiKey.ts` を削除し、`components/features/settings/{SettingsApiKeyView,GeminiApiKeyForm}.tsx` と `SettingsView.tsx`、`ProfilePassport.tsx` を「AI はサーバーで安全に実行されています」と `/llm/status` の表示に置き換える
  - `components/features/ai/RisePathConciergeView.tsx` は、どこからも使われておらず構文エラーもあるので削除する
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `GEMINI_API_KEY=SENTINEL_LEAK_123 npm run build && ! grep -r SENTINEL_LEAK_123 dist/` が成功する。
  - `grep -rn "@google/genai" services components` の結果が 0 件で、ビルド出力から `genai-*.js` が消えている。
  - キーがない状態で `/api/v2/llm/status` が `mock:true` を返す。
  - `LLM_PROVIDER=mock` で `/assessment` の診断結果と、LessonView の文章フィードバックが表示される（スクリーンショット）。
  - `/llm/tutor`（mock）の SSE を curl で受け取れる。
  - 設定画面にキー入力欄が残っていない。

### WP-09　ダッシュボードとランディングの刷新
- **規模:** M〜L（1〜1.5 日）
- **依存:** WP-01、WP-02、WP-04（`progressStore`、`content/index.ts`）
- **衝突:** なし（対象の 3 画面はこの WP が単独で担当）
- **目的:** 第一印象をデザインシステムに沿った、正直なものにする。目標の見た目は `shots-before/extra/design/dashboard-desktop.png` と `landing-desktop.png`。
  - 注意: モックのサイドバー（5 項目の IA）は Phase 2 の目標です。この WP では本文エリアだけをモックに合わせ、サイドバーは WP-02 で整理した構成のままにします。
- **作成するファイル（`components/ui/` 配下）:**
  - `Button.tsx`（primary / secondary / ghost、サイズ sm / md / lg、トークンだけを使う）
  - `PageHeader.tsx`（日付などの小見出し、h1、説明、操作ボタンの枠）
  - `CourseCard.tsx`
    - 表紙は World のグラデーションと記号で生成する。画像を使う場合は `onError` で生成表紙に切り替える。`alt=""`。
    - 2 行で省略するタイトル、メタ情報（レッスン数・所要時間）、進捗バー。
  - `EmptyState.tsx`
  - `ProgressCluster.tsx`（連続日数と Lv / XP は実データ。ゼロ状態の文言付き。`.tabular`。作った当時はブラウザの `gamificationService` から計算していました。Phase 5 からは、サーバーの記録から数えた値（`useAchievements`。[ai-access-plan.ja.md](ai-access-plan.ja.md) の 9 章）を出します）
- **変更するファイル:**
  - `components/features/dashboard/MissionControlDashboard.tsx`
    - 見出しは `PageHeader`（ゴシックの H1「おかえりなさい、{name} さん」。字間を広げた小見出しは使わない）。
    - 「続きから」カードは `getLastLesson()` の実データ。データがなければ「Vibe Coding 第1章からはじめる」と、その章の学習目標を表示する。
    - 「今日の復習 0枚」と「AI先生は教材の中に」は `EmptyState` で出す。
    - トラックは `CourseCard` × 4（Vibe、Unity、Blender、Art）。レッスン数は `listCourses()` から取り、なければ固定値を出さない。
    - 「Claude Codeで教材をつくる」カードからガイドへリンクする。
    - **次を削除する:** クエストボード、AI コーチカード、スマートスケジュール、固定配列のモメンタムグラフ、週間目標 75%、レベルの赤い点（818 行目）、「今週 2.5h」。
    - LifeJournal の週次ウィジェット（実データ）は残す。
  - `components/common/ExperienceLandingView.tsx`
    - ライトの「Sunrise Studio」ヒーローにする。
      - JP 見出し:「読むたびに、わかるが増えていく。」
      - EN 見出し:「Every page you read, more clicks into place.」
      - 本文はモック通り。
    - 主ボタンは「ゲストで第1章を読む」（ゲストとしてログインし、`/learn/vibe-coding/vibe-ch1` へ）。副ボタンは「教材をつくる人へ」（ガイドへ）。
    - リーダーのスクリーンショット `public/marketing/reader-jp.webp` を入れる。WP-04 の画面から撮影する。
    - 特徴カードを 3 つ（読む / 確かめる / つくる）。
    - 削除する: 「Neuro-Adaptive」「V2.0」「ミリ秒」「Cognitive Fingerprinting」、何もしない「デモを見る」、和文の斜体。
    - 言語は EN / JP だけ（FR はフラグで隠す）。
  - `components/features/dashboard/MyContent.tsx`: 「¥4,500 Total Earnings」と、作り物の生成ログ（116-140 行目）を削除するか、`EmptyState` にする
  - （余力があれば）`LearningHub.tsx` のカードを `CourseCard` に置き換え、壊れた画像に `onError` の代替表示を付ける
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `rg -n "2\.5h|75%|¥4,500|Neuro|ミリ秒|Cognitive" components/features/dashboard components/common/ExperienceLandingView.tsx` が 0 件。
  - ゲストの `/` と、ログアウト状態のランディングを、デスクトップ・モバイル × JP・EN の 8 枚撮影し（`shots-after/wp09/`）、モックとの差分をレビューする。
  - 新しく作った部品に `text-slate-400` と色の直書きがない。
  - 「続きから」が WP-04 で読んだ章を指す（Playwright で 1 章開いてからホームへ戻って確認）。

### WP-10　旧リーダーの安全化（移行が終わるまでのつなぎ）
- **規模:** S（0.5 日）
- **依存:** なし
- **衝突:** なし
- **目的:** まだ新リーダーに移していない生成コース（`GeneratedDocView`）と Unity（`VibeDocView`）の XSS 経路と、目立つ壊れ方を止める。
- **変更するファイル:**
  - `components/features/ai/GeneratedDocView.tsx`
    - 338 行目を `securityLevel:'strict'` にする。
    - 270 行目の `console.log` を削除する。
    - 1669-1671 行目の `li` の flex をやめ、番号付きリストを正しく表示する。
    - 787 行目の斜体の明朝サブタイトルを、通常のゴシックにする。
    - スライドデッキがなければスライドタブを隠す。
  - `components/features/programming/VibeDocView.tsx`
    - 74 行目を `strict` にする。
    - `table` の case を追加する（新リーダーの `TableBlock` と同じ見た目）。
    - `language` を props ではなく `useLanguage()` から取る。
    - 218 行目の「CHAPTER 1」の固定をやめ、データから表示する。
    - 29 行目と 40 行目のトラック名をデータから取る。
    - PDF が取得できなければスライドタブを隠す。
    - 750 行目のリストを修正する。
  - `components/features/ai/GeneratedLessonViewWrapper.tsx:49,53`、`GeneratedCourseViewWrapper.tsx:28`、`services/curriculumAdapter.ts:440-487`: `console.log` を削除する
  - `components/features/ai/GeneratedCourseView.tsx:53,64`: 「Gemini 3.0 Pro」の表示を削除する
  - `components/features/ai/CourseGeneratorView.tsx:18`: 学習者向けのモデル選択を隠す
- **受け入れ条件:**
  - 共通の DoD を満たす。
  - `rg "securityLevel: ?'loose'"` が 0 件。
  - JP 表示の `/unity/chapter-0` で表が 2 つ表示され、本文が日本語になる。
  - 「Failed to load PDF」がどの画面にも出ない。
  - `/generated-lesson/demo-curr-001` の番号付きリストに番号が出る（スクリーンショット）。

---

### 9.2 実施の推奨順と担当の割り振り例

| ウェーブ | 並行して走らせる WP | 終わったら確認すること |
|---|---|---|
| 1 | WP-01、WP-03、WP-08、WP-10 | ビルドとテストが通る。キー漏洩がない（WP-08）。12 レッスンの検証が通る（WP-03） |
| 2 | WP-02、WP-07 | モバイルの修正（main の幅 380px 以上）、ナビのチェック、MCP のスモークテスト |
| 3 | WP-04 | `/learn/vibe-coding/vibe-ch1` を日英・デスクトップ・モバイルで撮影 |
| 4 | WP-05、WP-06、WP-09 | `/dev/blocks`、`lessons:preview` の metrics、ホームとランディングをモックと比較 |
| 最後 | 全体 | `npm run typecheck && npm run build && npm test && npm run lessons:validate`、全ルートの before / after スクリーンショットを並べて比較（`.shots/shoot.mjs`） |

### 9.3 依存パッケージ追加の承認記録

2026-10-19、オーナーが次の 6 つの実行時依存の追加を承認しました（WP-00 のコミット `594f5f5` で追加）。`AGENTS.md` のルールはそのままで、これから追加する依存には、あらためてオーナーの承認が必要です。

| パッケージ | バージョン | 用途 |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.135.0` | サーバー側 LLM ゲートウェイの Claude プロバイダー（`server/llm/providers/anthropic.js`） |
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP サーバー（`mcp-server/`）。以前は推移的に入っていただけ |
| `dompurify` | `^3.4.11` | Mermaid の SVG と旧リーダーの HTML のサニタイズ |
| `remark-gfm` | `^4.0.1` | レッスン本文の Markdown（表など）の描画（`components/lesson/Md.tsx`） |
| `shiki` | `^4.5.0` | コードブロックのシンタックスハイライト（`components/lesson/blocks/highlighter.ts`） |
| `zod` | `^3.25.76` | 教材スキーマ `risepath.lesson/v1`（`shared/lesson/schema.js`）。以前は推移的に入っていただけ |
