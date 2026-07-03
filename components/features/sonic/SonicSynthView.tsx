import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, Waves, Play, Pause, Volume2, 
  Settings, Activity, RefreshCw, Zap
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

interface SonicSynthViewProps {
  onBack: () => void;
}

// Knob Component
const Knob = ({ 
  label, value, min, max, onChange, color = "cyan" 
}: { 
  label: string; value: number; min: number; max: number; onChange: (v: number) => void; color?: string 
}) => {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragging) {
        const delta = startY.current - e.clientY;
        const range = max - min;
        const change = (delta / 100) * range;
        let newValue = startVal.current + change;
        newValue = Math.max(min, Math.min(max, newValue));
        onChange(newValue);
      }
    };
    const handleMouseUp = () => setDragging(false);

    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, min, max, onChange]);

  // Calculate rotation: map value to -135deg to +135deg
  const percentage = (value - min) / (max - min);
  const rotation = -135 + (percentage * 270);

  return (
    <div className="flex flex-col items-center gap-2 select-none group">
      <div 
        className="relative w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 shadow-xl cursor-ns-resize group-hover:border-slate-500 transition-colors"
        onMouseDown={handleMouseDown}
      >
        <div 
          className={`absolute w-1.5 h-1/2 bg-${color}-500 left-1/2 -translate-x-1/2 origin-bottom rounded-full`}
          style={{ transform: `translateX(-50%) rotate(${rotation}deg) translateY(-50%)`, top: '50%' }}
        ></div>
      </div>
      <div className="text-center">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
        <div className={`text-xs font-mono font-bold text-${color}-400`}>{Math.round(value)}</div>
      </div>
    </div>
  );
};

