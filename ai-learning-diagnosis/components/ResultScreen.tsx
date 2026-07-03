import React from 'react';
import { DiagnosisResult } from '../types';
import { 
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
    PieChart, Pie, Cell, Tooltip
} from 'recharts';
import { CheckCircle2, AlertTriangle, Lightbulb, Clock, RefreshCcw, Briefcase, Zap, Sparkles, Brain, Heart, Anchor, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ResultScreenProps {
    result: DiagnosisResult;
    onRetake: () => void;
}

const COLORS = ['#2563eb', '#7c3aed', '#14b8a6', '#f97316', '#e11d48'];

const RadarShape: React.FC<any> = ({ points, stroke, fill, strokeWidth, fillOpacity }) => {
    if (!points || points.length === 0) return null;
    const pointString = points.map((point: { x: number; y: number }) => `${point.x},${point.y}`).join(' ');
    return (
        <polygon
            className="radar-grow"
            points={pointString}
            stroke={stroke}
            fill={fill}
            strokeWidth={strokeWidth}
            fillOpacity={fillOpacity}
        />
    );
};

const ResultScreen: React.FC<ResultScreenProps> = ({ result, onRetake }) => {
    const navigate = useNavigate();
    const characterId = result.characterId || 'openness';
    const characterVisuals: Record<string, { gradient: string; icon: React.ReactNode }> = {
        openness: { gradient: 'from-purple-500 to-indigo-600', icon: <Sparkles size={28} /> },
        conscientiousness: { gradient: 'from-blue-500 to-cyan-600', icon: <Brain size={28} /> },
        extraversion: { gradient: 'from-orange-400 to-red-500', icon: <Zap size={28} /> },
        agreeableness: { gradient: 'from-emerald-400 to-teal-500', icon: <Heart size={28} /> },
        stability: { gradient: 'from-slate-500 to-slate-700', icon: <Anchor size={28} /> }
    };
    const characterVisual = characterVisuals[characterId] || characterVisuals.openness;
    const topAllocation = (result.studyAllocation || []).reduce((prev, current) => (
        current.value > prev.value ? current : prev
    ), { name: '', value: 0 });
    const bestEnvironment = (() => {
        if (!topAllocation?.name) return '短時間で集中できる静かな環境';
        if (/探索|Explore|Exploration/i.test(topAllocation.name)) return '刺激的なインプット環境';
        if (/実践|Execute|Exécution/i.test(topAllocation.name)) return '静かな集中環境で手を動かす';
        if (/発信|Share|Partage/i.test(topAllocation.name)) return '仲間と進捗共有できる場';
        return '短時間で集中できる静かな環境';
    })();
    const actionSteps = (result.dailyRoutineAdvice || '')
        .split(' / ')
        .map((step) => step.trim())
        .filter(Boolean)
        .slice(0, 3);
    const watchOut = result.weaknesses?.[0] || 'ペースが乱れると集中が切れやすい';
    const routineHighlight = topAllocation?.name
        ? `${topAllocation.name}を軸に、${bestEnvironment}で学習する。`
        : '集中できる環境を整え、短いサイクルで学習する。';
    return (
        <div className="min-h-screen py-12 px-4 md:px-6 max-w-7xl mx-auto space-y-8 animate-[fadeIn_0.8s_ease-out] text-slate-900">
            
            {/* Header Section */}
            <header className="text-center space-y-4 mb-12">
                <div className="inline-block px-4 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-semibold tracking-wide uppercase mb-2">
                    Analysis Complete
                </div>
                <h1 className="text-4xl md:text-6xl font-bold text-slate-900 mb-2">
                    {result.archetypeName}
                </h1>
                <p className="text-xl md:text-2xl gradient-text font-medium">
                    {result.tagline}
                </p>
                <p className="text-slate-600 max-w-3xl mx-auto mt-6 leading-relaxed">
                    {result.summary}
                </p>
            </header>

            <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-6 shadow-md">
                <div className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-indigo-500/10 blur-[90px]"></div>
                <div className="relative flex flex-col md:flex-row items-start md:items-center gap-6">
                    <div className={`h-16 w-16 rounded-2xl bg-gradient-to-br ${characterVisual.gradient} text-white flex items-center justify-center shadow-lg`}>
                        {characterVisual.icon}
                    </div>
                    <div className="flex-1 space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">AI Character Assigned</div>
                        <h2 className="text-2xl font-bold text-slate-900">
                            {result.archetypeName}
                            {result.characterBotName ? (
                                <span className="text-slate-500 text-sm font-semibold"> / {result.characterBotName}</span>
                            ) : null}
                        </h2>
                        <p className="text-sm text-slate-600 leading-relaxed">
                            {result.characterDescription || result.summary}
                        </p>
                    </div>
                    <button
                        onClick={() => navigate(`/character/${characterId}`)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-5 py-3 text-xs font-black uppercase tracking-[0.3em] shadow-lg shadow-slate-900/20 hover:bg-indigo-600 transition"
                    >
                        キャラクタープロフィールを見る
                        <ArrowUpRight size={16} />
                    </button>
                </div>
            </section>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Radar Chart: Traits */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-1 flex flex-col items-center justify-center min-h-[400px] shadow-md">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <Zap size={20} className="text-yellow-400" />
                        能力パラメータ
                    </h3>
                    <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={result.traits}>
                                <PolarGrid stroke="#e2e8f0" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                <Radar
                                    name="Score"
                                    dataKey="A"
                                    stroke="#818cf8"
                                    strokeWidth={3}
                                    fill="#818cf8"
                                    fillOpacity={0.4}
                                    isAnimationActive={false}
                                    shape={(props) => <RadarShape {...props} />}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Pie Chart: Time Allocation */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-1 flex flex-col items-center justify-center min-h-[400px] shadow-md">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <Clock size={20} className="text-green-400" />
                        推奨時間配分
                    </h3>
                    <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={result.studyAllocation}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={5}
                                    dataKey="value"
                                    isAnimationActive={true}
                                    animationDuration={1500}
                                    animationBegin={200}
                                    animationEasing="ease-out"
                                >
                                    {result.studyAllocation.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px' }}
                                    itemStyle={{ color: '#0f172a' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-3 justify-center mt-4">
                        {result.studyAllocation.map((entry, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs text-slate-600">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                {entry.name}: {entry.value}%
                            </div>
                        ))}
                    </div>
                </div>

                {/* Action Guidance */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-1 flex flex-col justify-center shadow-md">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <Lightbulb size={20} className="text-purple-400" />
                        行動指針
                    </h3>
                    <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Learning Rhythm</div>
                            <p className="text-sm font-semibold text-slate-800 mt-1">
                                {result.recommendedMethod}
                            </p>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500">Watch Out</div>
                            <p className="text-sm font-semibold text-slate-800 mt-1">
                                {watchOut}
                            </p>
                        </div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-500">Best Environment</div>
                            <p className="text-sm font-semibold text-slate-800 mt-1">
                                {bestEnvironment}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Detailed Analysis Row */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-2 shadow-md">
                     <h3 className="text-xl font-bold text-slate-900 mb-6">学習メソッド & ルーティン</h3>
                     <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="text-blue-400 font-semibold mb-2">推奨学習法</h4>
                            <p className="text-slate-600 text-sm leading-relaxed mb-6">
                                {result.recommendedMethod}
                            </p>
                            <h4 className="text-purple-400 font-semibold mb-2">今週のフォーカス</h4>
                            <p className="text-slate-600 text-sm leading-relaxed">
                                {routineHighlight}
                            </p>
                        </div>
                        <div className="space-y-4">
                            {actionSteps.length > 0 && (
                                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                                    <h4 className="text-slate-800 font-semibold mb-2 flex items-center gap-2">
                                        <CheckCircle2 size={18}/> 今日の3ステップ
                                    </h4>
                                    <ul className="space-y-1">
                                        {actionSteps.map((step, i) => (
                                            <li key={i} className="text-slate-600 text-sm">• {step}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-xl">
                                <h4 className="text-green-500 font-semibold mb-2 flex items-center gap-2">
                                    <CheckCircle2 size={18}/> Strengths
                                </h4>
                                <ul className="space-y-1">
                                    {result.strengths.map((s, i) => (
                                        <li key={i} className="text-slate-700 text-sm">• {s}</li>
                                    ))}
                                </ul>
                            </div>
                            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl">
                                <h4 className="text-red-500 font-semibold mb-2 flex items-center gap-2">
                                    <AlertTriangle size={18}/> Weaknesses
                                </h4>
                                <ul className="space-y-1">
                                    {result.weaknesses.map((w, i) => (
                                        <li key={i} className="text-slate-700 text-sm">• {w}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                     </div>
                </div>
                 
                 {/* Action Panel */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-1 flex flex-col items-center justify-center text-center shadow-md">
                    <p className="text-slate-600 mb-6 text-sm">
                        この診断結果は今のあなたの状態を表しています。
                        環境や目標が変われば、最適なスタイルも変化します。
                    </p>
                    <button 
                        onClick={onRetake}
                        className="px-6 py-3 bg-slate-900 text-white rounded-full font-bold hover:bg-slate-800 transition-colors flex items-center gap-2"
                    >
                        <RefreshCcw size={18} />
                        診断をやり直す
                    </button>
                </div>

            </div>
        </div>
    );
};

export default ResultScreen;
