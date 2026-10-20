# Brief: vibe-coding/cc-02-permissions

「第2回｜任せる範囲を決める：権限モードと巻き戻し」。Claude Code コース（cc-*）モジュール 1「はじめる」の 2 本目、全 11 回中の第 2 回。
下書きはプレビューのため `vibe-coding` コースに置く（公開先はオーナーが決める。`next` なし）。

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を使い始めた人。バイブコーディングコース第3章（VS Code）・第5章（GitHub）程度の基礎がある人、または他の AI コーディングツールの経験者。
- すでに知っていること（前提） / prior knowledge: 第1回で `cc-practice` フォルダを作り、質問 → 小さな変更 → 差分確認 → コミットを 1 回通した。第1回の時点で「v2.1.283 からターミナルのセッションは auto モードで始まり、多くの操作が確認なしで進む」「権限モードは第2回で扱う」と聞いている。CLAUDE.md・セッション・差分の言葉は第1回で定義済み。ターミナルで `cd`・`ls` が使え、Git の commit と push の意味がわかる。
- 前のレッスン / previous lesson: 第1回｜最初のタスクを任せる。次は第3回｜探索→計画→実装→コミット（プランモードを本格的に使う）。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: apply): 場面に合う権限モードを選べる
- o2 (bloom: analyze): `/rewind` で戻せるものと戻せないものを見分けられる
- o3 (bloom: apply): `git push` の前に確認を挟む確認ルール（ask）を書ける

## 範囲 / Scope
- 扱う / in:
  - 6 つの権限モード：Manual モード（設定値 `default`）・`acceptEdits`・プランモード（`plan`）・auto・`dontAsk`・`bypassPermissions`。何が確認なしで動くかと向いている場面を表で比べる。
  - Shift+Tab の切り替え順（auto → Manual → `acceptEdits` → プランモード → auto）と画面下の表示。旧名「default モード」＝ Manual（v2.1.200 で改名）を 1 文だけ。
  - auto モード：v2.1.283 以降の対話セッション（ターミナル・VS Code）の既定。分類器が確認を引き受け、force push・`git reset --hard`・本番デプロイなどを止めるが、作業中のリポジトリへのふつうの push は既定で通す。Anthropic 自身の評価で 17% の見逃し → 本番に関わる操作は人が見る。
  - `bypassPermissions`（`--dangerously-skip-permissions`）は隔離したコンテナや仮想マシンだけ。
  - 権限ルール（allow / ask / deny）、`.claude/settings.json` の書き方、評価順（拒否 → 確認 → 許可、最初に一致したもの）、守らせるのは Claude Code でモデルではない（CLAUDE.md や依頼文は強制にならない）。`Bash(… *)` の末尾 ` *` の意味、`git -C . push` が一致しない限界、`Read(./.env)` の限界。
  - チェックポイントと `/rewind`（Esc 2 回）：戻るのは Claude のファイル編集ツールでの変更だけ。Bash（`rm`・`mv`・`cp`）、外への操作（push・DB・デプロイ）、Claude Code の外での編集は戻らない。バージョン管理の代わりではない。
- 扱わない（別レッスン） / out: プランモードの使い方の詳細と承認の選択肢（第3回）、CLAUDE.md の書き方（第6回）、フックで確実に止める方法（第8回で予告のみ）、`claude -p` と CI での `dontAsk` + `--allowedTools`（第9回）、秘密情報の扱いとサンドボックス・`autoMode.environment`・`/auto-mode-setup`（第10回）、保護されたパス、ワークスペースの信頼、mods。
- 学習者がよく持つ誤解 / likely misconceptions（誤答の選択肢に使用）:
  - auto モードなら何をさせても安全（report §6）→ 分類器の見逃しは 17%。本番に関わる操作は人が見る（q2・ps3・e1・e2）。
  - `/rewind` があるから git は要らない（report §6）→ Bash や外への操作は戻らず、長く残す履歴にもならない（q5・e3・e4）。
  - CLAUDE.md や依頼文に「〜しないで」と書けば守られる（report §6）→ 強制は permissions（e1・e6・本文 rules-order）。
  - 細かい許可ルールが拒否や確認を上書きする → 順番は拒否 → 確認 → 許可で固定（q3）。
  - `Bash(git push)` で push 全部に一致する／`Bash(gh * create)` でよい → `*` の位置と有無（q4・e6）。
  - `Bash(git push *)` はどんな書き方の push にも一致する → `git -C . push` は素通り（e5、pitfall）。
  - 確認を求めるなら deny → deny は止める、確認は ask（q4・e6）。
  - `bypassPermissions` を短時間だけノート PC で使うのは平気（e1）。

