import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BookOpen, 
  ChevronRight, 
  Lock, 
  Play, 
  ArrowLeft, 
  Copy, 
  Check, 
  Volume2, 
  Sparkles, 
  FileText, 
  Code, 
  HelpCircle,
  ExternalLink
} from 'lucide-react';

type Section = 'intro' | 'chapter1' | 'chapter2' | 'chapter3' | 'chapter4';

export default function AidjCurriculumView() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('intro');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  
  // Quiz states
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const mcpCode = `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

const MIXXX_WS_URL = 'ws://localhost:8085';
let ws;

function connectToMixxx() {
    ws = new WebSocket(MIXXX_WS_URL);
    ws.on('open', () => console.error('[Mixxx] Connected to Mixxx Controller API'));
    ws.on('error', (err) => console.error('[Mixxx] Connection error:', err.message));
}

const server = new McpServer({
    name: 'mixxx-controller',
    version: '1.0.0',
    description: 'Mixxx DJ Software Control Server',
});

// ツール1: デッキへのトラックロード
server.tool('load-track', '指定したデッキに音楽ファイルをロードする', {
    deck: z.number().min(1).max(4).describe('ロード先デッキ番号 (1-4)'),
    filePath: z.string().describe('音声ファイルの絶対パス'),
}, async ({ deck, filePath }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'loadTrack', deck, filePath }));
        return { content: [{ type: 'text', text: \`Successfully loaded to Deck \${deck}: \${filePath}\` }] };
    }
    return { content: [{ type: 'text', text: 'Error: Mixxx WS offline' }], isError: true };
});

// ツール2: 再生・停止
server.tool('play-deck', 'デッキの再生/一時停止を切り替える', {
    deck: z.number().min(1).max(4),
    play: z.boolean().describe('trueで再生、falseで停止'),
}, async ({ deck, play }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'playDeck', deck, play }));
        return { content: [{ type: 'text', text: \`Deck \${deck} is now \${play ? 'PLAYING' : 'PAUSED'}\` }] };
    }
    return { content: [{ type: 'text', text: 'Error: Mixxx WS offline' }], isError: true };
});

async function main() {
    connectToMixxx();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Mixxx-MCP] Started stdio MCP transport');
}

main().catch(console.error);`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">
      
      {/* Sidebar */}
      <div className="w-full md:w-80 bg-slate-900/50 backdrop-blur-md border-r border-slate-800 p-6 flex flex-col gap-6 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/')} 
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Course Viewer</span>
            <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">AIDJ Streaming</h1>
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-1">
          {/* Navigation Links */}
          <button
            onClick={() => setActiveSection('intro')}
            className={`w-full flex items-center justify-between p-3.5 rounded-xl text-left transition-all ${
              activeSection === 'intro' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-violet-500/10 border border-cyan-500/30 text-cyan-300 font-medium' 
                : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <BookOpen size={18} className={activeSection === 'intro' ? 'text-cyan-400' : 'text-slate-500'} />
              <span>イントロダクション</span>
            </div>
            <ChevronRight size={16} />
          </button>

          <button
            onClick={() => setActiveSection('chapter1')}
            className={`w-full flex items-center justify-between p-3.5 rounded-xl text-left transition-all ${
              activeSection === 'chapter1' 
                ? 'bg-gradient-to-r from-cyan-500/10 to-violet-500/10 border border-cyan-500/30 text-cyan-300 font-medium' 
                : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <Sparkles size={18} className={activeSection === 'chapter1' ? 'text-cyan-400' : 'text-slate-500'} />
              <span>第1章: AI音楽生成とプロンプト</span>
            </div>
            <ChevronRight size={16} />
          </button>

          {/* Locked Chapters */}
          <div className="h-px bg-slate-800 my-4" />
          <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Locked chapters</span>

          <div className="flex items-center justify-between p-3.5 rounded-xl text-slate-600 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <Lock size={16} />
              <span className="text-sm">第2章: Mixxx & MCP自動DJ</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl text-slate-600 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <Lock size={16} />
              <span className="text-sm">第3章: YouTube API自動配信</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl text-slate-600 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <Lock size={16} />
              <span className="text-sm">第4章: システム統合自律運用</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl flex items-center gap-3">
          <div className="bg-cyan-500/10 p-2 rounded-lg text-cyan-400">
            <Volume2 size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-300">AIDJ Platform</h4>
            <p className="text-[10px] text-slate-500">Self-driven Live Streaming</p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto max-h-screen p-8 md:p-12 lg:p-16">
        
        {activeSection === 'intro' && (
          <div className="max-w-4xl mx-auto flex flex-col gap-8 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col gap-3">
              <span className="px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-semibold rounded-full w-max">
                Course Intro
              </span>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                AIDJ配信スペシャリストコース
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed font-light">
                音楽生成AI（Suno）による自動作曲から、DJソフトウェアのプログラム制御、そしてYouTube LiveのAPI配信連携までを一気通貫で学ぶ次世代の自律型エンタメ構築カリキュラム。
              </p>
            </div>

            {/* Banner Image */}
            <div className="relative rounded-2xl overflow-hidden border border-slate-800 group">
              <img 
                src="/aidj_control_center_1782918053335.jpg" 
                alt="AIDJ Control Center" 
                className="w-full h-auto object-cover max-h-[400px] transition-transform duration-700 group-hover:scale-105" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">System Blueprint</span>
                <h3 className="text-lg font-bold text-white mt-1">完全自律型ライブ配信コックピット</h3>
              </div>
            </div>

            {/* Why learn */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
                <FileText className="text-cyan-400" size={20} />
                何のために学ぶのか
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-2">
                
                <div className="p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 font-bold text-lg">01</div>
                  <h4 className="font-bold text-slate-200">完全著作権フリー</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    AI生成したオリジナル曲のみを使用するため、YouTubeの著作権侵害申し立てやBANを完全に回避できます。
                  </p>
                </div>

                <div className="p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-400 font-bold text-lg">02</div>
                  <h4 className="font-bold text-slate-200">リアルタイム自律DJ</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    単なる固定プレイリスト再生ではなく、エージェントがBPMを検知しリアルタイムに同期・クロスフェードミキシングを行います。
                  </p>
                </div>

                <div className="p-6 bg-slate-900/30 border border-slate-800/80 rounded-2xl flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold text-lg">03</div>
                  <h4 className="font-bold text-slate-200">24時間365日不労運用</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    APIを通じて配信枠の作成、OBSの起動、配信ステータスの遷移を全自動化。自律運用BGM空間を作れます。
                  </p>
                </div>

              </div>
            </div>

            {/* Architecture diagram visualizer */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
                <Code className="text-cyan-400" size={20} />
                自動配信システムの全体アーキテクチャ
              </h3>
              
              <div className="p-6 bg-slate-900/20 border border-slate-800 rounded-2xl flex flex-col gap-6">
                
                {/* Visual Block Diagram */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  
                  {/* Layer 1 */}
                  <div className="w-full md:w-1/3 bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-cyan-400 uppercase">Layer 1</span>
                    <h4 className="font-bold text-sm text-slate-200">AI楽曲生成 (Suno AI)</h4>
                    <p className="text-xs text-slate-400">Voice Personasで歌声を固定し、Extended Mixビートを量産。</p>
                  </div>
                  
                  <div className="text-slate-600 hidden md:block">➔</div>
                  
                  {/* Layer 2 */}
                  <div className="w-full md:w-1/3 bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-violet-400 uppercase">Layer 2</span>
                    <h4 className="font-bold text-sm text-slate-200">DJ自動制御 (Mixxx & MCP)</h4>
                    <p className="text-xs text-slate-400">エージェントがMCP経由でWebSocketを叩き、選曲・再生指示。</p>
                  </div>

                  <div className="text-slate-600 hidden md:block">➔</div>
                  
                  {/* Layer 3 */}
                  <div className="w-full md:w-1/3 bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase">Layer 3</span>
                    <h4 className="font-bold text-sm text-slate-200">自動ライブ配信 (YouTube API)</h4>
                    <p className="text-xs text-slate-400">Live Data APIで配信枠を作成・バインドし自動的に公開オンエア。</p>
                  </div>

                </div>

                <div className="flex items-center justify-between p-4 bg-slate-950 rounded-xl border border-slate-800 text-sm">
                  <span className="text-slate-400">💡 DJの音楽的基礎（EQ、ミックス等）は別枠で解説します。</span>
                  <a href="#" className="text-cyan-400 hover:underline flex items-center gap-1 font-semibold text-xs shrink-0">
                    DJ基礎コースへ <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>

            {/* Next course button */}
            <div className="flex justify-end mt-4">
              <button 
                onClick={() => setActiveSection('chapter1')}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-slate-950 font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-500/10 transition-all hover:scale-[1.02]"
              >
                第1章へ進む <ChevronRight size={18} />
              </button>
            </div>

          </div>
        )}

        {activeSection === 'chapter1' && (
          <div className="max-w-4xl mx-auto flex flex-col gap-8 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col gap-3">
              <span className="px-3 py-1 bg-violet-500/10 text-violet-400 border border-violet-500/20 text-xs font-semibold rounded-full w-max">
                Chapter 1
              </span>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                Suno AI の基礎とプロンプト制御
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed font-light">
                音楽生成AIが音声波形を生成する仕組みを理解し、DJプレイや楽曲の展開・スタイル・調性（Key）を自在に操るプロンプトエンジニアリングを習得します。
              </p>
            </div>

            {/* Infographic Image */}
            <div className="relative rounded-2xl overflow-hidden border border-slate-800 group">
              <img 
                src="/suno_generation_process_1782917660286.jpg" 
                alt="Suno AI Infographic" 
                className="w-full h-auto object-cover max-h-[400px] transition-transform duration-700 group-hover:scale-105" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-400">Technical Infographic</span>
                <h3 className="text-lg font-bold text-white mt-1">AI 楽曲生成の内部処理パイプライン</h3>
              </div>
            </div>

            {/* Sections */}
            <div className="flex flex-col gap-6">
              
              {/* Gen Music Pipeline */}
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-cyan-400 rounded-full" />
                  1. 楽曲生成の内部プロセス
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Suno AIは、入力されたスタイルプロンプトと歌詞を元に、高度に圧縮された「音声トークン（離散音声表現）」をTransformerモデルを用いて予測生成し、最終的にVocoderを通じてステレオ音声へとデコードします。
                </p>
              </div>

              {/* Style Guide */}
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-violet-400 rounded-full" />
                  2. スタイルプロンプトによる音響・調性制御
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed mb-2">
                  Sunoはプロンプトを左から優先的に解釈します。最も重要な要素（ジャンル、キー、BPM）は必ず先頭に配置します。
                </p>

                {/* Table */}
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/20 text-sm">
                  <div className="grid grid-cols-3 bg-slate-900/60 p-3 font-bold text-slate-300 border-b border-slate-800">
                    <div>コントロール対象</div>
                    <div>プロンプト指定例</div>
                    <div>期待される効果</div>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    <div className="grid grid-cols-3 p-3 text-slate-400">
                      <div className="font-semibold text-slate-200">調性 (Key)</div>
                      <div className="font-mono text-cyan-400 text-xs">`Key: A Minor`</div>
                      <div>ハーモニックミキシングを可能にするためのキー固定。</div>
                    </div>
                    <div className="grid grid-cols-3 p-3 text-slate-400">
                      <div className="font-semibold text-slate-200">テンポ (BPM)</div>
                      <div className="font-mono text-cyan-400 text-xs">`124bpm, up-tempo`</div>
                      <div>曲の基本テンポの固定（補助的な影響）。</div>
                    </div>
                    <div className="grid grid-cols-3 p-3 text-slate-400">
                      <div className="font-semibold text-slate-200">音圧・ダイナミクス</div>
                      <div className="font-mono text-cyan-400 text-xs">`sidechain compression`</div>
                      <div>キックドラムに合わせてベース音量を引き下げ、うねりとパンチを出す。</div>
                    </div>
                    <div className="grid grid-cols-3 p-3 text-slate-400">
                      <div className="font-semibold text-slate-200">ステレオ感</div>
                      <div className="font-mono text-cyan-400 text-xs">`wide stereo image`</div>
                      <div>左右の広がりを持たせ、プロ用音源のような広域ミックスを実現。</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Extended Mix Guide */}
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-emerald-400 rounded-full" />
                  3. DJ Extended Mix の構築（Extend機能）
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  DJプレイで重ねるためには、イントロとアウトロに「リズムビートだけの部分」が必要です。
                </p>
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-xs">1</span>
                    <span className="text-sm font-semibold text-slate-200">イントロビート（最初の30秒〜1分）の生成</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-xs">2</span>
                    <span className="text-sm font-semibold text-slate-200">`Extend` 機能を利用し、0:30からボーカルやメロディを含むメインセクションへ展開</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-xs">3</span>
                    <span className="text-sm font-semibold text-slate-200">最後のパートからさらに `Extend` を行い、ドラムのみのアウトロビートを繋いで `Get Whole Song` で結合</span>
                  </div>
                </div>
              </div>

              {/* Code blocks */}
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-yellow-400 rounded-full" />
                  4. Mixxx 制御用の MCP サーバーコード (モック)
                </h3>
                
                <div className="relative group">
                  <button 
                    onClick={() => handleCopy(mcpCode, 'mcp')}
                    className="absolute right-4 top-4 p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5 text-xs font-semibold"
                  >
                    {copiedText === 'mcp' ? (
                      <>
                        <Check size={14} className="text-emerald-400" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        Copy Code
                      </>
                    )}
                  </button>
                  <pre className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 font-mono text-xs overflow-x-auto text-emerald-400/90 leading-relaxed max-h-[300px]">
                    {mcpCode}
                  </pre>
                </div>
              </div>

            </div>

            {/* Interactive Quiz Area to boost WOW score */}
            <div className="mt-6 p-8 bg-gradient-to-r from-cyan-950/20 to-violet-950/20 border border-cyan-500/20 rounded-2xl flex flex-col gap-4">
              <h3 className="text-lg font-bold text-cyan-300 flex items-center gap-2">
                <HelpCircle size={20} />
                理解度チェッククイズ
              </h3>
              <p className="text-sm text-slate-400">
                Suno AIのプロンプトを設計する際、キー（調性）やメインジャンルなどの最も優先度の高い要素は、プロンプトのどこに配置すべきですか？
              </p>
              
              <div className="flex flex-col gap-2 mt-2">
                {[
                  'プロンプトの先頭（左側）',
                  'プロンプトの最後（右側）',
                  '歌詞入力テキストの末尾'
                ].map((option, idx) => (
                  <button
                    key={idx}
                    disabled={quizSubmitted}
                    onClick={() => setQuizAnswer(idx)}
                    className={`w-full text-left p-3.5 rounded-xl border text-sm transition-all \${
                      quizSubmitted
                        ? idx === 0 
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                          : quizAnswer === idx
                            ? 'border-rose-500 bg-rose-500/10 text-rose-300'
                            : 'border-slate-800 text-slate-500'
                        : quizAnswer === idx
                          ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300 font-semibold'
                          : 'border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              {!quizSubmitted ? (
                <button
                  disabled={quizAnswer === null}
                  onClick={() => setQuizSubmitted(true)}
                  className="mt-4 px-6 py-2.5 bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm rounded-xl transition-all self-end"
                >
                  回答を送信
                </button>
              ) : (
                <div className="mt-4 flex items-center justify-between">
                  <span className={`text-sm font-bold ${quizAnswer === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {quizAnswer === 0 ? '🎉 正解です！Sunoは左側から優先的にテキストを解釈します。' : '❌ 残念。正解は「先頭（左側）」です。'}
                  </span>
                  <button
                    onClick={() => {
                      setQuizAnswer(null);
                      setQuizSubmitted(false);
                    }}
                    className="text-xs text-cyan-400 hover:underline"
                  >
                    もう一度挑戦する
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Nav */}
            <div className="flex justify-between items-center mt-6">
              <button 
                onClick={() => setActiveSection('intro')}
                className="px-6 py-3 border border-slate-800 hover:bg-slate-800/40 text-slate-300 font-bold rounded-xl flex items-center gap-2 transition-all"
              >
                <ArrowLeft size={18} /> イントロダクションへ
              </button>
              
              <button 
                disabled
                className="px-6 py-3 bg-slate-800 text-slate-500 font-bold rounded-xl flex items-center gap-2 cursor-not-allowed"
              >
                第2章へ進む (Locked) <ChevronRight size={18} />
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
