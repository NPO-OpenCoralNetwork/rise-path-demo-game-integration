// @ts-check
/**
 * The codes the backup and restore scripts print (Phase 9, owner decision D4; design §5.4; doc/guides/
 * first-launch.ja.md 13 章): BK1-BK8 (backup.sh daily), JO1-JO2 (backup.sh journal), IB0-IB5
 * (install-backup.sh), DR0-DR7 (restore-drill.sh), RS0-RS8 and RS10-RS11 (restore-db.sh; RS9, the byoa role
 * SQL, is not in Phase 9: TR9d). The scripts are bash on a host without node, so deploy/risepath-vm/scripts/
 * backup-common.sh holds the same title and fix in its own table; server/tests/backupScripts.test.js keeps the
 * two equal and server/tests/firstLaunchRunbook.test.js keeps 13 章's rows equal to this catalog.
 *
 * Each printed code is these lines, where わけ (the reason) is optional, a fixed text of the script that
 * names a step or a file, never a value:
 *   ❌ [BK3] <title>
 *      わけ: <reason>
 *      直し方: <fix>
 *      くわしく: 手順書 13 章の「BK3」
 * `level` is the level the scripts print it at: E (❌, the run stops), W (⚠️, the run goes on).
 */

/** @typedef {{ code: string, level: 'E' | 'W', title: string, fix: string }} BackupCode */

const JOURNAL = '`sudo journalctl -u risepath-backup -n 50` で出た行をエージェントに見せます（手順書 17 章）。';
const AGENT = '出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。';
// Review round 2, finding 16: a VM made without BACKUP_SA_EMAIL has no backup service account; 手順書 4.1 has the commands.
const SA = 'VM を BACKUP_SA_EMAIL なしで作ったときは、手順書 4.1 の 3 つのコマンドで控えのサービスアカウントを付けます。';

