// Re-export canonical analysis from tools/core for Express + tests
export {
    isDayLogged,
    pearsonCorrelation,
    correlationStrength,
    correlationConfidence,
    computeCorrelations,
    buildAnalysisMetrics,
    detectPatterns,
    analyzeLifeJournal,
    computeCurrentStreak,
    CORRELATION_PAIRS,
} from '../../tools/core/lifeJournalAnalysis.js';