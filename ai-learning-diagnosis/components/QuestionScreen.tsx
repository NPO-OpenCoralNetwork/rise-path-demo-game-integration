import React from 'react';
import { Question, Option } from '../types';
import { ChevronRight } from 'lucide-react';

interface QuestionScreenProps {
    question: Question;
    currentStep: number;
    totalSteps: number;
    onAnswer: (option: Option) => void;
}

const QuestionScreen: React.FC<QuestionScreenProps> = ({ question, currentStep, totalSteps, onAnswer }) => {
    const progressPercentage = ((currentStep) / totalSteps) * 100;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 max-w-3xl mx-auto w-full">
            {/* Progress Bar */}
            <div className="w-full h-1 bg-slate-800 rounded-full mb-12 overflow-hidden">
                <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ease-out"
                    style={{ width: `${progressPercentage}%` }}
                ></div>
            </div>

            <div className="w-full glass-panel rounded-2xl p-8 md:p-12 shadow-2xl animate-[fadeIn_0.5s_ease-out]">
                <div className="text-sm font-medium text-blue-400 mb-4 tracking-wider uppercase">
                    Question {currentStep} / {totalSteps}
                </div>
                
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-10 leading-snug">
                    {question.text}
                </h2>

                <div className="space-y-4">
                    {question.options.map((option) => (
                        <button
                            key={option.id}
                            onClick={() => onAnswer(option)}
                            className="w-full text-left p-5 rounded-xl bg-slate-800/50 hover:bg-blue-600/20 border border-slate-700 hover:border-blue-500/50 transition-all duration-200 group flex items-center justify-between"
                        >
                            <span className="text-slate-200 group-hover:text-white text-lg">
                                {option.text}
                            </span>
                            <ChevronRight className="text-slate-600 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default QuestionScreen;