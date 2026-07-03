export interface Option {
    id: string;
    text: string;
}

export interface Question {
    id: number;
    text: string;
    options: Option[];
}

export interface UserAnswer {
    questionId: number;
    questionText: string;
    selectedOption: string;
}

// Data for Radar Chart
export interface TraitScore {
    subject: string; // e.g., "Focus", "Creativity", "Logic"
    A: number; // Score 0-100
    fullMark: number;
}

// Data for Pie Chart
export interface TimeAllocation {
    name: string; // e.g., "Input", "Output", "Rest"
    value: number; // Percentage
    [key: string]: string | number;
}

export interface DiagnosisResult {
    archetypeName: string; // Catchy title like "The Strategic Architect"
    tagline: string; // Short subtitle
    summary: string;
    characterId?: string;
    characterBotName?: string;
    characterDescription?: string;
    traits: TraitScore[];
    studyAllocation: TimeAllocation[];
    strengths: string[];
    weaknesses: string[];
    recommendedMethod: string;
    dailyRoutineAdvice: string;
    personalityInsight: string;
    tools: string[];
}
