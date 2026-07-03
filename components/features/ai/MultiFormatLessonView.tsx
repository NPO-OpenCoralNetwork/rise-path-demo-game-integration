import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { LearningBlock } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import ConceptPage from './multi-format/blocks/ConceptPage';
import DialoguePage from './multi-format/blocks/DialoguePage';
import WorkshopPage from './multi-format/blocks/WorkshopPage';
import ReflectionPage from './multi-format/blocks/ReflectionPage';
import BlenderViewportPage from './multi-format/blocks/BlenderViewportPage';
import ChecklistPage from './multi-format/blocks/ChecklistPage';

// --- Mock Data (Static) ---
const MOCK_BLOCKS_EN: LearningBlock[] = [
  {
    id: '0-checklist',
    type: 'checklist',
    title: 'Get ready for your Blender adventure',
    tasks: [
        { id: 't1', label: 'Download from the official Blender site', details: 'Grab the stable release from the official site. Check requirements if needed.', imageKeyword: 'Blender download page', linkUrl: 'https://www.blender.org/download/', imageUrl: '/data/curricula/blender/_static/blender-download-page.png', imageCaption: 'Blender download page' },
        { id: 't2', label: 'Run the installer', details: 'Windows: choose x64/arm64. Installer adds Start Menu shortcuts; ZIP runs after extraction. macOS: choose Intel/Apple Silicon, open the .dmg and drag Blender.app to Applications. First launch may need approval.', imageKeyword: 'Blender install wizard', imageUrl: '/data/curricula/blender/_images/about_contribute_install_windows_installer.png', imageCaption: 'Installer example' },
        { id: 't3', label: 'Get a quick layout overview', details: 'Top menu/header, center 3D viewport, right Outliner/Properties, and bottom timeline. Drag borders to split/merge areas; switch layouts via Workspaces.', imageKeyword: 'Blender interface overview', imageUrl: '/data/curricula/blender/_images/interface_window-system_introduction_default-screen.png', imageCaption: 'Default layout' },
        { id: 't4', label: 'Adjust language settings', details: 'Edit > Preferences > Interface > Language. Enable Translate options (Interface/Tooltips/New Data) as needed.', imageKeyword: 'Blender language settings', imageUrl: '/data/curricula/blender/_static/blender-language-ui.png', imageCaption: 'Language settings' },
    ]
  },
  {
    id: '1',
    type: 'concept',
    title: 'What is quantum entanglement?',
    content: 'Quantum entanglement is a phenomenon where two particles share a linked state; once one is determined, the other is instantly determined no matter the distance. Einstein called it “spooky action at a distance.”',
    analogy: 'It’s like twins on Earth and Mars flipping coins and getting the same result at the same time.'
  },
  {
    id: '2',
    type: 'dialogue',
    lines: [
      { speaker: 'User', text: 'So does that mean information travels faster than light?' },
      { speaker: 'AI', text: 'Great question! In fact, information doesn’t travel faster than light. It’s the correlation that is determined instantly. That’s what makes quantum mechanics so fascinating.', emotion: 'excited' }
    ]
  },
  {
    id: '3-code',
    type: 'workshop',
    subType: 'code',
    goal: 'Build a quantum circuit in Python',
    steps: [
      'Install the Qiskit library: `pip install qiskit`',
      'Create a circuit with two qubits.',
      'Apply a Hadamard gate to create superposition.'
    ]
  },
  {
    id: '3-design',
    type: 'workshop',
    subType: 'design',
    goal: 'Design a UI component',
    steps: [
      'Set the base color to Indigo (#6366F1) to improve readability.',
      'Use a 24px border radius to create a friendly feel.',
      'Add drop shadows and a slight tilt to make it feel clickable.'
    ]
  },
  {
    id: '3-logic',
    type: 'workshop',
    subType: 'logic',
    goal: 'Build an order-processing algorithm',
    steps: [
      'Create a trigger to receive input data (order details).',
      'Add a conditional branch to validate the input.',
      'Send only valid data to the main process.'
    ]
  },
  {
    id: '3-blender',
    type: 'workshop',
    subType: 'blender',
    goal: 'Basic object transforms (G/R/S)',
    steps: [
      'Select the cube in the 3D viewport.',
      'Move (Grab): press G and lift the cube along the Z axis.',
      'Rotate and scale: press R to rotate, then S to resize.'
    ]
  },
  {
    id: '4',
    type: 'reflection',
    question: 'Which future technology could make use of quantum entanglement?',
    options: ['Instant teleportation communication', 'Unbreakable encryption', 'Time machine']
  }
];