## 形式 / Format
- 所要時間 / minutes: 22。常に表示される本文 2,634 字 ÷ 450 ≒ 5.9 分 + 問題 15 問（predict 1、inline 8、exam 6）× 40 秒 = 10 分 + 演習 3 課題（モードの仕分け、ルールを試す、巻き戻しを試す）× 2 分 = 6 分 → 21.9 分。
- 本文の長さ（JP 文字、空白除く、`vibe-ch2` と同じ数え方）:
  - 常に表示される本文（markdown・callout・definitions・表のセル・steps の md と expect・チェックリスト・summary）: 2,634 字。うち 386 字はコード表記（`bypassPermissions`、`.claude/settings.json`、`--dangerously-skip-permissions` など）で、日本語の文はおよそ 2,250 字。
  - steps の hint・troubleshoot（折りたたみ）を含めると 2,798 字、prompt の expect まで含めると 2,996 字。
  - 予算 2,400 字を常時表示で約 10% 超えている。理由：指定された範囲（6 モード・auto・ルール・巻き戻し）と手を動かす演習を 1 回に収めたため。レビューで削るなら、演習2の巻き戻しの手順（`pw-restore` と依頼文2、約 150 字）が最初の候補。
- 難易度 / level: beginner
- ロケール / locales: jp のみ（英語版は公開先が決まってから）
- 演習の題材 / practice task idea:
  - 演習1：3 つの場面（無人の自動テスト、差分を見ながらの編集、長いテスト修正）にモードを選ぶ仕分けクイズ（2-1 の表を見ずに）。
  - 演習2：第1回の `cc-practice` に `.claude/settings.json` を自分で書き（`ask: Bash(git push *)`、`deny: Read(./.env)`）、ダミーの `.env` を置いて、結果を予想してから Claude Code で試す（リモートがないので push しても外には何も出ない）。続けて、編集ツールでの追記と Bash の `cp` を 1 回ずつ起こし、「Restore code」で編集だけが戻ることを確かめる。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。auto モードが対話セッションの既定になったのは v2.1.283、default → Manual の改名は v2.1.200。
- OS / environment: macOS・Linux・Windows（WSL 含む）のターミナル。VS Code は入力欄の下のモード表示で切り替える、と予告のみ（演習はターミナル）。
- 使ってはいけないもの / avoid: 大事なリポジトリでの演習、破壊的なコマンド、本物の秘密情報（`.env` はダミー値 `dummy-not-a-secret`）、料金の記載、プレビュー機能を必須の手順にすること。

## 資料 / Sources
- cc-permission-modes — Choose a permission mode（モードの表、Shift+Tab の順と表示、v2.1.283 の既定、auto が安全を保証しない、bypassPermissions は隔離環境だけ）https://code.claude.com/docs/en/permission-modes ・日本語版 https://code.claude.com/docs/ja/permission-modes
- cc-permissions — Configure permissions（deny → ask → allow、Claude Code が守らせる、`*` の意味と ` *` が引数なしにも一致、`git -C . push` は一致しない、`Read(./.env)`、`/permissions` にルールと出どころ）https://code.claude.com/docs/en/permissions
- cc-auto-mode-config — Configure auto mode（作業中のリポジトリへの push は既定のブランチも含めて既定で許可、ask ルールは auto でも必ず確認、`Bash(git push *)` / `gh pr create` の例）https://code.claude.com/docs/en/auto-mode-config
- cc-checkpointing — Checkpointing（Esc 2 回 / `/rewind`、Restore の選択肢、100 回分、Bash と外部の変更は戻らない、バージョン管理の代わりではない）https://code.claude.com/docs/en/checkpointing
- auto-mode-eng — How we built Claude Code auto mode（承認疲れ、実際の行き過ぎた操作の 17% を見逃し「正直な数字」）https://www.anthropic.com/engineering/claude-code-auto-mode
- cc-changelog — Claude Code CHANGELOG（v2.1.200 の改名）https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- 事実ファイル（検証済み 2026-10-20）：docs-11, docs-12, docs-13, docs-14, docs-15, docs-17, safety-1, safety-2, safety-3, safety-4, safety-5, safety-6, safety-7, safety-8, safety-9, safety-15, learning-25, learning-26, releases-3, releases-4, practice-31。Permission modes・Configure permissions・Configure auto mode・Checkpointing は 2026-10-20 に WebFetch で本文を確認した。

## Outline

