import { Message } from '../types';

// Placeholder for Adachi Backend Service
// In the future, this will connect to the actual backend endpoints.

export interface DiagnosisResult {
    personalityType: string;
    recommendedPath: string;
    traits: Record<string, number>;
}

export const adachiService = {
    // Mock Diagnosis Flow
    async submitDiagnosisAnswer(questionId: string, answer: any): Promise<Message> {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 800));

        return {
            id: Date.now().toString(),
            role: 'model',
            text: "Thank you. I've recorded that. Let's move to the next question...",
            timestamp: new Date()
        };
    },

    async getProfile(userId: string) {
        await new Promise(resolve => setTimeout(resolve, 500));
        return {
            id: userId,
            name: "Alex Smith",
            apiUsage: 45, // percent
            subscription: "Pro",
        };
    },

    async regenerateApiKey(userId: string) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return "sk-new-api-key-" + Date.now();
    },

    // Mock Login
    async login(email: string, pass: string) {
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate net delay
        if (email.includes('error')) {
            throw new Error("Invalid credentials");
        }
        return {
            user: {
                id: "u_123456",
                name: "Demo User",
                email: email,
                avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80"
            },
            token: "mock_jwt_token_" + Date.now()
        };
    }
};