export const BACKUP_CODES = Object.freeze(/** @type {readonly BackupCode[]} */ ([
  // backup.sh daily: the systemd unit risepath-backup.service (its lines are in journalctl).
  { code: 'BK1', level: 'E', title: '控えを始める前の確かめで止まりました（設定、鍵、DB、ディスクの空きのどれかです）。', fix: `「わけ」の行のとおりに直します。わからないときは、${JOURNAL}` },
  { code: 'BK2', level: 'E', title: '控えの前に、DB の行の数を数えられませんでした（まだ何も作っていません）。', fix: `DB が動いているかを \`cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env ps\` で見ます（db の行の STATUS に healthy とあれば動いています）。動いているのに出るときは、${JOURNAL}` },
  { code: 'BK3', level: 'E', title: 'DB の控え（pg_dump）か、その暗号化が失敗しました（外には何も送っていません）。', fix: `デプロイと重なったときは、\`sudo systemctl start risepath-backup.service\` で作り直します。また出るときは、${JOURNAL}` },
  { code: 'BK4', level: 'E', title: '控えのあとに、DB の行の数を数えられませんでした（外には何も送っていません）。', fix: `デプロイと重なったときは、\`sudo systemctl start risepath-backup.service\` で作り直します。また出るときは、${JOURNAL}` },
  { code: 'BK5', level: 'E', title: 'アップロードされたファイル（uploads）の控えか、その暗号化が失敗しました（外には何も送っていません）。', fix: `\`sudo systemctl start risepath-backup.service\` で作り直します。また出るときは、${JOURNAL}` },
  { code: 'BK6', level: 'E', title: '控えの目録（manifest.json）を作れませんでした（外には何も送っていません）。', fix: JOURNAL },
  { code: 'BK7', level: 'E', title: '控えを Google Cloud のバケットに送れないか、送ったあとの大きさが合いません。', fix: `サービスアカウントの 2 つの役割と、backup.env のバケットの名前を見直します（手順書 3.8）。${SA}直らないときは、${JOURNAL}` },
  { code: 'BK8', level: 'E', title: 'VM の中の古い控えを消せませんでした（外への控えはできています）。', fix: `\`sudo ls -l /var/backups/risepath\` で出た行と、${JOURNAL}` },
  // backup.sh journal: the hourly unit risepath-backup-journal.service.
  { code: 'JO1', level: 'E', title: '削除の記録（1 時間ごと）を控えられませんでした。', fix: '次の 1 時間で直ることがあります。2 回続けて知らせが来たときは、`sudo journalctl -u risepath-backup-journal -n 50` で出た行をエージェントに見せます（手順書 17 章）。' },
  { code: 'JO2', level: 'W', title: '毎日の控え（バックアップ）が 36 時間できていません。', fix: 'その日のうちに `sudo journalctl -u risepath-backup -n 50` を見て、エージェントに相談します。止まったまま、バケットのライフサイクルの日数（backup.env の BACKUP_RETENTION_DAYS の日数。「わけ」の行に出ます）を過ぎると、VM の外の控えがなくなります（手順書 17 章）。' },
  // install-backup.sh: the owner, with sudo (手順書 6.4, 16.3). IB0: a usage mistake, or Docker or systemd did not answer.
  { code: 'IB0', level: 'E', title: '控えの設定を続けられません（指定のまちがいか、Docker か systemd が答えません）。', fix: '「わけ」の行のとおりに直して、もう一度実行します。Docker か systemd のときは、`sudo docker ps` と `systemctl status risepath-backup.timer` で出た行をエージェントに見せます（手順書 6.4）。' },
  { code: 'IB1', level: 'E', title: '控えの設定は、sudo を付けて実行します。', fix: '`sudo ./scripts/install-backup.sh` のように、前に sudo を付けて、もう一度実行します（手順書 6.4）。' },
  { code: 'IB2', level: 'E', title: '控えの設定のファイル（/etc/risepath-backup/backup.env）に、バケットの名前がないか、形がちがいます。', fix: '`sudo nano /etc/risepath-backup/backup.env` でバケットの名前を書いてから、もう一度実行します（手順書 6.4）。' },
  { code: 'IB3', level: 'E', title: '失敗の知らせの受け口がありません（https の URL が見つかりません）。', fix: 'stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、もう一度実行します（手順書 3.6）。' },
  { code: 'IB4', level: 'E', title: 'バケットに試しのファイルを送れません（VM のサービスアカウントか、バケットの設定です）。', fix: `VM のサービスアカウントと、バケットの 2 つの役割を見直します（手順書 3.8）。${SA}直らないときは、出た行をエージェントに見せます（手順書 17 章）。` },
  { code: 'IB5', level: 'E', title: '鍵の確かめで止めました（鍵がないか、鍵どうしが合いません。鍵は変えていません）。', fix: '「わけ」の行のとおりにします。新しい VM で、前の控えがあるときは、`--new-key` ではなく `--import-key` で、しまっておいた鍵を戻します（手順書 16.3）。' },
  // restore-drill.sh: the owner, monthly (手順書 6.5, 16.1).
  { code: 'DR0', level: 'E', title: '戻す練習を始められません（sudo、設定、鍵、Docker、ディスクの空きのどれかです）。', fix: '「わけ」の行のとおりに直してから、`sudo ./scripts/restore-drill.sh` をもう一度実行します（手順書 16.1）。' },
  { code: 'DR1', level: 'E', title: 'バケットから、使える控えを読み出せません（ないか、36 時間より前か、読めません）。', fix: `「わけ」が 36 時間より前のときは、毎日の控えが止まっています。${JOURNAL}「わけ」がトークンかサービスアカウントの役割のときは、サービスアカウントの 2 つの役割を見直します（手順書 3.8）。控えがまだないときは、手順書 6.4 の最初の控えを先にします。` },
  { code: 'DR2', level: 'E', title: '読み出した控えが、目録（manifest.json）と合いません（ファイルが壊れているか、書きかえられています）。', fix: `もう一度実行します。また出るときは、その控えは使えません。${AGENT}` },
  { code: 'DR3', level: 'E', title: '練習用の DB を動かせません（Docker）。', fix: '`sudo docker ps -a` を実行し、出た行をそのままエージェントに見せます（値は出ません。手順書 17 章）。' },
  { code: 'DR4', level: 'E', title: '控えを練習用の DB に戻せませんでした（鍵がちがうか、控えが壊れています）。', fix: '`sudo ./scripts/install-backup.sh key-id` の key id が、launch-record.env の `BACKUP_KEY_ID` と同じかを見て、エージェントに相談します（手順書 16.1）。' },
  { code: 'DR5', level: 'E', title: '戻した DB の中身が、目録と合いません（文字コード、migration、行の数のどれかです）。', fix: AGENT },
  { code: 'DR6', level: 'E', title: 'アップロードされたファイルの控えを読めないか、ファイルの数が目録と合いません。', fix: AGENT },
  { code: 'DR7', level: 'W', title: '練習用の DB か、読み出した控えを片付けられませんでした。', fix: `\`sudo docker rm -f -v risepath-drill-db\` を実行します。また出るときは、${AGENT}` },
  // restore-db.sh: only with the agent (手順書 16.2, 16.3).
  { code: 'RS0', level: 'E', title: '戻す前の確かめで止めました（まだ何も変えていません）。', fix: '「わけ」の行のとおりに直します。事前チェックのエラーのときは、先にそれを直します（エージェントと。手順書 16.2）。' },
  { code: 'RS1', level: 'E', title: '戻しの途中の印を書くか、控えのタイマーを止めるか、動いている控えが終わるのを待つところで止まりました（DB はまだ変えていません）。', fix: '「わけ」の行と、`systemctl status risepath-backup.service` で出た行をエージェントに見せます（手順書 16.2）。' },
  { code: 'RS2', level: 'E', title: 'Rise Path の部品（api、mcp など）を止められませんでした（DB はまだ変えていません）。', fix: '`cd /opt/risepath/deploy/risepath-vm && docker compose --env-file stack.env ps` で出た行をエージェントに見せます（手順書 16.2）。' },
  { code: 'RS3', level: 'E', title: '戻す前の、削除の記録の書き出しができませんでした（DB はまだ変えていません）。', fix: 'DB が答えるのに書き出せないときは、戻しを続けません。出た行をエージェントに見せます（手順書 16.2）。' },
  { code: 'RS4', level: 'E', title: '戻す控えを選べないか、読み出した控えか削除の記録が、読めないか目録か鍵と合いません（DB はまだ変えていません）。', fix: '「わけ」の行をエージェントに見せ、`--from` で使う控えを決め直します。バケットの削除の記録が読めないとき（一覧かトークン）は、VM のサービスアカウントとバケットの権限をエージェントと直してから、同じコマンドでもう一度します（手順書 16.2）。' },
  { code: 'RS5', level: 'E', title: 'DB を控えから戻せませんでした（DB は空か、途中です）。', fix: 'ここから先はエージェントと進めます。DB は空か途中なので、同じコマンドに `--current-db-lost` を付けて、もう一度はじめから戻します（最初に書き出した削除の記録も使います。手順書 16.2）。' },
  { code: 'RS6', level: 'E', title: 'アップロードされたファイルを控えから戻せませんでした。', fix: '出た行をエージェントに見せます。同じコマンドで、もう一度はじめから戻せます（手順書 16.2）。' },
  { code: 'RS7', level: 'E', title: '戻した DB の migration が失敗しました。', fix: '出た行をエージェントに見せます。同じコマンドで、もう一度はじめから戻せます（手順書 16.2）。' },
  { code: 'RS8', level: 'E', title: '削除の記録をもう一度当てるところで止まりました（Rise Path は止めたままです）。', fix: '出た数と行をエージェントに見せます。DB が答えなかったとき（終わりの番号が 3）は、少し待って、同じコマンドで、もう一度はじめから戻します。削除の記録の行が読めなかったとき（終わりの番号が 1。何行目かが出ます）は、その行をエージェントと調べてから、同じコマンドで、もう一度はじめから戻します（手順書 16.2）。' },
  { code: 'RS10', level: 'E', title: '控えのタイマーと、再起動のときの起動を元に戻すか、戻したあとの控えを作るところで失敗しました（戻しは済んでいます）。', fix: '`sudo systemctl enable risepath-stack.service` と `sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` を実行し、出た行をエージェントに見せます（手順書 16.2）。' },
  { code: 'RS11', level: 'E', title: '戻したあとのデプロイ（deploy-stack.sh）が失敗しました（戻しと、削除の記録の当て直しは済んでいます）。', fix: '上に出たデプロイのコードを手順書 13 章で見て、エージェントとデプロイを直します。public で「[R3]」で止まったときは、`sudo ./scripts/restore-drill.sh` を実行し（RS10 で作った新しい控えで練習します）、それから `./scripts/deploy-stack.sh` を実行します（手順書 16.2）。' },
]));

export const ALL_CODES = Object.freeze(BACKUP_CODES.map((c) => c.code));