const MOCK_BLOCKS_JP: LearningBlock[] = [
  {
    id: '0-checklist',
    type: 'checklist',
    title: 'Blenderの冒険を始める準備',
    tasks: [
        { id: 't1', label: 'Blender公式サイトからダウンロード', details: '安定版を公式サイトから入手します。必要なら要件も確認してください。', imageKeyword: 'Blender download page', linkUrl: 'https://www.blender.org/download/', imageUrl: '/data/curricula/blender/_static/blender-download-page.png', imageCaption: 'Blender download page' },
        { id: 't2', label: 'インストールを実行', details: 'Windows: x64/arm64を選択。Installer版は開始メニュー登録と関連付けあり。Zip版は解凍して実行(管理者不要)。macOS: Intel/Apple Siliconを選択し、.dmgを開いて Blender.app をApplicationsへドラッグ。初回起動は承認が必要。', imageKeyword: 'Blender install wizard', imageUrl: '/data/curricula/blender/_images/about_contribute_install_windows_installer.png', imageCaption: 'Installer example' },
        { id: 't3', label: '画面構成をざっと把握', details: '上部メニュー/ヘッダー、中央3Dビューポート、右のアウトライナー/プロパティ、下のタイムラインが基本。境界をドラッグで分割・結合、ワークスペースでレイアウト切替。', imageKeyword: 'Blender interface overview', imageUrl: '/data/curricula/blender/_images/interface_window-system_introduction_default-screen.png', imageCaption: 'Default layout' },
        { id: 't4', label: '言語設定を日本語に変更', details: 'Edit > Preferences > Interface > Language を日本語に。TranslateのInterface/Tooltips/New Dataを必要に応じてオン。', imageKeyword: 'Blender language settings', imageUrl: '/data/curricula/blender/_static/blender-language-ui.png', imageCaption: 'Language settings' },
    ]
  },
  {
    id: '1',
    type: 'concept',
    title: '量子もつれとは何か？',
    content: '量子もつれ（Quantum Entanglement）は、2つの粒子がどれだけ離れていても、片方の状態が決まると瞬時にもう片方の状態も決まる現象です。アインシュタインはこれを「不気味な遠隔作用」と呼びました。',
    analogy: 'まるで、地球と火星に離れた双子が、同時に同じコインの裏表を出し合うようなものです。'
  },
  {
    id: '2',
    type: 'dialogue',
    lines: [
      { speaker: 'User', text: 'でも、光の速さを超えて情報が伝わるってことですか？' },
      { speaker: 'AI', text: '鋭い質問ですね！実は「情報の伝達」は光速を超えません。あくまで「相関関係」が瞬時に決まるだけなんです。ここが量子力学の面白いところです。', emotion: 'excited' }
    ]
  },
  {
    id: '3-code',
    type: 'workshop',
    subType: 'code',
    goal: 'Pythonで量子回路を作ってみよう',
    steps: [
      'Qiskitライブラリをインストールします: `pip install qiskit`',
      '2つの量子ビットを持つ回路を作成します。',
      'アダマールゲートを適用して重ね合わせ状態を作ります。'
    ]
  },
  {
    id: '3-design',
    type: 'workshop',
    subType: 'design',
    goal: 'UIコンポーネントのデザイン',
    steps: [
      'ベースカラーをIndigo (#6366F1) に設定して視認性を高めます。',
      '角丸 (Border Radius) を24pxにして、親しみやすさを演出します。',
      'ドロップシャドウと僅かな傾きを加え、クリックしたくなる躍動感を表現します。'
    ]
  },
  {
    id: '3-logic',
    type: 'workshop',
    subType: 'logic',
    goal: '注文処理アルゴリズムの構築',
    steps: [
      'ユーザーからの入力データ（注文情報）を受け取るトリガーを配置します。',
      '入力データが有効かどうかをチェックする条件分岐（Valid?）を作成します。',
      '有効なデータのみ、メインの処理プロセスへ送信する接続を完了させます。'
    ]
  },
  {
    id: '3-blender',
    type: 'workshop',
    subType: 'blender',
    goal: 'オブジェクトの基本操作（G/R/S）',
    steps: [
      '3D空間での選択：クリックして立方体をアクティブにします。',
      '移動（Grab）：Gキーを押して、立方体をZ軸方向に持ち上げます。',
      '回転とスケール：Rキーで回転させ、Sキーでサイズを調整して完成です。'
    ]
  },
  {
    id: '4',
    type: 'reflection',
    question: '量子もつれを活用できそうな未来の技術はどれ？',
    options: ['瞬間移動通信', '絶対に解読できない暗号', 'タイムマシン']
  }
];

interface MultiFormatLessonViewProps {
    blocks?: LearningBlock[];
    onBack: () => void;
    forceBlockType?: 'concept' | 'dialogue' | 'workshop' | 'reflection' | 'checklist';
    forceSubType?: 'code' | 'design' | 'logic' | 'blender';
}

