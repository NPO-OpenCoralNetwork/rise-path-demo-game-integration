/**
 * Shared Domain Definitions
 *
 * Single source of truth for learning domains.
 * Used by MCP Server (content://domains resource) and learnerState (mastery calculation).
 *
 * A domain with `courseSlug` takes its stage count from content/courses/<slug>/course.json
 * (the number of lesson refs across its modules), read once at load. Its static `maxStages`
 * is only the fallback for a missing or unreadable course file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COURSES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'courses');

const DOMAIN_DEFS = [
    { id: 'vibe-coding', name: 'Vibe Coding', description: '物語駆動型コーディング', maxStages: 13, courseSlug: 'vibe-coding' },
    { id: 'claude-code', name: 'Claude Code', description: 'AIエージェントとの開発', maxStages: 11, courseSlug: 'claude-code' },
    { id: 'blender-3d', name: 'Blender 3D', description: '3Dモデリング', maxStages: 5 },
    { id: 'art-atelier', name: 'Art Atelier', description: '美術史・工芸', maxStages: 15 },
    { id: 'programming-web', name: 'Web Dev', description: 'HTML/CSS/WebInspector', maxStages: 8 },
    { id: 'programming-ai', name: 'AI & Python', description: 'Python/GenAI', maxStages: 10 },
    { id: 'sonic-lab', name: 'Sonic Lab', description: 'サウンド/シンセサイザー', maxStages: 6 },
    { id: 'p-school', name: 'P-School', description: 'ブロックプログラミング', maxStages: 8 },
];

/**
 * Number of distinct lesson ids in a course.json, or null when the file is missing,
 * unparseable or lists no lessons.
 */
export function countCourseLessons(courseFile) {
    let course;
    try {
        course = JSON.parse(fs.readFileSync(courseFile, 'utf8'));
    } catch {
        return null;
    }
    const ids = new Set();
    for (const module of Array.isArray(course?.modules) ? course.modules : []) {
        for (const ref of Array.isArray(module?.lessons) ? module.lessons : []) {
            if (typeof ref?.id === 'string' && ref.id) ids.add(ref.id);
        }
    }
    return ids.size || null;
}

export const DOMAINS = DOMAIN_DEFS.map(({ courseSlug, ...domain }) => {
    if (!courseSlug) return domain;
    const count = countCourseLessons(path.join(COURSES_DIR, courseSlug, 'course.json'));
    return { ...domain, maxStages: count ?? domain.maxStages };
});

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
