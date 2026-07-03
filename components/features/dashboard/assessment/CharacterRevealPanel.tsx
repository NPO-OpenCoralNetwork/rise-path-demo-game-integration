import React from 'react';
import { ArrowUpRight } from 'lucide-react';

type CharacterRevealTrait = {
  id: string;
  label: string;
  score: number;
  color: string;
  icon: React.ReactNode;
};

type CharacterRevealPanelProps = {
  title: string;
  subtitle: string;
  protocolLabel: string;
  ctaLabel: string;
  character: {
    id: string;
    name: string;
    botName: string;
    description: string;
    gradient: string;
    icon: React.ReactNode;
  };
  topTraits: CharacterRevealTrait[];
  onOpenProfile: () => void;
};

const CharacterRevealPanel: React.FC<CharacterRevealPanelProps> = ({
  title,
  subtitle,
  protocolLabel,
  ctaLabel,
  character,
  topTraits,
  onOpenProfile
}) => {
  return (
    <section className="relative overflow-hidden rounded-[2.5rem] bg-white border border-slate-100 shadow-2xl p-6 sm:p-8 md:p-10">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-[120px]"></div>
      <div className={`pointer-events-none absolute -bottom-20 left-10 h-48 w-48 rounded-full bg-gradient-to-br ${character.gradient} opacity-20 blur-[120px]`}></div>

      <div className="relative grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr] gap-6 md:gap-8 items-center">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.35em]">
            {protocolLabel}
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500">{subtitle}</div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
              {title}
            </h1>
            <p className="text-slate-600 font-medium leading-relaxed max-w-md">
              {character.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-5 py-3 text-xs font-black uppercase tracking-[0.3em] shadow-lg shadow-slate-900/20 hover:bg-indigo-600 transition"
          >
            {ctaLabel}
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        <div className="relative rounded-[2rem] bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl border border-white/10">
          <div className={`absolute -top-10 right-4 h-24 w-24 rounded-full bg-gradient-to-br ${character.gradient} opacity-40 blur-2xl`}></div>
          <div className="relative space-y-6">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-slate-400 font-bold">
              <span>AI Companion</span>
              <span>Assigned</span>
            </div>
            <div className="flex items-center gap-4">
              <div className={`h-16 w-16 rounded-[1.25rem] bg-gradient-to-br ${character.gradient} text-white flex items-center justify-center shadow-lg`}>
                {character.icon}
              </div>
              <div>
                <div className="text-xl font-black text-white tracking-tight">{character.name}</div>
                <div className="text-sm text-slate-300 font-semibold">{character.botName}</div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300 font-medium">
              {character.description}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {topTraits.map((trait) => (
            <div key={trait.id} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white/90 px-4 py-3 shadow-sm">
              <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${trait.color} text-white flex items-center justify-center shadow-md`}>
                {trait.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Top Trait</div>
                <div className="text-sm font-bold text-slate-800 truncate">{trait.label}</div>
              </div>
              <div className="text-lg font-black text-slate-900">{trait.score}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CharacterRevealPanel;
