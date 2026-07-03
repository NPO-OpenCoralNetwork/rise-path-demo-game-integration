import { GoogleGenAI, Type } from "@google/genai";
import { UserAnswer, DiagnosisResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateDiagnosis = async (answers: UserAnswer[]): Promise<DiagnosisResult> => {
    const prompt = `
    あなたはプロの教育心理学者およびキャリアコーチです。
    以下のユーザーの回答に基づいて、学習スタイル、性格、最適な学習方法を分析し、JSON形式で診断結果を出力してください。
    
    ユーザーの回答:
    ${JSON.stringify(answers, null, 2)}
    
    分析の観点:
    1. クリエイティブでかっこいい「アーキタイプ名」（例：「知識の錬金術師」「静寂の戦略家」など）をつけてください。
    2. 学習における「論理性」「直感」「集中力」「計画性」「柔軟性」の5つのパラメータ（0-100）を評価してください。
    3. 推奨する学習時間の配分（インプット、アウトプット、休憩、復習など）をパーセンテージで提案してください。
    4. 具体的な強みと弱み、推奨する学習ツールや日常のルーティンを提案してください。
    5. 全体的なトーンは、励ましつつも鋭い洞察を含む、モダンで洗練されたものにしてください。日本語で出力してください。
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        archetypeName: { type: Type.STRING, description: "A cool, metaphorical title for the user's personality/learning type." },
                        tagline: { type: Type.STRING, description: "A short, catchy subtitle describing them." },
                        summary: { type: Type.STRING, description: "A comprehensive summary of their personality and learning style." },
                        traits: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    subject: { type: Type.STRING, description: "Trait name (e.g. Logic, Focus)" },
                                    A: { type: Type.INTEGER, description: "Score from 0 to 100" },
                                    fullMark: { type: Type.INTEGER, description: "Always 100" }
                                }
                            }
                        },
                        studyAllocation: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING, description: "Activity name (Input, Output, etc.)" },
                                    value: { type: Type.INTEGER, description: "Percentage value" }
                                }
                            }
                        },
                        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                        weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
                        recommendedMethod: { type: Type.STRING, description: "Specific study method recommendation." },
                        dailyRoutineAdvice: { type: Type.STRING, description: "Advice for daily life improvements." },
                        personalityInsight: { type: Type.STRING, description: "Insight into their general personality outside studying." },
                        tools: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Recommended tools or apps." }
                    }
                }
            }
        });

        if (response.text) {
            return JSON.parse(response.text) as DiagnosisResult;
        } else {
            throw new Error("Empty response from AI");
        }
    } catch (error) {
        console.error("Gemini API Error:", error);
        // Fallback or re-throw depending on app logic.
        throw error;
    }
};