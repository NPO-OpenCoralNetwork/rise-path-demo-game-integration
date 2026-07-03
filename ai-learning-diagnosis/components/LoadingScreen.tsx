import React, { useEffect, useState } from 'react';

const LoadingScreen: React.FC = () => {
    const [message, setMessage] = useState("回答を分析中...");

    useEffect(() => {
        const messages = [
            "回答を分析中...",
            "思考パターンをモデル化...",
            "学習特性を照合中...",
            "最適化レポートを作成中..."
        ];
        let i = 0;
        const interval = setInterval(() => {
            i = (i + 1) % messages.length;
            setMessage(messages[i]);
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4">
            <div className="relative w-24 h-24 mb-8">
                <div className="absolute inset-0 border-t-2 border-blue-500 rounded-full animate-spin"></div>
                <div className="absolute inset-2 border-r-2 border-purple-500 rounded-full animate-spin [animation-duration:1.5s]"></div>
                <div className="absolute inset-4 border-b-2 border-cyan-500 rounded-full animate-spin [animation-duration:2s]"></div>
            </div>
            
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-500 mb-2">
                AI Analysing
            </h2>
            <p className="text-slate-500 animate-pulse">
                {message}
            </p>
        </div>
    );
};

export default LoadingScreen;
