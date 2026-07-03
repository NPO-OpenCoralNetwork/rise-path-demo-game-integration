
export enum AssessmentStep {
  OVERVIEW = 'overview',
  PERSONALITY = 'personality',
  LEARNING_STYLE = 'learning-style',
  MOTIVATION = 'motivation',
  INTRO = 'intro',
  RESULTS = 'results'
}

export interface BigFiveScores {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export type PersonalityType = '冒険家' | '戦略家' | 'サポーター' | '思想家' | '職人' | 'バランサー';

export interface AIAdvice {
  strengths: { title: string; description: string }[];
  growthTips: { title: string; description: string }[];
  learningStrategy: {
    title: string;
    approach: string;
    steps: { label: string; action: string }[];
  };
  careerCompatibility: string;
  // 新規追加項目
  relationshipAnalysis: {
    style: string;
    idealPartner: string;
    advice: string;
  };
  businessPartnership: {
    role: string;
    bestSync: string;
    warning: string;
  };
  hiddenTalent: {
    title: string;
    description: string;
  };
}

export interface AssessmentProfile {
  scores: BigFiveScores;
  personalityType: PersonalityType;
  learningStyle: string;
  motivation: string;
  completedAt: string;
  aiAdvice?: AIAdvice;
}

export interface Question {
  id: number;
  text: string;
  category: keyof BigFiveScores;
  inverse?: boolean;
}
