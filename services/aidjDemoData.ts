export const AIDJ_DEMO_DATA: any = {
  id: 'demo-aidj-001',
  title: {
    en: 'AI DJ & Autocasting Masterclass',
    jp: 'AI DJ配信・自動化マスタークラス'
  },
  description: {
    en: 'Learn to generate AI music with Suno, control harmonic mixing, connect Mixxx via MCP, and automate YouTube Live broadcasting.',
    jp: 'Suno AIによる楽曲生成、調性制御、MixxxのMCP連携、そしてYouTube APIを用いた配信自動化ワークフローを体系的に学びます。'
  },
  ui_template_id: 'doc_chapter',
  duration: '12 hours',
  modelUsed: 'pro',
  modules: [
    {
      module_id: 'aidj-m1',
      title: { en: 'Suno AI & Sound Control', jp: 'Suno AI と音響制御' },
      objective: { en: 'Master Suno AI generation, prompts, keys, and Extended Mix.', jp: 'Suno AIのプロンプト制御、調性・テンポ指定、およびExtended Mix構築を習得する。' },
      estimated_hours: 4,
      lessons: [
        {
          lesson_id: 'aidj-m1-l1',
          title: { en: 'AI Music Pipeline', jp: 'AI音楽生成の仕組み' },
          subtitle: { en: 'Autoregressive Transformer and Audio Codec', jp: '自画回帰モデルと音声コーデックの基礎' },
          estimated_min: 20,
          sections: [
            {
              id: 'aidj-m1-l1-s1',
              title: { en: 'Overview', jp: '概要' },
              content: [
                { type: 'text', style: 'lead', text: { en: 'Understand the core machine learning pipelines behind modern music generation.', jp: '現代の音楽生成AIの背後にある機械学習パイプラインを理解します。' } },
                { type: 'text', text: { en: 'Suno AI converts style prompts and lyrics into stereophonic audio using an Autoregressive Transformer combined with Neural Audio Codecs.', jp: 'Suno AIは、スタイルプロンプトと歌詞テキストから自画回帰モデルとニューラル音声コーデックを用いてステレオ音声波形を生成します。' } },
                {
                  type: 'mermaid',
                  chart: `flowchart TD
    A[User Inputs: Style & Lyrics] --> B[Text Encoder: Tokenization]
    B --> C[Transformer: Codec Token Prediction]
    C --> D[Neural Audio Decoder: Stereo Waveform Reconstruction]
    D --> E[Post-Processor: Noise Reduction & Dynamics]
    E --> F[Output: WAV / MP3]`
                }
              ]
            },
            {
              id: 'aidj-m1-l1-s2',
              title: { en: 'Key Processing Phases', jp: '主要な処理段階' },
              content: [
                { type: 'text', text: { en: '1. Text Encoder: Tokenizes user input style tags and lyric structures.\n2. Autoregressive Transformer: Predicts discrete audio tokens sequentially.\n3. Audio Decoder: Reconstructs high-fidelity stereo waveforms.', jp: '1. テキストエンコーダー: スタイルタグや歌詞の構文を解析・特徴抽出します。\n2. 自画回帰トランスフォーマー: 前後の文脈を保ちながら音声トークンを確率的に予測生成します。\n3. 音声デコーダー: 離散的なトークンから高音質なステレオ波形を復元します。' } }
              ]
            }
          ],
          quiz: {
            id: 'quiz-aidj-m1-l1',
            title: { en: 'Pipeline Review', jp: 'パイプライン理解度テスト' },
            questions: [
              {
                id: 'q1',
                text: { en: 'What is the role of Neural Audio Codec in Suno AI?', jp: 'Suno AIにおけるニューラル音声コーデックの役割は何ですか？' },
                options: [
                  { id: 'a', text: { en: 'Directly search for matching lyrics online', jp: 'ネット上で一致する歌詞を検索する' } },
                  { id: 'b', text: { en: 'Compress audio waveforms into discrete tokens for Transformer processing', jp: '波形データをトランスフォーマーが処理できる離散トークンに圧縮・復元する' } },
                  { id: 'c', text: { en: 'Increase playback speed without changing pitch', jp: '音高を変えずに再生速度を上げる' } }
                ],
                correctAnswer: 'b',
                explanation: { en: 'Neural Audio Codec encodes complex stereo audio into discrete tokens, allowing the autoregressive model to predict them efficiently.', jp: 'ニューラル音声コーデックは、波形データをコンパクトな離散トークンに符号化し、トランスフォーマーが言語のように次の音を予測できるようにします。' }
              }
            ]
          }
        },
        {
          lesson_id: 'aidj-m1-l2',
          title: { en: 'Harmonic Mixing Control', jp: 'ハーモニックミキシングと調性' },
          subtitle: { en: 'Controlling Key and BPM in prompt engineering', jp: 'プロンプトによる調性（Key）とBPMの制御' },
          estimated_min: 20,
          sections: [
            {
              id: 'aidj-m1-l2-s1',
              title: { en: 'Key and Tempos', jp: '調性とテンポのプロンプティング' },
              content: [
                { type: 'text', text: { en: 'To mix tracks smoothly in Mixxx, you must control their Key and BPM. Suno AI accepts specific parameters in the style prompt.', jp: 'DJミキシングで音程の衝突を防ぐため、Sunoの生成段階でキーとBPMを明記することが有効です。' } },
                {
                  type: 'callout',
                  variant: 'tip',
                  title: { en: 'Prompt Example', jp: 'プロンプト指定例' },
                  text: { en: 'Style: "124bpm, Key: A minor, Deep House, analog synthesizer"', jp: 'スタイル: "124bpm, Key: A minor, Deep House, analog synthesizer"' }
                },
                { type: 'text', text: { en: 'Using Camelot key codes like "8A" or "9A" helps organize harmonic transitions.', jp: '「8A」や「9A」といったキャメロットホイールコードを指定することで、隣接キーへのシームレスな移行（ハーモニックミキシング）が容易になります。' } }
              ]
            }
          ]
        },
        {
          lesson_id: 'aidj-m1-l3',
          title: { en: 'Extended Mix Construction', jp: 'Extended Mix の構築' },
          subtitle: { en: 'Using Extend feature for DJ-ready structures', jp: 'Extend機能を用いたDJ用ロングバージョンの作成' },
          estimated_min: 20,
          sections: [
            {
              id: 'aidj-m1-l3-s1',
              title: { en: 'The DJ Extended Structure', jp: 'DJ用ロングバージョンの構成' },
              content: [
                { type: 'text', text: { en: 'Standard generated tracks are often too short and lack mixable intros/outros. Use Sunos "Extend" feature to patch sections.', jp: 'AIが生成する標準的な曲（2分程度）は、DJミックス用のイントロ・アウトロ（ビートのみの部分）が不足しています。Extend機能を使って前後に約1分の繋ぎ部分を追加します。' } },
                { type: 'list', style: 'key', items: [
                  { en: '[Instrumental Intro] (16-32 bars of raw beat for transition)', jp: '[Instrumental Intro] (繋ぎのためのビートのみ16〜32小節)' },
                  { en: '[Verse / Chorus] (Main vocal & melody sections)', jp: '[Verse / Chorus] (メインボーカルとメロディ展開)' },
                  { en: '[Instrumental Outro] (Stripped-back beat for exiting)', jp: '[Instrumental Outro] (徐々に音数が減るビートのみのアウトロ)' }
                ] }
              ]
            }
          ]
        }
      ]
    },
    {
      module_id: 'aidj-m2',
      title: { en: 'Mixxx DJ Integration & MCP', jp: 'DJツール（Mixxx）とMCP連携' },
      objective: { en: 'Configure Mixxx with MCP server control and automate mixing loops.', jp: 'MixxxにMCPサーバーを接続し、外部スクリプトから自動選曲・ミキシング制御を行う。' },
      estimated_hours: 4,
      lessons: [
        {
          lesson_id: 'aidj-m2-l1',
          title: { en: 'Mixxx setup and MCP', jp: 'Mixxxの導入とMCP接続' },
          subtitle: { en: 'Enabling developer APIs and server connections', jp: 'Mixxx開発者APIの有効化とMCPサーバーの準備' },
          estimated_min: 25,
          sections: [
            {
              id: 'aidj-m2-l1-s1',
              title: { en: 'Mixxx Download & Setup', jp: 'Mixxxのダウンロードと導入' },
              content: [
                { type: 'text', text: { en: 'To automatically control DJ decks, use the custom Mixxx version equipped with developer APIs.', jp: '自動DJ制御を行うために、デベロッパー用API（JSON-RPCまたはWebSocket）が有効化された拡張版Mixxxを利用します。' } },
                {
                  type: 'callout',
                  variant: 'info',
                  title: { en: 'Download Link', jp: '拡張版Mixxxダウンロード' },
                  text: { en: 'You can download the custom binary built for integration here: [Mixxx Custom Integration Github](https://github.com/2005nk/mixxx-mcp-fork/releases)', jp: 'API連携用のカスタムビルドはこちらのリンクからダウンロードできます: [Mixxx 拡張統合 GitHub](https://github.com/2005nk/mixxx-mcp-fork/releases)' }
                }
              ]
            },
            {
              id: 'aidj-m2-l1-s2',
              title: { en: 'MCP Connection Config', jp: 'MCPサーバー接続設定' },
              content: [
                { type: 'text', text: { en: 'Below is the JSON configuration to register the Mixxx control server in your Antigravity/Gemini settings.', jp: 'Vibe/Antigravity環境 hometownsettings.json にDJ連携用のMCPサーバーを登録する設定コードです。' } },
                {
                  type: 'code',
                  language: 'json',
                  filename: '.gemini/settings.json',
                  code: `{
  "mcpServers": {
    "mixxx-controller": {
      "command": "node",
      "args": ["/path/to/mixxx-mcp-server/index.js", "--port", "5005"],
      "env": {
        "MIXXX_API_URL": "http://localhost:8080/api"
      }
    }
  }
}`
                }
              ]
            }
          ]
        },
        {
          lesson_id: 'aidj-m2-l2',
          title: { en: 'Automation Controller Code', jp: 'DJ自動化制御コード' },
          subtitle: { en: 'Scripts to load tracks and crossfade decks', jp: 'デッキへの曲ロードとクロスフェーダー自動制御' },
          estimated_min: 30,
          sections: [
            {
              id: 'aidj-m2-l2-s1',
              title: { en: 'Node.js Automation Script', jp: 'DJ自動化制御の実装コード' },
              content: [
                { type: 'text', text: { en: 'Write a control loop that polls the current playing deck status and automatically crossfades when the track reaches its outro.', jp: '再生中のトラックがアウトロ（終端部）に達したことを検知し、反対側のデッキに曲をロードして自動的にクロスフェード処理をかけるプログラム例です。' } },
                {
                  type: 'code',
                  language: 'javascript',
                  filename: 'mixxx-auto-crossfade.js',
                  code: `import fetch from 'node-fetch';

const MIXXX_URL = 'http://localhost:8080/api';

async function setControl(group, name, value) {
  await fetch(\`\${MIXXX_URL}/controls\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group, name, value })
  });
}

async function triggerCrossfade() {
  console.log("Crossfading from Deck 1 to Deck 2...");
  // Load next track to Deck 2
  await setControl('[Channel2]', 'LoadSelectedTrack', 1);
  await setControl('[Channel2]', 'play', 1);
  
  // Step crossfader slowly from -1.0 (Deck 1) to 1.0 (Deck 2)
  for (let val = -1.0; val <= 1.0; val += 0.1) {
    await setControl('[Master]', 'crossfader', val);
    await new Promise(r => setTimeout(r, 200)); // 2 sec transition
  }
  
  // Stop Deck 1
  await setControl('[Channel1]', 'stop', 1);
}

// Outro monitor loop
setInterval(async () => {
  const res = await fetch(\`\${MIXXX_URL}/decks/1/status\`);
  const deck = await res.json();
  if (deck.play && deck.remainingTime < 30) { // 30 seconds left
     await triggerCrossfade();
  }
}, 5000);`
                }
              ]
            }
          ]
        }
      ]
    },
    {
      module_id: 'aidj-m3',
      title: { en: 'YouTube Live & System Integration', jp: 'YouTube Live 配信とシステム統合' },
      objective: { en: 'Setup YouTube Broadcast API and orchestrate the full autocasting loop.', jp: 'YouTube Live APIとOBS/FFmpegを統合し、全自動で24時間配信枠を構築する。' },
      estimated_hours: 4,
      lessons: [
        {
          lesson_id: 'aidj-m3-l1',
          title: { en: 'YouTube Broadcast API Setup', jp: 'YouTube Live APIの設定' },
          subtitle: { en: 'Configuring credentials and live streams', jp: 'OAuthクレデンシャルとライブストリームAPIの接続' },
          estimated_min: 25,
          sections: [
            {
              id: 'aidj-m3-l1-s1',
              title: { en: 'Google Cloud API Config', jp: 'Google Cloudコンソール設定' },
              content: [
                { type: 'text', text: { en: 'Enable the YouTube Data API v3, create an OAuth Client ID, and download the secrets file. Secure the scope "https://www.googleapis.com/auth/youtube.force-ssl".', jp: 'Google Cloud ConsoleでYouTube Data API v3を有効化し、OAuth クライアントIDを作成してクライアント秘密情報を入手します。SSL必須スコープ（youtube.force-ssl）を設定します。' } }
              ]
            },
            {
              id: 'aidj-m3-l1-s2',
              title: { en: 'Autocasting Stream Initialization', jp: '配信自動枠立てのNode.jsコード' },
              content: [
                { type: 'text', text: { en: 'This script programmatically schedules a new live stream and retrieves the RTMP streaming key.', jp: 'APIを経由して自動的にYouTubeライブストリームの番組を作成し、配信エンジン（OBSやFFmpeg）に渡すストリームキーを取得するコード例です。' } },
                {
                  type: 'code',
                  language: 'javascript',
                  filename: 'youtube-autocast.js',
                  code: `import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  process.env.YT_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

async function createLiveStream(title) {
  // 1. Create Broadcast Object
  const broadcastRes = await youtube.liveBroadcasts.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: title || 'AI DJ AutoCast Radio',
        scheduledStartTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
      status: { privacyStatus: 'public' }
    }
  });

  // 2. Create Stream Key
  const streamRes = await youtube.liveStreams.insert({
    part: 'cdn,status',
    requestBody: {
      cdn: {
        frameRate: '30fps',
        resolution: '1080p',
        ingestionType: 'rtmp'
      }
    }
  });

  // 3. Bind Broadcast and Stream
  await youtube.liveBroadcasts.bind({
    id: broadcastRes.data.id,
    streamId: streamRes.data.id
  });

  console.log("RTMP Ingestion URL:", streamRes.data.cdn.ingestionInfo.ingestionAddress);
  console.log("RTMP Stream Key:", streamRes.data.cdn.ingestionInfo.streamName);
  return streamRes.data.cdn.ingestionInfo;
}`
                }
              ]
            }
          ]
        },
        {
          lesson_id: 'aidj-m3-l2',
          title: { en: 'Complete Autocasting Pipeline', jp: '完全自動配信の統合フロー' },
          subtitle: { en: 'Orchestrating Suno, Mixxx, and FFmpeg streaming', jp: 'Suno・Mixxx・FFmpegによるエンドツーエンドの自律運用' },
          estimated_min: 30,
          sections: [
            {
              id: 'aidj-m3-l2-s1',
              title: { en: 'System Flowchart', jp: 'システム全体の自動化連携フロー' },
              content: [
                { type: 'text', text: { en: 'The overall orchestration flow for automated AI DJ broadcasting.', jp: 'Sunoでの生成から配信開始までの自動化パイプラインです。' } },
                {
                  type: 'mermaid',
                  chart: `flowchart LR
    A[Suno AI Tool] -- Auto Generate --> B[Download WAV]
    B -- Auto Import --> C[Mixxx Library]
    C -- Control Script --> D[Audio Output / Mixxx API]
    D -- FFmpeg Stream --> E[YouTube RTMP Ingest]
    F[YouTube API Tool] -- Create Broadcast --> E`
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};
