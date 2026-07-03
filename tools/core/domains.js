/**
 * Shared Domain Definitions
 *
 * Single source of truth for learning domains.
 * Used by MCP Server (content://domains resource) and learnerState (mastery calculation).
 */

export const DOMAINS = [
    { id: 'vibe-coding', name: 'Vibe Coding', description: '物語駆動型コーディング', maxStages: 12 },
    { id: 'blender-3d', name: 'Blender 3D', description: '3Dモデリング', maxStages: 5 },
    { id: 'art-atelier', name: 'Art Atelier', description: '美術史・工芸', maxStages: 15 },
    { id: 'programming-web', name: 'Web Dev', description: 'HTML/CSS/WebInspector', maxStages: 8 },
    { id: 'programming-ai', name: 'AI & Python', description: 'Python/GenAI', maxStages: 10 },
    { id: 'sonic-lab', name: 'Sonic Lab', description: 'サウンド/シンセサイザー', maxStages: 6 },
    { id: 'p-school', name: 'P-School', description: 'ブロックプログラミング', maxStages: 8 },
];

/** Lookup map: domain id → max stages */
export const DOMAIN_MAX_STAGES = Object.fromEntries(
    DOMAINS.map(d => [d.id, d.maxStages])
);

export const DEFAULT_MAX_STAGES = 5;

/**
 * Calculate mastery as a 0-1 ratio based on domain-specific stage count.
 */
export function calculateMastery(completedCount, domain) {
    const max = DOMAIN_MAX_STAGES[domain] || DEFAULT_MAX_STAGES;
    return Math.min(Math.round((completedCount / max) * 100) / 100, 1.0);
}
