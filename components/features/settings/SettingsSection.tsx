import React from 'react';

interface SettingsSectionProps {
    title: string;
    children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ title, children }) => (
    <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">{title}</h2>
        <div className="space-y-2">{children}</div>
    </section>
);

export default SettingsSection;