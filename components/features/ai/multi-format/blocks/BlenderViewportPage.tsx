import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Move, RotateCw, Maximize, Grid3X3, Command, CheckCircle2, MousePointer2, Play, RefreshCw } from 'lucide-react';
import { WorkshopBlock } from '../../../../../types';
import { useLanguage } from '../../../../../context/LanguageContext';

interface BlenderViewportPageProps {
  block: WorkshopBlock;
}

const BlenderViewportPage: React.FC<BlenderViewportPageProps> = ({ block }) => {
  const { language } = useLanguage();
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [currentMode, setCurrentMode] = useState<'idle' | 'grab' | 'rotate' | 'scale'>('idle');
  const [activeAxis, setActiveAxis] = useState<string | null>(null);
  const [lastKeyPressed, setLastKeyPressed] = useState<string | null>(null);
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);
  const copy = {
    en: {
      liveSimulator: 'Live Simulator',
      demoPlaying: 'Demo running... watch the screen and learn the moves.',
      demoReady: 'Follow the demo and try it yourself.',
      stepLabel: 'Step',
      replayDemo: 'Replay Demo',
      transformData: 'Transform Data',
      demoMode: 'DEMO MODE',
      objectSelection: 'Object Selection',
      modeActive: (label: string) => `${label} mode active`,
      keyLabel: 'KEY',
      grabLabel: 'Grab',
      rotateLabel: 'Rotate',
      scaleLabel: 'Scale',
      pressEsc: 'Press ESC to Cancel',
      watchGrab: 'Watch: Press G to Grab',
      watchAxis: 'Watch: Press Z to lock Axis',
      watchMove: 'Watch: Move mouse up',
      watchConfirm: 'Watch: Click to Confirm',
      watchRotate: 'Watch: Press R to Rotate',
      watchScale: 'Watch: Press S to Scale'
    },
    jp: {
      liveSimulator: 'ライブシミュレーター',
      demoPlaying: 'デモ再生中... 画面を見て操作を覚えてください。',
      demoReady: 'デモの通りに操作してください。',
      stepLabel: 'ステップ',
      replayDemo: 'デモを再生',
      transformData: '変換データ',
      demoMode: 'デモモード',
      objectSelection: 'オブジェクト選択',
      modeActive: (label: string) => `${label}モード中`,
      keyLabel: 'キー',
      grabLabel: '移動',
      rotateLabel: '回転',
      scaleLabel: '拡大縮小',
      pressEsc: 'ESCでキャンセル',
      watchGrab: '見て: Gキーで移動(Grab)',
      watchAxis: '見て: Zキーで軸固定',
      watchMove: '見て: マウスを上に動かす',
      watchConfirm: '見て: クリックで確定',
      watchRotate: '見て: Rキーで回転',
      watchScale: '見て: Sキーで拡大縮小'
    }
  } as const;
  const t = copy[language];
  const modeLabels: Record<string, string> = {
    grab: t.grabLabel,
    rotate: t.rotateLabel,
    scale: t.scaleLabel
  };
  
  // 3D Transform States
  const [pos, setPos] = useState({ x: 0, y: 0, z: 0 });
  const [rot, setRot] = useState({ x: -20, y: 45, z: 0 });
  const [scale, setScale] = useState(1);

  // Mouse Interaction Refs
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Reset viewport state for specific step
  const resetViewportForStep = useCallback((step: number) => {
      // Default reset
      setPos({ x: 0, y: 0, z: 0 });
      setRot({ x: -20, y: 45, z: 0 });
      setScale(1);
      setCurrentMode('idle');
      setActiveAxis(null);
      setIsDemoPlaying(false);
      setDemoMessage(null);

      // If returning to a completed step, maybe set to 'done' state?
      // For practice, it's better to reset to start state so they can try again.
  }, []);

  const handleStepClick = (idx: number) => {
      if (isDemoPlaying) return; // Prevent switching during demo
      setActiveStep(idx);
      resetViewportForStep(idx);
  };

  // --- DEMO ORCHESTRATION ---
  const runDemo = useCallback(async () => {
    if (isDemoPlaying) return;
    setIsDemoPlaying(true);
    
    // Reset state
    setPos({ x: 0, y: 0, z: 0 });
    setRot({ x: -20, y: 45, z: 0 });
    setScale(1);
    setCurrentMode('idle');
    setActiveAxis(null);

    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    const showKey = (k: string) => { setLastKeyPressed(k); setTimeout(() => setLastKeyPressed(null), 300); };

    try {
        if (activeStep === 1) { // Grab Demo
            setDemoMessage(t.watchGrab);
            await wait(1000);
            showKey('G');
            setCurrentMode('grab');
            await wait(800);

            setDemoMessage(t.watchAxis);
            showKey('Z');
            setActiveAxis('Z');
            await wait(800);

            setDemoMessage(t.watchMove);
            // Animate movement
            const startY = 0;
            const targetY = -100;
            const steps = 30;
            for (let i = 0; i <= steps; i++) {
                setPos(p => ({ ...p, y: startY + (targetY - startY) * (i / steps) }));
                await wait(20);
            }
            await wait(500);
            
            setDemoMessage(t.watchConfirm);
            setCurrentMode('idle'); // Confirm
            setActiveAxis(null);
            await wait(1000);
        } 
        else if (activeStep === 2) { // Rotate & Scale Demo
            setDemoMessage(t.watchRotate);
            await wait(1000);
            showKey('R');
            setCurrentMode('rotate');
            await wait(500);
            
            // Animate Rotation
            for (let i = 0; i <= 30; i++) {
                setRot(r => ({ ...r, y: 45 + (180 * (i / 30)) }));
                await wait(20);
            }
            setCurrentMode('idle'); // Click
            await wait(500);

            setDemoMessage(t.watchScale);
            showKey('S');
            setCurrentMode('scale');
            await wait(500);

            // Animate Scale
            for (let i = 0; i <= 30; i++) {
                setScale(1 + (-0.5 * (i / 30)));
                await wait(20);
            }
            setCurrentMode('idle');
            await wait(1000);
        }
    } finally {
        setIsDemoPlaying(false);
        setDemoMessage(null);
        // Reset for user
        setPos({ x: 0, y: 0, z: 0 });
        setRot({ x: -20, y: 45, z: 0 });
        setScale(1);
    }
  }, [activeStep, isDemoPlaying]);

  // Auto-run demo when entering a new step (optional, maybe just button for now)
  useEffect(() => {
      // Only auto-run if the step hasn't been completed before
      if (activeStep > 0 && !completedSteps.includes(activeStep)) {
          runDemo();
      }
  }, [activeStep]); // Run only once per step entry


  // Handle Keyboard Inputs
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isDemoPlaying) return; // Block input during demo

    const key = e.key.toUpperCase();
    setLastKeyPressed(key);
    setTimeout(() => setLastKeyPressed(null), 200);

    // Mode switching
    if (key === 'G') { setCurrentMode('grab'); setActiveAxis(null); }
    if (key === 'R') { setCurrentMode('rotate'); setActiveAxis(null); }
    if (key === 'S') { setCurrentMode('scale'); setActiveAxis(null); }
    if (key === 'ESCAPE' || key === 'ENTER') {
        setCurrentMode('idle');
        setActiveAxis(null);
    }

    // Axis constraints
    if (['X', 'Y', 'Z'].includes(key) && currentMode !== 'idle') {
        setActiveAxis(key);
    }
    
    // Auto-complete missions based on actions
    if (key === 'G' && activeStep === 1) setCompletedSteps(prev => [...new Set([...prev, 1])]);
    if (key === 'R' && activeStep === 2) setCompletedSteps(prev => [...new Set([...prev, 2])]);
    
  }, [currentMode, activeStep, isDemoPlaying]);

  // Handle Mouse Movement for Interaction
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDemoPlaying) return; // Block input during demo

    if (currentMode !== 'idle' && viewportRef.current) {
        const deltaX = e.clientX - lastMousePos.current.x;
        const deltaY = e.clientY - lastMousePos.current.y;
        
        // --- GRAB (Move) ---
        if (currentMode === 'grab') {
            setPos(prev => {
                let newX = prev.x;
                let newY = prev.y; 
                let newZ = prev.z;

                if (activeAxis === 'X') {
                    newX += deltaX;
                } else if (activeAxis === 'Z') {
                    newY += deltaY; 
                } else if (activeAxis === 'Y') {
                    newX += deltaX * 0.5;
                    newY -= deltaY * 0.5;
                } else {
                    newX += deltaX;
                    newY += deltaY;
                }
                
                // Check mission completion (G + Z)
                if (activeStep === 1 && activeAxis === 'Z' && Math.abs(newY) > 50) {
                     // Don't auto advance immediately, let them click to confirm
                }
                return { x: newX, y: newY, z: newZ };
            });
        }

        // --- ROTATE ---
        if (currentMode === 'rotate') {
            setRot(prev => {
                const speed = 2;
                let dx = prev.x;
                let dy = prev.y;
                let dz = prev.z;

                if (activeAxis === 'X') dx += deltaX * speed;
                else if (activeAxis === 'Y') dy += deltaX * speed;
                else if (activeAxis === 'Z') dz += deltaX * speed;
                else {
                    dy += deltaX * speed;
                    dx += deltaY * speed;
                }
                return { x: dx, y: dy, z: dz };
            });
        }

        // --- SCALE ---
        if (currentMode === 'scale') {
            setScale(prev => {
                const factor = 1 + (deltaX * 0.01);
                return Math.max(0.1, prev * factor);
            });
        }
    }
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  }, [currentMode, activeAxis, activeStep, isDemoPlaying]);

  const handleMouseDown = (e: React.MouseEvent) => {
      if (isDemoPlaying) return;
      
      // Confirm action (Click)
      if (currentMode !== 'idle') {
          // Check for completion on confirm
          if (activeStep === 1 && currentMode === 'grab' && activeAxis === 'Z' && Math.abs(pos.y) > 50) {
              if (!completedSteps.includes(1)) {
                  setCompletedSteps(prev => [...new Set([...prev, 1])]);
                  setActiveStep(2); // Auto advance on success confirm
              }
          }
          else if (activeStep === 2 && (currentMode === 'rotate' || currentMode === 'scale')) {
               if (!completedSteps.includes(2)) {
                  setCompletedSteps(prev => [...new Set([...prev, 2])]);
                  // No next step, stay here
              }
          }

          setCurrentMode('idle');
          setActiveAxis(null);
      } else {
          // Selecting object (Mission 1)
          if (activeStep === 0) {
              setCompletedSteps(prev => [...new Set([...prev, 0])]);
              setActiveStep(1);
          }
      }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [handleKeyDown, handleMouseMove]);


  const getCubeStyle = (): React.CSSProperties => {
    return {
      width: '100px', height: '100px', position: 'relative', transformStyle: 'preserve-3d',
      transition: (currentMode === 'idle' || isDemoPlaying) ? 'all 0.3s ease-out' : 'none', 
      transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg) rotateZ(${rot.z}deg) translate3d(${pos.x}px, ${pos.y}px, ${pos.z}px) scale(${scale})`,
      cursor: currentMode === 'idle' ? 'pointer' : 'none'
    };
  };

  // Selection Glow Style
  const isSelected = activeStep >= 1; 

  return (
    <div className="h-full flex flex-col lg:flex-row gap-8 lg:h-[80vh]">
      {/* Left: Mission Guide */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pr-2">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-black uppercase tracking-widest mb-4">
            <Box size={14} />
            {t.liveSimulator}
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight">
            {block.goal}
          </h2>
          <p className="text-slate-500 mt-2 text-sm font-medium leading-relaxed">
            {isDemoPlaying ? t.demoPlaying : t.demoReady}
          </p>
        </div>

        <div className="space-y-4">
          {block.steps.map((step, idx) => (
            <div 
              key={idx}
              className={`p-6 rounded-[2rem] border-2 transition-all duration-300 cursor-pointer flex gap-4 items-start ${
                idx === activeStep ? 'border-orange-500 bg-white shadow-xl shadow-orange-100 scale-[1.02]' : 'border-slate-100 bg-slate-50 opacity-60 hover:opacity-80'
              }`}
              onClick={() => handleStepClick(idx)}
            >
               <div className="flex gap-4 w-full">
                    <div className={`mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${completedSteps.includes(idx) ? 'bg-orange-500 border-transparent text-white' : 'text-slate-300'}`}>
                        {completedSteps.includes(idx) && <CheckCircle2 size={14} />}
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-slate-900 mb-1">{t.stepLabel} {idx + 1}</h3>
                        <p className="text-sm text-slate-600 font-medium">{step}</p>
                    </div>
               </div>
            </div>
          ))}
        </div>

        {/* Demo Controls */}
        {!isDemoPlaying && activeStep > 0 && (
            <div className="mt-6 text-center">
                <button 
                    onClick={runDemo}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full text-xs font-bold uppercase tracking-widest transition-colors"
                >
                    <RefreshCw size={12} /> {t.replayDemo}
                </button>
            </div>
        )}

        {/* Real-time Status */}
        <div className="mt-auto p-6 bg-slate-900 rounded-[2rem] text-white">
            <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.transformData}</span>
                <div className="flex gap-2">
                    {['X','Y','Z'].map(a => (
                        <span key={a} className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${activeAxis === a ? 'bg-orange-500' : 'bg-slate-800'}`}>{a}</span>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-orange-400">
                <div>LOC: {Math.round(pos.x)},{Math.round(pos.y*-1)},{Math.round(pos.z)}</div>
                <div>ROT: {Math.round(rot.y)}°</div>
                <div>SCL: {scale.toFixed(2)}</div>
            </div>
        </div>
      </div>

      {/* Right: Actual Viewport */}
      <div 
        ref={viewportRef}
        className={`flex-[1.5] min-w-0 h-[600px] lg:h-auto bg-[#393939] rounded-[3rem] overflow-hidden border-4 border-[#282828] relative shadow-2xl group flex flex-col ${currentMode === 'idle' ? 'cursor-default' : 'cursor-none'}`}
        onMouseDown={handleMouseDown}
      >
        
        {/* Interaction Info Overlay */}
        <div className="absolute top-8 left-8 z-10 space-y-2 pointer-events-none">
            <div className="bg-[#282828]/90 backdrop-blur px-4 py-2 rounded-xl border border-white/5 flex items-center gap-3 shadow-xl">
                <div className={`w-2 h-2 rounded-full ${currentMode !== 'idle' ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></div>
                <span className="text-[10px] font-black text-white uppercase tracking-widest">
                    {isDemoPlaying
                        ? t.demoMode
                        : currentMode === 'idle'
                        ? t.objectSelection
                        : t.modeActive(modeLabels[currentMode] || currentMode)}
                </span>
            </div>
            {lastKeyPressed && (
                <div className="bg-orange-500 text-white px-3 py-1 rounded-lg text-xs font-black shadow-lg animate-out fade-out zoom-out duration-500">
                    {t.keyLabel}: {lastKeyPressed}
                </div>
            )}
        </div>

        {/* Demo Instruction Overlay */}
        {demoMessage && (
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 z-20 bg-black/80 text-white px-6 py-3 rounded-full font-bold text-sm shadow-2xl backdrop-blur animate-in fade-in zoom-in duration-300 pointer-events-none border border-white/10">
                {demoMessage}
            </div>
        )}

        {/* Viewport View */}
        <div className="flex-1 relative flex items-center justify-center perspective-[1000px] overflow-hidden">
             {/* Dynamic Axis Lines */}
             {activeAxis === 'Z' && <div className="absolute h-full w-0.5 bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.5)] z-0"></div>}
             {activeAxis === 'X' && <div className="absolute w-full h-0.5 bg-red-400 shadow-[0_0_15px_rgba(248,113,113,0.5)] z-0"></div>}

             {/* Grid */}
             <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:40px_40px] [transform:rotateX(75deg)_translateY(200px)] opacity-40"></div>

             {/* The Interactive Cube */}
             <div 
                style={getCubeStyle()} 
                className="group/cube"
             >
                {[
                  { transform: 'rotateY(0deg) translateZ(50px)', bg: 'bg-orange-500' },
                  { transform: 'rotateY(180deg) translateZ(50px)', bg: 'bg-orange-600' },
                  { transform: 'rotateY(90deg) translateZ(50px)', bg: 'bg-orange-400' },
                  { transform: 'rotateY(-90deg) translateZ(50px)', bg: 'bg-orange-400' },
                  { transform: 'rotateX(90deg) translateZ(50px)', bg: 'bg-orange-300' },
                  { transform: 'rotateX(-90deg) translateZ(50px)', bg: 'bg-orange-700' },
                ].map((face, i) => (
                    <div 
                        key={i} 
                        className={`
                            absolute inset-0 border border-white/20 ${face.bg} transition-opacity duration-300
                            ${currentMode !== 'idle' ? 'opacity-90' : ''}
                        `} 
                        style={{ 
                            transform: face.transform, 
                            backfaceVisibility: 'hidden',
                            boxShadow: isSelected ? '0 0 15px rgba(255, 165, 0, 0.6) inset' : 'none',
                            borderColor: isSelected ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.2)'
                        }} 
                    />
                ))}
                
                {/* Outline */}
                <div className={`
                    absolute -inset-1 border-2 transition-all duration-300 pointer-events-none rounded-sm
                    ${isSelected ? 'border-orange-400 opacity-100 shadow-[0_0_20px_rgba(251,146,60,0.6)]' : 'border-white opacity-0'}
                    ${currentMode !== 'idle' ? 'border-white opacity-100 scale-105' : ''}
                `}></div>
             </div>
        </div>

        {/* Shortcuts Tray */}
        <div className="p-8 bg-[#282828] border-t border-white/5 flex justify-between items-center">
            <div className="flex gap-3">
                {[
                    { key: 'G', label: t.grabLabel, active: currentMode === 'grab' },
                    { key: 'R', label: t.rotateLabel, active: currentMode === 'rotate' },
                    { key: 'S', label: t.scaleLabel, active: currentMode === 'scale' },
                ].map(k => (
                    <div key={k.key} className={`flex flex-col items-center gap-1 transition-all ${k.active ? 'scale-110' : 'opacity-40'}`}>
                        <div className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center font-black text-lg ${
                            k.active ? 'bg-orange-500 border-orange-400 text-white shadow-[0_0_20px_rgba(249,115,22,0.4)]' : 'bg-[#333] border-white/5 text-white/50'
                        } ${lastKeyPressed === k.key ? 'translate-y-1 shadow-inner' : ''}`}>
                            {k.key}
                        </div>
                        <span className="text-[7px] font-black uppercase text-white/40 tracking-widest">{k.label}</span>
                    </div>
                ))}
            </div>

            <div className="flex flex-col items-end gap-1">
                <div className="bg-[#1a1a1a] px-3 py-1 rounded-lg border border-white/5 flex items-center gap-2">
                    <Command size={10} className="text-slate-500" />
                    <span className="text-[9px] font-mono text-slate-400 uppercase">{t.pressEsc}</span>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default BlenderViewportPage;