const MultiFormatLessonView: React.FC<MultiFormatLessonViewProps> = ({ blocks, onBack, forceBlockType, forceSubType }) => {
  const { language } = useLanguage();
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const copy = {
    en: {
      preview: 'Preview',
      multiFormat: 'Multi-Format Curriculum',
      labDemo: 'Lab Demo',
      step: (current: number, total: number) => `Step ${current} / ${total}`,
      previous: 'Previous',
      continue: 'Continue',
      complete: 'Complete'
    },
    jp: {
      preview: 'プレビュー',
      multiFormat: 'マルチフォーマット・カリキュラム',
      labDemo: 'ラボデモ',
      step: (current: number, total: number) => `ステップ ${current} / ${total}`,
      previous: '前へ',
      continue: '続ける',
      complete: '完了'
    }
  } as const;
  const t = copy[language];
  const displayBlocks = blocks && blocks.length > 0 ? blocks : (language === 'jp' ? MOCK_BLOCKS_JP : MOCK_BLOCKS_EN);

  // Filter or find the block based on forced props
  useEffect(() => {
    if (forceSubType) {
        const idx = displayBlocks.findIndex(b => b.type === 'workshop' && (b as any).subType === forceSubType);
        if (idx !== -1) setActiveBlockIndex(idx);
    } else if (forceBlockType) {
        const idx = displayBlocks.findIndex(b => b.type === forceBlockType);
        if (idx !== -1) setActiveBlockIndex(idx);
    }
  }, [forceBlockType, forceSubType, displayBlocks]);

  const isSingleMode = !!forceBlockType || !!forceSubType;

  return (
    <div className="min-h-screen bg-white font-sans flex flex-col">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-xl border-b border-slate-100 px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <button onClick={onBack} className="p-2 hover:bg-slate-50 rounded-full transition-colors text-slate-400">
          <ArrowLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
            <span className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.3em] mb-1">
                {isSingleMode ? `${(forceSubType || forceBlockType)?.toUpperCase()} ${t.preview}` : t.multiFormat}
            </span>
            {!isSingleMode && (
                <div className="flex items-center gap-1.5">
                    {displayBlocks.map((_, idx) => (
                        <div 
                            key={idx} 
                            className={`h-1 rounded-full transition-all duration-500 ${
                                idx === activeBlockIndex ? 'w-10 bg-indigo-600' : 
                                idx < activeBlockIndex ? 'w-4 bg-indigo-200' : 'w-2 bg-slate-100'
                            }`}
                        />
                    ))}
                </div>
            )}
        </div>
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-3 py-1 rounded-lg border border-slate-100">
            {isSingleMode ? t.labDemo : t.step(activeBlockIndex + 1, displayBlocks.length)}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-slate-50/30">
        <div className="max-w-6xl mx-auto w-full min-h-full flex flex-col pt-12 pb-24 px-6 md:px-12">
            <div className="flex-1">
                {displayBlocks.map((block, index) => {
                    if (index !== activeBlockIndex) return null;
                    
                    return (
                        <div key={block.id} className="animate-in fade-in slide-in-from-bottom-6 duration-700">
                            {block.type === 'checklist' && <ChecklistPage block={block as any} />}
                            {block.type === 'concept' && <ConceptPage block={block as any} />}
                            {block.type === 'dialogue' && <DialoguePage block={block as any} />}
                            {block.type === 'workshop' && (
                                (block as any).subType === 'blender' 
                                ? <BlenderViewportPage block={block as any} /> 
                                : <WorkshopPage block={block as any} />
                            )}
                            {block.type === 'reflection' && <ReflectionPage block={block as any} />}
                        </div>
                    );
                })}
            </div>

            {/* Navigation Controls */}
            {!isSingleMode && (
                <div className="mt-24 pt-12 border-t border-slate-200 flex flex-col md:flex-row justify-between items-center gap-8">
                    <button 
                        onClick={() => {
                            window.scrollTo(0, 0);
                            setActiveBlockIndex(Math.max(0, activeBlockIndex - 1));
                        }}
                        disabled={activeBlockIndex === 0}
                        className="flex items-center gap-2 px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-0 transition-all"
                    >
                        <ArrowLeft size={18} /> {t.previous}
                    </button>

                    {activeBlockIndex < displayBlocks.length - 1 ? (
                        <button 
                            onClick={() => {
                                window.scrollTo(0, 0);
                                setActiveBlockIndex(Math.min(displayBlocks.length - 1, activeBlockIndex + 1));
                            }}
                            className="flex items-center gap-4 px-12 py-6 bg-indigo-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-1 active:scale-[0.98] transition-all"
                        >
                            <span>{t.continue}</span>
                            <ArrowRight size={20} />
                        </button>
                    ) : (
                        <button 
                            onClick={onBack}
                            className="flex items-center gap-4 px-12 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-slate-200 hover:bg-slate-800 hover:-translate-y-1 active:scale-[0.98] transition-all"
                        >
                            <span>{t.complete}</span>
                            <CheckCircle2 size={20} />
                        </button>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default MultiFormatLessonView;