const SonicSynthView: React.FC<SonicSynthViewProps> = ({ onBack }) => {
  const { language } = useLanguage();
  const [waveform, setWaveform] = useState<'sine' | 'square' | 'sawtooth' | 'triangle'>('sine');
  const [frequency, setFrequency] = useState(440);
  const [cutoff, setCutoff] = useState(2000);
  const [resonance, setResonance] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const copy = {
    en: {
      oscillatorBank: 'Oscillator Bank A',
      oscilloscope: 'OSCILLOSCOPE',
      oscillator: 'Oscillator',
      filter: 'Filter (LPF)',
      master: 'Master',
      pitch: 'Pitch (Hz)',
      cutoff: 'Cutoff',
      resonance: 'Resonance',
      gateOpen: 'Gate Open',
      gateClosed: 'Gate Closed',
      timbreTitle: 'Timbre Theory',
      waveforms: 'Waveforms',
      waveformsDesc: 'The shape of the wave determines the fundamental character (timbre) of the sound.',
      waveDetails: [
        { name: 'Sine', description: 'Pure, fundamental tone. No harmonics. Whistle-like.' },
        { name: 'Square', description: 'Hollow, woody. Used in retro games (Nintendo). Odd harmonics only.' },
        { name: 'Saw', description: 'Bright, buzzy, sharp. Rich in all harmonics. Good for leads.' }
      ],
      subtractiveTitle: 'Subtractive Synthesis',
      subtractiveDesc: 'We start with a rich waveform (like a Saw) and subtract frequencies using a Filter.',
      tryThis: 'Try this:',
      trySteps: [
        'Select the Sawtooth wave.',
        'Lower the Cutoff knob slowly.',
        'Hear the sound get “dull” or “muffled”. That’s the filter removing high frequencies.'
      ]
    },
    jp: {
      oscillatorBank: 'オシレーターバンクA',
      oscilloscope: 'オシロスコープ',
      oscillator: 'オシレーター',
      filter: 'フィルター（LPF）',
      master: 'マスター',
      pitch: 'ピッチ（Hz）',
      cutoff: 'カットオフ',
      resonance: 'レゾナンス',
      gateOpen: 'ゲート開',
      gateClosed: 'ゲート閉',
      timbreTitle: '音色理論',
      waveforms: '波形',
      waveformsDesc: '波の形が音の基本的なキャラクター（音色）を決めます。',
      waveDetails: [
        { name: 'Sine', description: '純粋で基音のみ。倍音がなく、口笛のような音。' },
        { name: 'Square', description: '中空で木質的。レトロゲームで使用。奇数次倍音のみ。' },
        { name: 'Saw', description: '明るく鋭い。全倍音を含み、リードに最適。' }
      ],
      subtractiveTitle: 'サブトラクティブ・シンセシス',
      subtractiveDesc: 'Sawのような豊かな波形から、フィルターで周波数を“引き算”します。',
      tryThis: '試してみよう:',
      trySteps: [
        'Sawtooth波形を選択。',
        'カットオフをゆっくり下げる。',
        '音が「こもる」「丸くなる」ように変化します。高域がフィルターで削られるためです。'
      ]
    }
  } as const;

  const t = copy[language];
  
  // Canvas for Oscilloscope
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animation Loop for Oscilloscope
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let offset = 0;

    const draw = () => {
      // Clear
      ctx.fillStyle = '#0f172a'; // slate-900
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid
      ctx.strokeStyle = '#1e293b'; // slate-800
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < canvas.width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); }
      for (let i = 0; i < canvas.height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); }
      ctx.stroke();

      if (!isPlaying) {
         // Flat line if silent
         ctx.strokeStyle = '#0ea5e9'; // cyan-500
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.moveTo(0, canvas.height / 2);
         ctx.lineTo(canvas.width, canvas.height / 2);
         ctx.stroke();
         return;
      }

      // Draw Wave
      ctx.strokeStyle = '#0ea5e9'; // cyan-500
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#0ea5e9';
      ctx.lineWidth = 3;
      ctx.beginPath();

      const amplitude = 50;
      const centerY = canvas.height / 2;
      const freqFactor = frequency / 200; // Visual scaling

      for (let x = 0; x < canvas.width; x++) {
        let y = 0;
        const t = (x * 0.02 * freqFactor) + offset;

        if (waveform === 'sine') {
          y = Math.sin(t);
        } else if (waveform === 'square') {
          y = Math.sin(t) > 0 ? 1 : -1;
        } else if (waveform === 'sawtooth') {
          y = (t % (2 * Math.PI)) / Math.PI - 1;
        } else if (waveform === 'triangle') {
          y = Math.asin(Math.sin(t)) / (Math.PI / 2);
        }

        // Apply pseudo-filter effect (visual only)
        // Lower cutoff = smoother, less high freq detail (simulated by damping)
        const filterDamp = Math.min(1, cutoff / 5000); 
        y = y * filterDamp;

        ctx.lineTo(x, centerY + y * amplitude);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      offset += 0.1;
      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [waveform, frequency, cutoff, isPlaying]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 font-sans flex flex-col">
      
      {/* Top Bar */}
      <div className="bg-[#111] border-b border-slate-800 px-6 py-4 flex justify-between items-center">
         <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 -ml-2 text-slate-500 hover:text-white transition-colors"><ArrowLeft size={20}/></button>
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-sm font-bold uppercase tracking-widest">
               <Waves size={18} /> {t.oscillatorBank}
            </div>
         </div>
         <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 font-mono">CPU: 4%</span>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
         </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row">
         
         {/* Main Panel: Visualizer & Theory */}
         <div className="flex-1 p-6 md:p-12 flex flex-col">
            
            {/* Visualizer Frame */}
            <div className="flex-1 bg-slate-900 border-4 border-slate-800 rounded-3xl overflow-hidden relative shadow-2xl mb-8 min-h-[300px]">
               <div className="absolute top-4 left-4 z-10 text-cyan-500 font-mono text-xs flex gap-2">
                  <Activity size={14} /> {t.oscilloscope}
               </div>
               <canvas ref={canvasRef} width={800} height={400} className="w-full h-full object-cover" />
            </div>

            {/* Controls Row */}
            <div className="bg-[#111] border border-slate-800 rounded-2xl p-8 flex flex-wrap justify-around gap-8">
               
               {/* Section: Oscillator */}
               <div className="flex flex-col items-center gap-6">
                  <span className="text-xs font-bold text-slate-500 uppercase border-b border-slate-700 pb-1 w-full text-center">{t.oscillator}</span>
                  
                  {/* Waveform Selectors */}
                  <div className="flex gap-2">
                     {['sine', 'square', 'sawtooth', 'triangle'].map(w => (
                        <button 
                           key={w}
                           onClick={() => setWaveform(w as any)}
                           className={`w-10 h-10 rounded border flex items-center justify-center transition-all ${waveform === w ? 'bg-cyan-500 border-cyan-400 text-black shadow-[0_0_15px_rgba(6,182,212,0.5)]' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-white'}`}
                           title={w}
                        >
                           <Waves size={18} />
                        </button>
                     ))}
                  </div>

                  {/* Frequency Knob */}
                  <Knob 
                     label={t.pitch} 
                     value={frequency} 
                     min={50} 
                     max={1000} 
                     onChange={setFrequency} 
                     color="cyan"
                  />
               </div>

               <div className="w-px bg-slate-800"></div>

               {/* Section: Filter */}
               <div className="flex flex-col items-center gap-6">
                  <span className="text-xs font-bold text-slate-500 uppercase border-b border-slate-700 pb-1 w-full text-center">{t.filter}</span>
                  <div className="flex gap-6">
                     <Knob 
                        label={t.cutoff} 
                        value={cutoff} 
                        min={100} 
                        max={5000} 
                        onChange={setCutoff} 
                        color="orange"
                     />
                     <Knob 
                        label={t.resonance} 
                        value={resonance} 
                        min={0} 
                        max={10} 
                        onChange={setResonance} 
                        color="orange"
                     />
                  </div>
               </div>

               <div className="w-px bg-slate-800"></div>

               {/* Section: Master */}
               <div className="flex flex-col items-center gap-6 justify-center">
                  <button 
                     onClick={() => setIsPlaying(!isPlaying)}
                     className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all shadow-xl ${isPlaying ? 'border-green-500 bg-green-500/20 text-green-500' : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500'}`}
                  >
                     {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                  </button>
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{isPlaying ? t.gateOpen : t.gateClosed}</span>
               </div>

            </div>
         </div>

         {/* Sidebar: Lesson Content */}
         <div className="w-full lg:w-96 bg-[#0f0f0f] border-l border-slate-800 p-8 overflow-y-auto">
            <h2 className="text-2xl font-bold text-white mb-6">{t.timbreTitle}</h2>
            
            <div className="space-y-8">
               <div>
                  <h3 className="text-cyan-400 font-bold mb-2 flex items-center gap-2"><Zap size={16}/> {t.waveforms}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">
                     {t.waveformsDesc}
                  </p>
                  <ul className="text-sm space-y-3">
                     {t.waveDetails.map((wave) => (
                        <li key={wave.name} className="flex gap-3">
                           <span className="text-white font-bold w-16">{wave.name}</span>
                           <span className="text-slate-500">{wave.description}</span>
                        </li>
                     ))}
                  </ul>
               </div>

               <div className="border-t border-slate-800 pt-6">
                  <h3 className="text-orange-400 font-bold mb-2 flex items-center gap-2"><Settings size={16}/> {t.subtractiveTitle}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                     {t.subtractiveDesc}
                  </p>
                  <div className="bg-slate-900 p-4 rounded-lg mt-4 border border-slate-800 text-xs text-slate-300">
                     <strong>{t.tryThis}</strong><br/>
                     1. <span className="text-white">{t.trySteps[0]}</span><br/>
                     2. <span className="text-orange-400">{t.trySteps[1]}</span><br/>
                     3. {t.trySteps[2]}
                  </div>
               </div>
            </div>
         </div>

      </div>
    </div>
  );
};

export default SonicSynthView;
