import React, { useState, useEffect } from 'react';
import { Code, CheckCircle2, Play, Terminal, Info, Palette, GitGraph, ArrowRightCircle, Database, Cpu, Settings, Zap, Copy, MousePointer2, BoxSelect, Layers } from 'lucide-react';
import { WorkshopBlock } from '../../../../../types';
import { useLanguage } from '../../../../../context/LanguageContext';

interface WorkshopPageProps {
  block: WorkshopBlock;
}

const WorkshopPage: React.FC<WorkshopPageProps> = ({ block }) => {
  const { language } = useLanguage();
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [showHint, setShowHint] = useState<number | null>(null);
  const copy = {
    en: {
      designStudio: 'Design Studio',
      logicBuilder: 'Logic Builder',
      handsOnLab: 'Hands-on Lab',
      guideIntro: 'Follow the guide on the left to build your project in the interactive workspace.',
      stepLabel: 'Step',
      showHint: 'Show Hint',
      hideHint: 'Hide Hint',
      tipLabel: 'Tip',
      tipText: 'Double check your connections before running the simulation.',
      logicFlow: 'Logic Flow',
      processing: 'Processing...',
      runFlow: 'Run Flow',
      nodeTypeInput: 'Input',
      nodeTypeCondition: 'Condition',
      nodeTypeAction: 'Action',
      nodeTypeOutput: 'Output',
      nodeLabelInput: 'User Input',
      nodeLabelValidate: 'Validate',
      nodeLabelProcess: 'Process',
      nodeLabelDashboard: 'Dashboard',
      debugger: 'Debugger Console',
      logInput: 'Input received from user_form',
      logValidation: 'Validation check: PASS',
      logSuccess: 'Data processed and sent to Dashboard.',
      logIdle: 'System Idle. Waiting for execution...',
      terminal: 'Terminal',
      terminalInit: 'Circuit initialized.',
      terminalGates: 'Gates applied successfully.',
      previewCanvas: 'Preview Canvas',
      uiElement: 'UI Element',
      box: 'Box',
      fill: 'Fill',
      radius: 'Radius'
    },
    jp: {
      designStudio: 'デザインスタジオ',
      logicBuilder: 'ロジックビルダー',
      handsOnLab: 'ハンズオン・ラボ',
      guideIntro: '左のガイドに沿って、インタラクティブな作業スペースでプロジェクトを作成しましょう。',
      stepLabel: 'ステップ',
      showHint: 'ヒントを表示',
      hideHint: 'ヒントを隠す',
      tipLabel: 'ヒント',
      tipText: '実行前に接続をもう一度確認しましょう。',
      logicFlow: 'ロジックフロー',
      processing: '処理中...',
      runFlow: 'フロー実行',
      nodeTypeInput: '入力',
      nodeTypeCondition: '条件',
      nodeTypeAction: '処理',
      nodeTypeOutput: '出力',
      nodeLabelInput: 'ユーザー入力',
      nodeLabelValidate: '検証',
      nodeLabelProcess: '処理',
      nodeLabelDashboard: 'ダッシュボード',
      debugger: 'デバッガーコンソール',
      logInput: 'ユーザー入力を受信: user_form',
      logValidation: '検証チェック: OK',
      logSuccess: 'データを処理してダッシュボードへ送信しました。',
      logIdle: 'システム待機中。実行を待っています...',
      terminal: 'ターミナル',
      terminalInit: '回路を初期化しました。',
      terminalGates: 'ゲートを適用しました。',
      previewCanvas: 'プレビューキャンバス',
      uiElement: 'UI要素',
      box: 'ボックス',
      fill: '塗り',
      radius: '角丸'
    }
  } as const;
  const t = copy[language];

  const subType = block.subType || 'code';

  const toggleStep = (idx: number) => {
    if (completedSteps.includes(idx)) {
      setCompletedSteps(prev => prev.filter(i => i !== idx));
    } else {
      setCompletedSteps(prev => [...prev, idx]);
      if (idx === activeStep && idx < block.steps.length - 1) {
        setActiveStep(idx + 1);
      }
    }
  };

  const handleRun = () => {
    setIsRunning(true);
    setTimeout(() => setIsRunning(false), 3000);
  };

  // Mock code content
  const getMockCode = (stepIdx: number) => {
    const codes = [
      `# Step 1: Install Qiskit\n!pip install qiskit\n!pip install qiskit-aer`,
      `# Step 2: Create Circuit\nfrom qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nprint(\"Circuit created!\")`,
      `# Step 3: Add Gates\nqc.h(0)\nqc.cx(0, 1)\nqc.draw('mpl')`
    ];
    return codes[stepIdx] || codes[0];
  };

  // --- LOGIC BUILDER UI HELPERS ---
  const LogicNode = ({ type, label, active, connected, pulse }: any) => {
    const icons: any = {
      input: <Database size={14} />,
      condition: <Cpu size={14} />,
      action: <Zap size={14} />,
      output: <ArrowRightCircle size={14} />
    };
    const typeLabels: Record<string, string> = {
      input: t.nodeTypeInput,
      condition: t.nodeTypeCondition,
      action: t.nodeTypeAction,
      output: t.nodeTypeOutput
    };
    
    return (
      <div className={`
        relative p-3 rounded-xl border transition-all duration-500 flex items-center gap-3 w-36 md:w-44
        ${active ? 'border-amber-500 bg-white shadow-lg scale-105 z-10' : 'border-slate-200 bg-slate-50/80 opacity-60'}
        ${connected ? 'opacity-100' : ''}
        ${pulse ? 'ring-2 ring-amber-400 ring-opacity-50' : ''}
      `}>
        <div className={`p-2 rounded-lg ${active ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-500'}`}>
          {icons[type]}
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase text-slate-400 tracking-widest truncate">{typeLabels[type] || type}</div>
          <div className="text-xs font-bold text-slate-700 truncate">{label}</div>
        </div>
        {connected && (
            <div className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-0.5 bg-slate-300 pointer-events-none"></div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 lg:gap-10 lg:h-[80vh]">
      {/* Left Column: Instructions */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pr-1">
        <div className="mb-8">
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4`}>
            {subType === 'design' ? <Palette size={14} /> : 
             subType === 'logic' ? <GitGraph size={14} /> : <Code size={14} />}
            {subType === 'design' ? t.designStudio : 
             subType === 'logic' ? t.logicBuilder : t.handsOnLab}
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight">
            {block.goal}
          </h2>
          <p className="text-slate-500 mt-3 text-sm font-medium leading-relaxed">
            {t.guideIntro}
          </p>
        </div>

        <div className="space-y-4 flex-1 pb-12">
          {block.steps.map((step, idx) => {
            const isActive = idx === activeStep;
            const isCompleted = completedSteps.includes(idx);
            const activeColor = subType === 'design' ? 'border-purple-500' : subType === 'logic' ? 'border-amber-500' : 'border-emerald-500';
            const activeBg = subType === 'design' ? 'shadow-purple-100' : subType === 'logic' ? 'shadow-amber-100' : 'shadow-emerald-100';
            const checkColor = subType === 'design' ? 'bg-purple-500 border-purple-500' : subType === 'logic' ? 'bg-amber-500 border-amber-500' : 'bg-emerald-500 border-emerald-500';

            return (
              <div 
                key={idx}
                className={`
                  relative rounded-2xl border-2 transition-all duration-300 overflow-hidden cursor-pointer
                  ${isActive ? `${activeColor} bg-white shadow-xl ${activeBg} scale-[1.01] z-10` : 'border-slate-100 bg-slate-50/50 hover:border-slate-200'}
                  ${isCompleted ? 'opacity-60 grayscale-[0.3]' : ''}
                `}
                onClick={() => setActiveStep(idx)}
              >
                {isActive && (
                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${subType === 'design' ? 'bg-purple-500' : subType === 'logic' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                )}
                <div className="p-5 flex gap-4 items-start">
                  <button
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleStep(idx);
                    }}
                    className={`
                      mt-1 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all shrink-0
                      ${isCompleted 
                        ? `${checkColor} text-white` 
                        : isActive ? `${activeColor.replace('border', 'text')} text-transparent` : 'border-slate-300 text-transparent hover:border-slate-400'}
                    `}
                  >
                    <CheckCircle2 size={14} className={isCompleted ? 'opacity-100' : 'opacity-0'} />
                  </button>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-bold text-base mb-1 ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>
                      {t.stepLabel} {idx + 1}
                    </h3>
                    <p className={`text-sm leading-relaxed ${isActive ? 'text-slate-700' : 'text-slate-500'}`}>
                      {step}
                    </p>
                    {isActive && (
                        <div className="mt-3 flex items-center gap-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); setShowHint(showHint === idx ? null : idx); }}
                                className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 transition-colors ${ 
                                    subType === 'design' ? 'text-purple-600 hover:text-purple-800' :
                                    subType === 'logic' ? 'text-amber-600 hover:text-amber-800' : 'text-emerald-600 hover:text-emerald-800'
                                }`}
                            >
                                <Info size={12} /> {showHint === idx ? t.hideHint : t.showHint}
                            </button>
                        </div>
                    )}
                  </div>
                </div>
                
                {/* Hint Area */}
                {isActive && showHint === idx && (
                    <div className={`mx-5 mb-5 p-3 rounded-lg border text-xs leading-relaxed ${ 
                        subType === 'design' ? 'bg-purple-50 border-purple-100 text-purple-800' :
                        subType === 'logic' ? 'bg-amber-50 border-amber-100 text-amber-800' : 'bg-emerald-50 border-emerald-100 text-emerald-800'
                    }`}> 
                        <strong>{t.tipLabel}:</strong> {t.tipText}
                    </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Visualization Area */}
      <div className={`flex-1 min-w-0 h-[500px] lg:h-auto rounded-3xl overflow-hidden shadow-2xl border flex flex-col relative z-0 ${ 
          subType === 'code' ? 'bg-[#1e1e1e] border-slate-800' : 
          subType === 'logic' ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'
      }`}> 
        
        {/* === LOGIC BUILDER UI === */}
        {subType === 'logic' && (
            <div className="flex-1 flex flex-col">
                <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
                        <Settings size={16} className="text-amber-500" />
                        {t.logicFlow}
                    </div>
                    <button 
                        onClick={handleRun}
                        disabled={isRunning}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${ 
                            isRunning ? 'bg-slate-100 text-slate-400' : 'bg-amber-500 text-white shadow-lg hover:bg-amber-600 active:scale-95'
                        }`}
                    >
                        {isRunning ? t.processing : t.runFlow} <Play size={12} fill="currentColor" />
                    </button>
                </div>
                
                <div className="flex-1 relative bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:24px_24px] p-8 flex flex-col items-center justify-center gap-12 overflow-hidden">
                    {/* Running Animation */}
                    {isRunning && (
                        <div className="absolute inset-0 z-0 pointer-events-none">
                            {/* Simple simulated data packets moving down */}
                            <div className="absolute left-1/2 top-[20%] w-3 h-3 bg-amber-500 rounded-full animate-ping -translate-x-1/2"></div>
                            <div className="absolute left-1/2 top-[50%] w-3 h-3 bg-amber-500 rounded-full animate-ping delay-300 -translate-x-1/2"></div>
                            <div className="absolute left-1/2 top-[80%] w-3 h-3 bg-amber-500 rounded-full animate-ping delay-700 -translate-x-1/2"></div>
                        </div>
                    )}

                    <LogicNode 
                        type="input" label={t.nodeLabelInput} 
                        active={activeStep === 0} connected={activeStep >= 1} 
                        pulse={isRunning && activeStep >= 0}
                    />
                    <div className="flex gap-4 md:gap-8 justify-center w-full">
                        <LogicNode 
                            type="condition" label={t.nodeLabelValidate} 
                            active={activeStep === 1} connected={activeStep >= 2}
                            pulse={isRunning && activeStep >= 1}
                        />
                        <LogicNode 
                            type="action" label={t.nodeLabelProcess} 
                            active={activeStep === 2} connected={false}
                            pulse={isRunning && activeStep >= 2}
                        />
                    </div>
                    <LogicNode 
                        type="output" label={t.nodeLabelDashboard} 
                        active={activeStep === 2} connected={false}
                        pulse={isRunning && activeStep >= 2}
                    />

                    {/* SVG Connector Lines */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30 z-0">
                        <path d="M 50% 20% L 50% 40%" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4" />
                        <path d="M 50% 60% L 50% 80%" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4" />
                    </svg>
                </div>

                <div className="p-4 bg-amber-50 border-t border-amber-100 shrink-0">
                    <p className="text-[9px] text-amber-700 font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                        <Terminal size={10} /> {t.debugger}
                    </p>
                    <div className="font-mono text-[10px] text-amber-900/70 leading-relaxed h-16 overflow-y-auto">
                        {isRunning ? (
                            <>
                                <span className="text-amber-600">[INFO]</span> {t.logInput}<br/>
                                <span className="text-amber-600">[INFO]</span> {t.logValidation}<br/>
                                <span className="text-emerald-600">[SUCCESS]</span> {t.logSuccess}
                            </>
                        ) : (
                            <span className="opacity-50">{t.logIdle}</span>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* === CODING LAB UI === */}
        {subType === 'code' && (
            <div className="flex-1 flex flex-col bg-[#1e1e1e]">
                <div className="bg-[#252526] px-4 py-3 border-b border-[#333] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1.5 mr-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
                            <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
                            <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
                        </div>
                        <span className="text-xs text-slate-400 font-mono">main.py</span>
                    </div>
                    <Play size={14} className="text-slate-400 hover:text-white cursor-pointer" />
                </div>
                <div className="flex-1 p-6 font-mono text-sm text-slate-300 overflow-auto relative">
                    {/* Fake Line Numbers */}
                    <div className="absolute left-3 top-6 text-slate-700 text-[10px] select-none text-right w-4">
                        {getMockCode(activeStep).split('\n').map((_, i) => <div key={i} className="leading-6">{i + 1}</div>)}
                    </div>
                    <div className="pl-8 leading-6 whitespace-pre-wrap">
                        {getMockCode(activeStep)}
                    </div>
                </div>
                <div className="h-32 border-t border-[#333] p-4 font-mono text-xs text-slate-400 shrink-0">
                    <div className="flex items-center gap-2 mb-1 opacity-50 uppercase text-[9px] font-bold tracking-widest">
                        <Terminal size={10} /> {t.terminal}
                    </div>
                    <div className="text-slate-300">
                        <span className="text-green-500">➜</span> python main.py<br/>
                        {activeStep >= 1 && <span className="text-slate-400">{t.terminalInit}<br/></span>}
                        {activeStep >= 2 && <span className="text-slate-400">{t.terminalGates}<br/></span>}
                        <span className="animate-pulse">_</span>
                    </div>
                </div>
                <button className="absolute top-14 right-6 p-2 bg-[#333] hover:bg-[#444] text-slate-400 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    <Copy size={16} />
                </button>
            </div>
        )}

        {/* === DESIGN STUDIO UI === */}
        {subType === 'design' && (
            <div className="flex-1 flex flex-col bg-[#f8fafc]">
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center shrink-0">
                    <div className="flex gap-4 text-slate-400">
                        <MousePointer2 size={16} className="text-indigo-500" />
                        <BoxSelect size={16} />
                        <Layers size={16} />
                    </div>
                    <div className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{t.previewCanvas}</div>
                    <div className="text-slate-400 font-mono text-xs">100%</div>
                </div>

                <div className="flex-1 flex items-center justify-center bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px]">
                    <div 
                        className="w-40 h-40 bg-indigo-500 shadow-2xl flex items-center justify-center text-white font-bold text-lg transition-all duration-700" 
                        style={{
                            backgroundColor: activeStep >= 0 ? '#6366f1' : '#e2e8f0',
                            borderRadius: activeStep >= 1 ? '48px' : '0px',
                            transform: activeStep >= 2 ? 'rotate(-5deg) scale(1.1)' : 'none',
                            boxShadow: activeStep >= 2 ? '0 25px 50px -12px rgba(99, 102, 241, 0.5)' : 'none'
                        }}
                    >
                        {activeStep >= 0 ? t.uiElement : t.box}
                    </div>
                </div>

                <div className="h-16 bg-white border-t border-slate-200 flex items-center px-6 gap-8 overflow-hidden shrink-0">
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{t.fill}</span>
                        <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full border border-slate-200 ${activeStep >= 0 ? 'bg-indigo-500' : 'bg-slate-200'}`}></div>
                            <span className="text-[10px] font-mono text-slate-500">{activeStep >= 0 ? '#6366F1' : '#E2E8F0'}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{t.radius}</span>
                        <span className="text-[10px] font-mono text-slate-500">{activeStep >= 1 ? '48px' : '0px'}</span>
                    </div>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

export default WorkshopPage;