| section id | role | title | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：確認は減らしたい、でも push は止めたい | 確認なしで進むのは便利だが、push まで勝手に進むのは困る | markdown（第1回の想起＋問題、3 文）、callout note（v2.1.304 時点・公式ドキュメント日本語）、quiz predict | `q0` → o3（ungraded：auto の既定で push は通る） |
| `modes` | concept | 2-1. 権限モードで、確認なしに進める範囲を選ぶ | 6 つのモードは「確認なしで動く範囲」が違う。Shift+Tab で切り替える | markdown lead（権限モードの定義）、table（6 モード × 動くもの × 場面）、markdown（Shift+Tab の順、画面下の表示、旧名 default） | `q1` → o1（初めてのリポジトリを調べる → プランモード） |
| `auto-mode` | concept | 2-2. auto モードに任せてよいこと、よくないこと | auto は分類器が確認を引き受けるが、見逃しもある | markdown lead（承認疲れ）、definitions（分類器）、markdown（既定で止めるもの・通す push）、markdown（17%、本番は人が見る）、callout warning（bypassPermissions は隔離環境だけ） | `q2` → o1（本番サーバーのスクリプト → Manual に切り替え） |
| `rules` | concept | 2-3. 権限ルールで「この操作だけは」を決める | ルールは拒否 → 確認 → 許可の順で、守らせるのは Claude Code | markdown lead、definitions（権限ルール・確認ルール・拒否ルール）、markdown（順番、モデルではなく Claude Code）、diagram（判定の流れ、8 ノード） | `q3` → o3（`Bash(git *)` 許可 + `Bash(git push *)` 確認 → 確認が出る） |
| `rules-example` | example | 2-4. 例題：push の前に確認を挟む設定を書く | 確認か拒否かを決め、ルールの形に書き、読み込まれたか確かめる | markdown、steps（3 ステップ・目的ラベル・理由・expect）、code `.claude/settings.json`、callout pitfall（`git -C . push`、`Read` の限界） | `q4` → o3（npm test は allow、push は ask：`*` の有無と ask/deny） |
| `rewind` | concept | 2-5. チェックポイントと `/rewind`：戻せるもの、戻せないもの | 戻るのは Claude の編集ツールでの変更だけ。git の代わりではない | markdown lead（チェックポイントの定義、100 回分）、markdown（Esc 2 回 / `/rewind`、戻すものを選ぶ）、table（変え方 × 例 × 戻るか）、markdown（バージョン管理の代わりではない） | `q5` → o2（4 つの変更のうち戻るのは編集ツールの変更） |
| `practice-sort` | practice | 演習1：場面ごとに権限モードを選ぶ | 表を見ずに場面からモードを選ぶ（想起） | markdown、quiz inline（3 場面） | `ps1` → o1（`dontAsk`）、`ps2` → o1（`acceptEdits`）、`ps3` → o1（auto） |
| `practice-rules` | practice | 演習2：ルールを試し、巻き戻しも確かめる | 自分でルールを書き、予想してから試す。巻き戻しで戻るものを体験する | markdown、code（terminal：`.claude`・ダミー `.env`・`rewind-practice.md`）、steps（4：hint → troubleshoot → 2-4 のコードが模範解答）、prompt 依頼文1（`{{読ませないファイル}}`、expect）、prompt 依頼文2（`{{足す1行}}`、expect）、checklist（4、応用 1 つ） | — |
| `check` | check | 理解度チェック | 全目標の確認（転移を含む） | quiz exam（6） | `e1` → o1（転移：知らないリポジトリでの `--dangerously-skip-permissions`）、`e2` → o1（`⏸ manual mode on` から auto へ）、`e3` → o2（`rm` と編集の混在 → Restore code）、`e4` → o2（「git は要らない」への返答）、`e5` → o3（`git -C . push` は一致しない）、`e6` → o3（転移：`gh pr create` の ask） |
| `summary` | summary | まとめ | 持ち帰る 4 点、振り返り、次の一歩 | summary（4）、markdown（振り返り＋第3回へ）、flashcards（7）、askTutor（3） | — |

Contract check: hook は問題 3 文 + predict。セグメント 5（concept 4、example 1）、すべてに inline 問題（content 7 セクション中 6 に inline）。新出用語はセグメントごとに 3 つまで（modes：権限モード / auto-mode：分類器 / rules：権限ルール・確認ルール・拒否ルール / rewind：チェックポイント。6 つのモード名は表の行として示す）。例題（2-4 の steps、理由つき）→ 演習2（同じ設定を見ずに書く、別の依頼で試す）→ exam。各目標に inline と exam の問題が 2 問以上（o1：q1・q2・ps1〜3・e1・e2、o2：q5・e3・e4、o3：q3・q4・e5・e6）。callout は各セクション 2 つまで。図は 1 つ（判定の流れ）。画像なし。

## Assumptions
- 対話セッションではなく、オーナーへの確認なしで進めた（ヘッドレス）。上の構成をそのまま使った。
- 第1回の練習用フォルダは `cc-practice`（第1回の下書きの演習と同じ名前）。見つからない場合は第1回の手順で作り直す。
- 演習の `.env` はダミー値だけ。練習用フォルダにはリモートがないので、確認で「Yes」を選んでも push は失敗し、外には何も送られない。
- 演習で Claude Code を「起動し直す」ように書いた。設定ファイルの変更が実行中のセッションに反映されるかは公式ドキュメントで確かめられなかったため、確実な方法を選んだ（`/permissions` の画面からの変更は次のツール呼び出しから反映される、とは書かれている）。
- 承認疲れの数字（確認の 93% が許可される）は本文の長さの都合で載せなかった。17% は「頼んだ範囲を超えた実際の操作」に対する見逃しとして書いた（engineering post の real overeager actions、n=52）。
- 第3回・第8回・第10回への予告は、コース計画（report §7）の各回の範囲に合わせた。
