import React from 'react';
import { ChevronRight } from 'lucide-react';

interface SettingsRowProps {
    icon: React.ReactNode;
    label: string;
    subtext?: string;
    onClick?: () => void;
    disabled?: boolean;
    badge?: string;
}

const SettingsRow: React.FC<SettingsRowProps> = ({
    icon,
    label,
    subtext,
    onClick,
    disabled = false,
    badge,
}) => {
    const content = (
        <>
            <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg shrink-0 ${disabled ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-600'}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="font-medium text-slate-700 flex items-center gap-2">
                        <span>{label}</span>
                        {badge && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                {badge}
                            </span>
                        )}
                    </div>
                    {subtext && <p className="text-sm text-slate-500 truncate">{subtext}</p>}
                </div>
            </div>
            {!disabled && <ChevronRight size={18} className="text-slate-400 shrink-0" />}
        </>
    );

    const className = `w-full flex items-center justify-between gap-3 p-4 border border-slate-100 rounded-2xl bg-white shadow-sm text-left transition-colors ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'
    }`;

    if (disabled || !onClick) {
        return <div className={className}>{content}</div>;
    }

    return (
        <button type="button" onClick={onClick} className={className}>
            {content}
        </button>
    );
};

export default SettingsRow;