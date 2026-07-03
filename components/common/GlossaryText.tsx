import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY_TERMS, GlossaryTerm } from '../../data/glossary/terms';
import { Sparkles, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

// Utility to escape regex characters
const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\\]/g, '\\$&');
};

interface GlossaryTextProps {
  text: string;
}

const GlossaryText: React.FC<GlossaryTextProps> = ({ text }) => {
  const { language } = useLanguage();
  const [activeTerm, setActiveTerm] = useState<GlossaryTerm | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number, y: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setActiveTerm(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTermClick = (e: React.MouseEvent, term: GlossaryTerm) => {
    e.stopPropagation();
    e.preventDefault();
    
    const rect = e.currentTarget.getBoundingClientRect();
    const popupWidth = 280; // Match w-[280px]
    const windowWidth = window.innerWidth;
    
    // Default: Align left with the term
    let leftPos = rect.left + window.scrollX;
    
    // If popup goes off-screen to the right, align right with the term instead
    if (rect.left + popupWidth > windowWidth - 20) {
       leftPos = (rect.right + window.scrollX) - popupWidth;
    }
    
    // Final safety check to ensure it doesn't go off-screen to the left
    leftPos = Math.max(10, leftPos);

    setPopupPosition({
      x: leftPos,
      y: rect.bottom + window.scrollY + 8
    });
    setActiveTerm(term);
  };

  const handleAskAI = () => {
    if (!activeTerm) return;
    
    // Get localized prompt or default
    const contextPrompt = activeTerm.aiContextPrompts ? activeTerm.aiContextPrompts[language] : undefined;
    const askPrefix = language === 'jp' ? 'について教えてください。' : ' tell me more about this.';

    // Dispatch a custom event that the Layout or Chatbot component can listen to
    const event = new CustomEvent('open-rise-path-chat', { 
      detail: { 
        message: `${activeTerm.term}${askPrefix}`,
        context: contextPrompt 
      } 
    });
    window.dispatchEvent(event);
    
    setActiveTerm(null);
  };

  const renderContent = () => {
    // Step 1: Split by Bold Markdown
    const boldParts = text.split(/(\*\*.*?\*\*)/g);
    
    // Sort terms by length (desc) to match longest terms first
    const sortedTerms = [...GLOSSARY_TERMS].sort((a, b) => b.term.length - a.term.length);

    // Create a mapping of all patterns (term + synonyms) to their original term object
    const termToIdMap: Record<string, string> = {};
    const allSearchPatterns: string[] = [];
    
    sortedTerms.forEach(t => {
      // Main term
      allSearchPatterns.push(escapeRegExp(t.term));
      termToIdMap[t.term] = t.id;
      
      // Synonyms
      t.synonyms?.forEach(syn => {
        allSearchPatterns.push(escapeRegExp(syn));
        termToIdMap[syn] = t.id;
      });
    });

    // Re-sort patterns by length to avoid partial matches
    const termPattern = allSearchPatterns.sort((a, b) => b.length - a.length).join('|');
    
    return boldParts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-slate-900 font-bold">{part.slice(2, -2)}</strong>;
      }
      
      if (!termPattern) return <span key={i}>{part}</span>;
      
      const regex = new RegExp(`(${termPattern})`, 'g');
      const textParts = part.split(regex);
      
      return (
        <React.Fragment key={i}>
          {textParts.map((subPart, j) => {
            const termId = termToIdMap[subPart];
            const matchedTerm = termId ? sortedTerms.find(t => t.id === termId) : null;
            
            if (matchedTerm) {
              return (
                <span 
                  key={j}
                  onClick={(e) => handleTermClick(e, matchedTerm)}
                  className="cursor-help border-b-2 border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 transition-colors px-0.5 rounded-sm"
                  title="Click for definition"
                >
                  {subPart}
                </span>
              );
            }
            return <span key={j}>{subPart}</span>;
          })}
        </React.Fragment>
      );
    });
  };

  return (
    <>
      {renderContent()}
      
      {activeTerm && popupPosition && createPortal(
        <div 
            ref={popupRef}
            style={{ 
              position: 'absolute', 
              top: popupPosition.y, 
              left: popupPosition.x,
              zIndex: 9999 
            }}
            className="w-[280px] bg-white rounded-xl shadow-xl border border-indigo-100 p-4 animate-in fade-in zoom-in-95 duration-200"
        >
          <button 
            onClick={() => setActiveTerm(null)}
            className="absolute top-2 right-2 text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
          
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
               {activeTerm.category}
            </span>
            <h3 className="font-bold text-slate-800">{activeTerm.term}</h3>
          </div>
          
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {activeTerm.definitions[language]}
          </p>
          
          <button 
            onClick={handleAskAI}
            className="w-full bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all group"
          >
            <Sparkles size={14} className="text-indigo-300 group-hover:text-white" />
            {language === 'jp' ? 'AI先生に詳しく聞く' : 'Ask AI Tutor'}
          </button>
        </div>,
        document.body
      )}
    </>
  );
};

export default GlossaryText;