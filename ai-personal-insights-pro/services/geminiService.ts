
import { GoogleGenAI, Type } from "@google/genai";
import { AssessmentProfile, AIAdvice } from "../types";

export async function generateCoachAdvice(profile: AssessmentProfile): Promise<AIAdvice | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    以下の性格診断結果（Big Five）に基づき、高度にパーソナライズされた解析レポートをJSON形式で作成してください。
    
    【対象プロファイル】
    - タイプ: ${profile.personalityType}
    - 開放性: ${profile.scores.openness}%
    - 誠実性: ${profile.scores.conscientiousness}%
    - 外向性: ${profile.scores.extraversion}%
    - 協調性: ${profile.scores.agreeableness}%
    - 神経症傾向: ${profile.scores.neuroticism}%

    【JSON構造ルール】
    1. strengths: 3つの強み
    2. growthTips: 3つの成長に向けたヒント
    3. learningStrategy: 学習戦略
    4. careerCompatibility: 適職
    5. relationshipAnalysis: 恋愛や深い人間関係におけるスタイル、理想のパートナー像、アドバイス
    6. businessPartnership: 仕事での役割、最も相性の良いタイプ、注意すべき点
    7. hiddenTalent: 本人も気づいていないかもしれないユニークな才能のタイトルと説明

    出力は純粋なJSONのみにしてください。
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            strengths: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["title", "description"]
              }
            },
            growthTips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["title", "description"]
              }
            },
            learningStrategy: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                approach: { type: Type.STRING },
                steps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      action: { type: Type.STRING },
                    },
                    required: ["label", "action"]
                  }
                }
              },
              required: ["title", "approach", "steps"]
            },
            careerCompatibility: { type: Type.STRING },
            relationshipAnalysis: {
              type: Type.OBJECT,
              properties: {
                style: { type: Type.STRING },
                idealPartner: { type: Type.STRING },
                advice: { type: Type.STRING }
              },
              required: ["style", "idealPartner", "advice"]
            },
            businessPartnership: {
              type: Type.OBJECT,
              properties: {
                role: { type: Type.STRING },
                bestSync: { type: Type.STRING },
                warning: { type: Type.STRING }
              },
              required: ["role", "bestSync", "warning"]
            },
            hiddenTalent: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["title", "description"]
            }
          },
          required: ["strengths", "growthTips", "learningStrategy", "careerCompatibility", "relationshipAnalysis", "businessPartnership", "hiddenTalent"]
        }
      },
    });

    const result = JSON.parse(response.text);
    return result as AIAdvice;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return null;
  }
}
