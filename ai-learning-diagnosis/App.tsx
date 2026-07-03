import React, { useState } from 'react';
import { QUESTIONS } from './constants';
import { UserAnswer, DiagnosisResult } from './types';
import { generateDiagnosis } from './services/geminiService';
import WelcomeScreen from './components/WelcomeScreen';
import LoadingScreen from './components/LoadingScreen';
import ResultScreen from './components/ResultScreen';

const App: React.FC = () => {
    // Simplified states: 'welcome' | 'loading' | 'result'
    const [appState, setAppState] = useState<'welcome' | 'loading' | 'result'>('welcome');
    const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);

    const handleStart = async () => {
        setAppState('loading');

        // Automatically generate random answers for the defined questions to simulate user input
        // This allows the prompt to remain the same while skipping the manual quiz step
        const simulatedAnswers: UserAnswer[] = QUESTIONS.map(q => ({
            questionId: q.id,
            questionText: q.text,
            selectedOption: q.options[Math.floor(Math.random() * q.options.length)].text
        }));

        try {
            const result = await generateDiagnosis(simulatedAnswers);
            setDiagnosisResult(result);
            setAppState('result');
        } catch (error) {
            console.error("Diagnosis Failed", error);
            alert("診断中にエラーが発生しました。もう一度お試しください。");
            setAppState('welcome');
        }
    };

    const handleRetake = () => {
        setDiagnosisResult(null);
        setAppState('welcome');
    };

    return (
        <main className="w-full min-h-screen bg-[#0f172a] text-slate-100 overflow-x-hidden relative">
            {/* Ambient Background Effects */}
            <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-900/20 rounded-full blur-[120px] animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 rounded-full blur-[120px] animate-pulse [animation-delay:2s]"></div>
            </div>

            {/* Content Layer */}
            <div className="relative z-10">
                {appState === 'welcome' && (
                    <WelcomeScreen onStart={handleStart} />
                )}

                {appState === 'loading' && (
                    <LoadingScreen />
                )}

                {appState === 'result' && diagnosisResult && (
                    <ResultScreen 
                        result={diagnosisResult}
                        onRetake={handleRetake}
                    />
                )}
            </div>
        </main>
    );
};

export default App;