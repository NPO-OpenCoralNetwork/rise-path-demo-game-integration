import React from 'react';
import { Loader2, Play } from 'lucide-react';
import type { VoiceCatalogEntry } from '../../../data/tts/voiceCatalog';

interface VoiceOptionRowProps {
    entry: VoiceCatalogEntry;
    language: 'jp' | 'en';
    selected: boolean;
    disabled?: boolean;
    isPreviewing?: boolean;
    previewError?: string | null;
    onSelect: () => void;
    onPreview: () => void;
}

const VoiceOptionRow: React.FC<VoiceOptionRowProps> = ({
    entry,
    language,
    selected,
    disabled = false,
    isPreviewing = false,
    previewError,
    onSelect,
    onPreview,
}) => {
    const label = entry.label[language];
    const description = entry.description[language];
    const labelId = `voice-label-${entry.id}`;

    return (
        <div className="space-y-1">
            <div
                className={`flex items-center justify-between gap-3 p-4 border rounded-2xl bg-white transition-colors ${
                    disabled ? 'opacity-50 border-slate-100'
                        : selected ? 'border-indigo-500 ring-2 ring-indigo-100'
                        : 'border-slate-100 hover:border-slate-200'
                }`}
            >
                <label
                    htmlFor={`voice-radio-${entry.id}`}
                    id={labelId}
                    className={`flex flex-1 items-start gap-3 min-w-0 ${
                        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                >
                    <input
                        id={`voice-radio-${entry.id}`}
                        type="radio"
                        name="tts-voice"
                        value={entry.id}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => onSelect()}
                        className="sr-only"
                    />
                    <span className={`mt-0.5 text-sm ${selected ? 'text-indigo-600' : 'text-slate-400'}`} aria-hidden>
                        {selected ? '◉' : '○'}
                    </span>
                    <div className="min-w-0">
                        <div className="font-medium text-slate-800">{label}</div>
                        <div className="text-sm text-slate-500">{description}</div>
                    </div>
                </label>
                <button
                    type="button"
                    disabled={disabled || isPreviewing}
                    aria-labelledby={labelId}
                    aria-busy={isPreviewing}
                    onClick={onPreview}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors disabled:opacity-50"
                >
                    {isPreviewing ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        <Play size={14} fill="currentColor" />
                    )}
                    <span>{language === 'jp' ? '試聴' : 'Preview'}</span>
                </button>
            </div>
            {previewError && (
                <p className="text-sm text-red-600 px-1">{previewError}</p>
            )}
        </div>
    );
};

export default VoiceOptionRow;