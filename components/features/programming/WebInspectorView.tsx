import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, MousePointer2, Monitor, CheckCircle2, 
  X, ChevronRight, ArrowUp, ArrowDown, ArrowLeft as ArrowLeftIcon, ArrowRight as ArrowRightIcon,
  Play, RefreshCw
} from 'lucide-react';
import { ViewState } from '../../../types';

interface WebInspectorViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
}

const WebInspectorView: React.FC<WebInspectorViewProps> = ({ onBack, onNavigate }) => {
  // 0: Intro, 1: Activate, 2: Select, 3: Edit Color, 4: Edit Padding, 5: Outro, 6: Free Mode
  const [step, setStep] = useState(0); 
  const [isInspectorActive, setIsInspectorActive] = useState(false);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [editedColor, setEditedColor] = useState('#1e293b');
  const [editedPadding, setEditedPadding] = useState('0px');
  
  // Refs for auto-focus or positioning if needed (mostly handled by layout)
  const colorInputRef = useRef<HTMLInputElement>(null);
  const paddingInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus inputs when reaching specific steps
  useEffect(() => {
    if (step === 3 && colorInputRef.current) {
      colorInputRef.current.focus();
      colorInputRef.current.select();
    }
    if (step === 4 && paddingInputRef.current) {
      paddingInputRef.current.focus();
      paddingInputRef.current.select();
    }
  }, [step]);

  // Actions
  const handleInspectorToggle = () => {
    // Tutorial Mode
    if (step === 1) {
      setIsInspectorActive(true);
      setStep(2);
    } 
    // Free Mode
    else if (step === 6) {
      setIsInspectorActive(!isInspectorActive);
      if (isInspectorActive) setSelectedElement(null); // Clear selection when turning off
    }
  };

  const handleElementClick = (id: string) => {
    if (!isInspectorActive) return;
    
    // Free Mode: Select anything
    if (step === 6) {
      setSelectedElement(id);
      return;
    }

    // Tutorial Mode: Only allow selecting the correct element
    if (step === 2 && id === 'headline') {
      setSelectedElement('headline');
      setStep(3);
    } else if (step === 4 && id === 'button') {
      // Allow selecting button if we somehow lost selection
      setSelectedElement('button');
    }
  };

  // Skip logic to auto-select button for step 4 in tutorial
  useEffect(() => {
    if (step === 4) {
      setSelectedElement('button');
    }
  }, [step]);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditedColor(e.target.value);
    
    // Tutorial Validation
    if (step === 3) {
      const val = e.target.value.toLowerCase();
      if (val === '#3b82f6' || val === 'blue' || val === '#3b83f6') { // Accepting user's typo too
        setTimeout(() => setStep(4), 800);
      }
    }
  };

  // Shortcut for users who get stuck: Click the swatch to auto-fill
  const autoFillColor = () => {
    if (step === 3) {
      setEditedColor('#3b82f6');
      setTimeout(() => setStep(4), 500);
    }
  };

  const handlePaddingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditedPadding(e.target.value);
    
    // Tutorial Validation
    if (step === 4 && (e.target.value === '20px' || e.target.value === '1.25rem')) {
      setTimeout(() => setStep(5), 800);
    }
  };

  const autoFillPadding = () => {
    if (step === 4) {
      setEditedPadding('20px');
      setTimeout(() => setStep(5), 500);
    }
  }

  const enterFreeMode = () => {
    setStep(6);
    setIsInspectorActive(true);
    setSelectedElement(null);
  };

  // --- RENDER HELPERS ---

  const IntroModal = () => (
    <div className="absolute inset-0 z-50 bg-slate-900/90 flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="max-w-lg bg-white text-slate-900 rounded-3xl p-8 shadow-2xl text-center">
        <div className="w-20 h-20 bg-cyan-100 rounded-full flex items-center justify-center mx-auto mb-6 text-cyan-600">
          <Monitor size={40} />
        </div>
        <h1 className="text-3xl font-bold mb-4">Welcome to Inspector Mode</h1>
        <p className="text-slate-500 mb-8 text-lg leading-relaxed">
          Developers don't guess—they inspect. <br/>
          In this tour, you'll learn how to "X-Ray" a website and modify its code in real-time.
        </p>
        <button 
          onClick={() => setStep(1)}
          className="bg-cyan-600 text-white px-8 py-3 rounded-xl font-bold text-lg hover:bg-cyan-700 hover:scale-105 transition-all flex items-center gap-2 mx-auto"
        >
          Start Tour <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );

  const OutroModal = () => (
    <div className="absolute inset-0 z-50 bg-slate-900/90 flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="max-w-lg bg-white text-slate-900 rounded-3xl p-8 shadow-2xl text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600">
          <CheckCircle2 size={40} />
        </div>
        <h1 className="text-3xl font-bold mb-4">Challenge Complete!</h1>
        <p className="text-slate-500 mb-8 text-lg leading-relaxed">
          You've mastered the basics of inspecting and editing styles.
        </p>
        <div className="flex flex-col gap-3">
          <button 
            onClick={() => onNavigate(ViewState.PROGRAMMING)}
            className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold text-lg hover:bg-slate-800 transition-all"
          >
            Back to Curriculum
          </button>
          <button 
            onClick={enterFreeMode}
            className="bg-white text-slate-700 border border-slate-200 px-8 py-3 rounded-xl font-bold text-lg hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
          >
            <Play size={20} className="text-cyan-500" /> Free Playground
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-[#0d0e14] text-slate-300 font-sans flex flex-col overflow-hidden relative">
      
      {/* Modals */}
      {step === 0 && <IntroModal />}
      {step === 5 && <OutroModal />}

      {/* Dimmer Overlay for steps 1-4 to focus attention */}
      {step > 0 && step < 5 && (
        <div className="absolute inset-0 bg-black/40 pointer-events-none z-10 transition-opacity" />
      )}

      {/* Top Bar */}
      <div className="border-b border-slate-800 bg-[#0d0e14] px-6 py-4 flex justify-between items-center shrink-0 z-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-bold text-slate-100 text-sm">Web Inspector {step === 6 && <span className="text-cyan-400 ml-2 border border-cyan-500/30 bg-cyan-500/10 px-2 rounded text-xs uppercase tracking-wider">Free Mode</span>}</h1>
            <p className="text-[10px] text-slate-500 font-mono">DevTools Simulation</p>
          </div>
        </div>
        {/* Step Indicator (Only in tutorial) */}
        {step <= 5 && (
          <div className="flex gap-1">
            {[1,2,3,4].map(s => (
              <div key={s} className={`h-1.5 w-6 rounded-full transition-colors ${step >= s ? 'bg-cyan-500' : 'bg-slate-800'}`} />
            ))}
          </div>
        )}
        {step === 6 && (
          <button onClick={() => window.location.reload()} className="text-xs text-slate-500 hover:text-white flex items-center gap-1">
            <RefreshCw size={12}/> Reset
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden relative z-0">
        
        {/* LEFT: Website Preview */}
        <div className="flex-1 bg-white relative flex flex-col">
           {/* Browser Bar */}
           <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex gap-4 items-center">
              <div className="flex gap-1.5">
                 <div className="w-3 h-3 rounded-full bg-red-400"></div>
                 <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                 <div className="w-3 h-3 rounded-full bg-green-400"></div>
              </div>
              <div className="bg-white border border-slate-200 rounded-md px-3 py-1 flex-1 text-xs text-slate-500 font-mono text-center">
                 localhost:3000/rise-path-landing
              </div>
           </div>

           {/* Content */}
           <div className="flex-1 p-8 md:p-12 flex flex-col items-center justify-center relative">
              
              {/* STEP 2 GUIDE: Select Element */}
              {step === 2 && (
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-full mb-4 z-50 animate-bounce pointer-events-none">
                   <div className="bg-cyan-600 text-white px-4 py-2 rounded-lg font-bold shadow-xl flex flex-col items-center">
                      <span>Click the Headline</span>
                      <ArrowDown size={20} />
                   </div>
                </div>
              )}

              {/* Target Headline */}
              <div 
                id="headline"
                onClick={() => handleElementClick('headline')}
                className={`
                  text-4xl md:text-6xl font-black mb-6 transition-all cursor-default relative
                  ${step === 2 ? 'z-20 cursor-pointer ring-4 ring-cyan-500 ring-offset-4 ring-offset-white' : ''}
                  ${selectedElement === 'headline' ? 'ring-2 ring-cyan-500 ring-offset-4 ring-offset-white' : ''}
                  ${step === 6 && isInspectorActive ? 'hover:bg-cyan-100/50 hover:ring-2 hover:ring-cyan-300 cursor-pointer' : ''}
                `}
                style={{ color: editedColor }}
              >
                {/* Element Badge */}
                {(selectedElement === 'headline' || step === 2) && (
                  <div className={`absolute -top-6 left-0 bg-cyan-500 text-white text-[10px] px-1 font-mono z-30 pointer-events-none ${step > 2 && step < 6 ? 'hidden' : ''}`}>
                    h1.headline
                  </div>
                )}
                Rise Path Web
              </div>

              <div className="text-slate-500 text-lg mb-8 max-w-md text-center">
                Master the art of digital creation with our interactive tools.
              </div>

              {/* Target Button */}
              <div className="relative">
                {step === 4 && (
                   <div className="absolute -left-32 top-1/2 -translate-y-1/2 z-50 animate-pulse flex items-center pointer-events-none">
                      <div className="bg-cyan-600 text-white px-3 py-2 rounded-lg font-bold shadow-xl text-xs mr-2">
                         Bad Padding (0px)
                      </div>
                      <ArrowRightIcon size={24} className="text-cyan-600" />
                   </div>
                )}
                <button 
                  id="button"
                  onClick={() => handleElementClick('button')}
                  className={`
                    bg-black text-white rounded-full font-bold transition-all relative
                    ${step === 4 ? 'z-20 ring-4 ring-cyan-500 ring-offset-4 ring-offset-white' : ''}
                    ${selectedElement === 'button' ? 'ring-2 ring-cyan-500 ring-offset-4 ring-offset-white' : ''}
                    ${step === 6 && isInspectorActive ? 'hover:bg-cyan-100/50 hover:ring-2 hover:ring-cyan-300 cursor-pointer' : ''}
                  `}
                  style={{ padding: editedPadding }}
                >
                  {selectedElement === 'button' && (
                    <div className="absolute -top-6 left-0 bg-cyan-500 text-white text-[10px] px-1 font-mono pointer-events-none">
                      button.cta
                    </div>
                  )}
                  Get Started
                </button>
              </div>
           </div>
        </div>

        {/* RIGHT: DevTools */}
        <div className="w-[350px] md:w-[400px] bg-[#242424] border-l border-slate-700 flex flex-col shadow-2xl relative z-20">
           
           {/* Step 1 Guide: Activate */}
           {step === 1 && (
             <div className="absolute top-14 left-4 z-50 animate-in slide-in-from-left-4 fade-in pointer-events-none">
                <div className="flex items-center gap-2">
                   <ArrowLeftIcon size={24} className="text-cyan-500 animate-pulse" />
                   <div className="bg-cyan-600 text-white px-4 py-2 rounded-lg font-bold shadow-xl text-sm">
                      Click the Inspector Icon
                   </div>
                </div>
             </div>
           )}

           {/* Toolbar */}
           <div className="p-2 border-b border-[#333] flex gap-2 bg-[#242424] relative z-30">
              <button 
                onClick={handleInspectorToggle}
                className={`
                  p-1.5 rounded transition-all duration-300
                  ${isInspectorActive ? 'bg-cyan-500/20 text-cyan-400' : 'text-[#aaa] hover:text-white'}
                  ${step === 1 ? 'ring-2 ring-cyan-500 bg-cyan-500/10 scale-110' : ''}
                `}
              >
                 <MousePointer2 size={16} />
              </button>
              <button className="p-1.5 text-[#aaa] hover:text-white"><Monitor size={16} /></button>
           </div>

           {/* DOM Tree */}
           <div className="flex-1 bg-[#242424] p-2 font-mono text-xs overflow-y-auto border-b border-[#333]">
              <div className="text-[#aaa] pl-2">&lt;body&gt;</div>
              <div className="text-[#aaa] pl-4">&lt;div id="root"&gt;</div>
              <div className="pl-6 text-[#e8eaed]">...</div>
              
              <div 
                 className={`pl-8 cursor-pointer transition-colors ${selectedElement === 'headline' ? 'bg-[#354759]' : 'hover:bg-[#2a2d3e]'}`}
                 onClick={() => step === 6 && setSelectedElement('headline')}
              >
                 <span className="text-purple-400">&lt;h1</span> <span className="text-orange-300">class</span>=<span className="text-green-300">"headline"</span><span className="text-purple-400">&gt;</span>...<span className="text-purple-400">&lt;/h1&gt;</span>
              </div>
              <div 
                 className={`pl-8 mt-1 cursor-pointer transition-colors ${selectedElement === 'button' ? 'bg-[#354759]' : 'hover:bg-[#2a2d3e]'}`}
                 onClick={() => step === 6 && setSelectedElement('button')}
              >
                 <span className="text-purple-400">&lt;button</span> <span className="text-orange-300">class</span>=<span className="text-green-300">"cta"</span><span className="text-purple-400">&gt;</span>...<span className="text-purple-400">&lt;/button&gt;</span>
              </div>
           </div>

           {/* Styles Pane */}
           <div className="h-1/2 bg-[#242424] flex flex-col relative overflow-visible">
              <div className="bg-[#333] px-2 py-1 text-xs text-[#aaa] font-bold border-b border-[#111]">Styles</div>
              
              <div className="flex-1 p-2 font-mono text-xs relative">
                 {selectedElement === 'headline' && (
                    <div className="mb-4">
                       <div className="text-[#aaa] mb-1">.headline {'{'}</div>
                       <div className="pl-4 text-[#aaa]">/* ... */</div>
                       
                       {/* STEP 3 GUIDE: Color Input */}
                       <div className={`pl-4 flex items-center gap-2 group relative p-1 rounded ${step === 3 ? 'bg-cyan-900/30' : ''}`}>
                          <span className="text-cyan-300">color</span>: 
                          <div className="flex items-center gap-1 relative z-30">
                             {/* Color Swatch - Clickable for help */}
                             <div 
                               onClick={autoFillColor}
                               className={`w-3 h-3 border border-[#555] cursor-pointer hover:scale-125 transition-transform ${step === 3 ? 'animate-pulse ring-2 ring-white' : ''}`} 
                               style={{background: editedColor}}
                               title={step === 3 ? "Click to auto-fill (Help)" : "Current Color"}
                             ></div>
                             
                             <input 
                               ref={colorInputRef}
                               type="text" 
                               value={editedColor}
                               onChange={handleColorChange}
                               className={`
                                  bg-transparent border-none focus:ring-0 p-0 h-auto w-24 text-orange-300 focus:bg-[#333] rounded px-1
                                  ${step === 3 ? 'ring-2 ring-cyan-500 bg-[#333]' : ''}
                               `}
                             />
                          </div>
                          
                          {/* Floating Hint for Step 3 - REPOSITIONED to be visible */}
                          {step === 3 && (
                             <div className="absolute top-8 left-0 z-50 flex flex-col items-start animate-in slide-in-from-top-2 fade-in">
                                <div className="bg-cyan-600 text-white px-3 py-2 rounded-lg font-bold text-xs shadow-2xl border border-cyan-400/50 flex flex-col gap-1 w-48">
                                   <span>Type <span className="font-mono bg-black/20 px-1 rounded">#3b82f6</span></span>
                                   <span className="text-[10px] font-normal opacity-80">(Or click the color box to auto-fill)</span>
                                </div>
                                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-cyan-600 ml-6 -mt-1 transform rotate-180"></div>
                             </div>
                          )}
                       </div>
                       <div className="text-[#aaa]">{'}'}</div>
                    </div>
                 )}

                 {selectedElement === 'button' && (
                    <div className="mb-4">
                       <div className="text-[#aaa] mb-1">button.cta {'{'}</div>
                       <div className="pl-4 flex items-center gap-2"><span className="text-cyan-300">background</span>: <span className="text-orange-300">black</span>;</div>
                       
                       {/* STEP 4 GUIDE: Padding Input */}
                       <div className={`pl-4 flex items-center gap-2 group relative p-1 rounded ${step === 4 ? 'bg-cyan-900/30' : ''}`}>
                          <span className="text-cyan-300">padding</span>: 
                          <div className="relative z-30 flex items-center gap-2">
                             {/* Helper click area */}
                             <div onClick={autoFillPadding} className={`w-3 h-3 border border-transparent cursor-pointer ${step === 4 ? 'animate-pulse bg-white/10' : ''}`}></div>
                             
                             <input 
                                  ref={paddingInputRef}
                                  type="text" 
                                  value={editedPadding}
                                  onChange={handlePaddingChange}
                                  className={`
                                    bg-transparent border-none focus:ring-0 p-0 h-auto w-24 text-orange-300 focus:bg-[#333] rounded px-1
                                    ${step === 4 ? 'ring-2 ring-cyan-500 bg-[#333]' : ''}
                                  `}
                                />
                          </div>
                          
                          {/* Floating Hint for Step 4 */}
                          {step === 4 && (
                             <div className="absolute top-8 left-0 z-50 flex flex-col items-start animate-in slide-in-from-top-2 fade-in">
                                <div className="bg-cyan-600 text-white px-3 py-2 rounded-lg font-bold text-xs shadow-2xl border border-cyan-400/50 w-40">
                                   Type <span className="font-mono bg-black/20 px-1 rounded">20px</span>
                                </div>
                                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-cyan-600 ml-6 -mt-1 transform rotate-180"></div>
                             </div>
                          )}
                       </div>
                       <div className="pl-4 flex items-center gap-2"><span className="text-cyan-300">border-radius</span>: <span className="text-orange-300">99px</span>;</div>
                       <div className="text-[#aaa]">{'}'}</div>
                    </div>
                 )}
                 
                 {!selectedElement && (
                    <div className="text-[#555] italic p-4 text-center mt-4">
                       {step === 6 ? 'Select an element to edit.' : 'Inspector not active on an element.'}
                    </div>
                 )}
              </div>
           </div>
        </div>

      </div>
    </div>
  );
};

export default WebInspectorView;