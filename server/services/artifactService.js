// Artifact Service
// Generates learning artifacts from curriculum content:
// - Summary cards (要点カード): key points per lesson
// - Weekly digest (週次まとめ): progress + next actions
// Spec: Section 16.1 MVP 成果物

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const asArray = (v) => Array.isArray(v) ? v : [];
const cleanString = (v) => (typeof v === 'string' ? v.trim() : '');

// --- Summary Cards ---

export const buildSummaryCards = ({ curriculum }) => {
    const content = asObject(curriculum);
    const modules = asArray(content.modules);
    const cards = [];

    for (const module of modules) {
        const m = asObject(module);
        const lessons = asArray(m.lessons);

        for (const lesson of lessons) {
            const l = asObject(lesson);
            const sections = asArray(l.sections);

            // Extract key points from sections
            const keyPoints = [];
            const takeaway = [];
            for (const section of sections) {
                const s = asObject(section);
                const sectionId = cleanString(s.id).replace(/-\d+$/, '');
                const sectionContent = asArray(s.content);

                if (sectionId === 'key-points' || sectionId === 'key_points') {
                    for (const block of sectionContent) {
                        const b = asObject(block);
                        if (b.type === 'list') {
                            for (const item of asArray(b.items)) {
                                const text = extractText(item);
                                if (text) keyPoints.push(text);
                            }
                        }
                    }
                }
                if (sectionId === 'takeaway') {
                    for (const block of sectionContent) {
                        const b = asObject(block);
                        const text = extractText(b.text || b.title);
                        if (text) takeaway.push(text);
                    }
                }
            }

            const title = extractText(l.title) || l.lesson_id || 'Lesson';

            cards.push({
                lesson_id: l.lesson_id,
                module_id: m.module_id,
                title,
                key_points: keyPoints.slice(0, 5),
                takeaway: takeaway.join(' ') || null,
            });
        }
    }

    return cards;
};

// --- Weekly Digest ---

export const buildWeeklyDigest = ({ curriculum, progress, weekNumber }) => {
    const progressRows = Array.isArray(progress) ? progress : [];
    const content = asObject(curriculum);
    const modules = asArray(content.modules);
    const week = Number(weekNumber) || 1;

    // Count stats
    const doneSet = new Set(
        progressRows.filter((r) => r.status === 'done').map((r) => `${r.module_id}:${r.lesson_id}`)
    );
    const totalLessons = modules.reduce((sum, m) => sum + asArray(asObject(m).lessons).length, 0);
    const completedLessons = doneSet.size;

    // Find completed this week (approximate: last 7 days)
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisWeekDone = progressRows.filter((r) => {
        if (r.status !== 'done') return false;
        const d = new Date(r.doc_completed_at || r.updated_at || 0);
        return d >= weekAgo;
    });

    // Find next lessons
    const nextLessons = [];
    for (const module of modules) {
        const m = asObject(module);
        for (const lesson of asArray(m.lessons)) {
            const l = asObject(lesson);
            const key = `${m.module_id}:${l.lesson_id}`;
            if (!doneSet.has(key) && nextLessons.length < 3) {
                nextLessons.push({
                    module_id: m.module_id,
                    lesson_id: l.lesson_id,
                    title: extractText(l.title) || l.lesson_id,
                });
            }
        }
    }

    return {
        week_number: week,
        generated_at: now.toISOString(),
        stats: {
            total_lessons: totalLessons,
            completed_lessons: completedLessons,
            completion_rate: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
            completed_this_week: thisWeekDone.length,
        },
        completed_titles: thisWeekDone.map((r) => {
            // Try to resolve lesson title from curriculum
            for (const module of modules) {
                const m = asObject(module);
                for (const lesson of asArray(m.lessons)) {
                    const l = asObject(lesson);
                    if (l.lesson_id === r.lesson_id && m.module_id === r.module_id) {
                        return extractText(l.title) || l.lesson_id;
                    }
                }
            }
            return r.lesson_id;
        }),
        next_actions: nextLessons,
        message: thisWeekDone.length > 0
            ? `今週は${thisWeekDone.length}レッスン完了しました。`
            : '今週はまだレッスンを完了していません。1つだけでも進めてみましょう。',
    };
};

// --- Mini encyclopedia (ミニ図鑑) ---

export const buildMiniEncyclopedia = ({ curriculum }) => {
    const content = asObject(curriculum);
    const modules = asArray(content.modules);
    const entries = [];

    for (const module of modules) {
        const m = asObject(module);
        entries.push({
            module_id: m.module_id,
            module_title: extractText(m.title),
            lessons: asArray(m.lessons).map((lesson) => {
                const l = asObject(lesson);
                return {
                    lesson_id: l.lesson_id,
                    title: extractText(l.title),
                    subtitle: extractText(l.subtitle),
                    estimated_min: l.estimated_min || 15,
                };
            }),
        });
    }

    return {
        title: extractText(content.title) || 'Curriculum',
        description: extractText(content.description) || '',
        module_count: modules.length,
        total_lessons: entries.reduce((s, m) => s + m.lessons.length, 0),
        entries,
    };
};

// --- Helpers ---

const extractText = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    const record = asObject(value);
    return cleanString(record.jp) || cleanString(record.en) || '';
};
