import React from 'react';

interface StatsCardProps {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    trend?: string;
    trendUp?: boolean;
}

export const StatsCard: React.FC<StatsCardProps> = ({ label, value, icon, trend, trendUp }) => {
    return (
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex flex-col justify-between">
            <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
                <div className="text-slate-400 opacity-80">{icon}</div>
            </div>
            <div>
                <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
                {trend && (
                    <div className={`text-xs mt-1 font-medium ${trendUp ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {trend}
                    </div>
                )}
            </div>
        </div>
    );
};
