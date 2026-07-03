// Resume Service
// Generates resume_card and recovery_mode data based on curriculum_progress.
// Spec: Section 17.3 — "多くのユーザーは始めるより戻るで詰まる"

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const daysBetween = (a, b) => {
    const ms = Math.abs(new Date(b) - new Date(a));
    return Math.floor(ms / (1000 * 60 * 60 * 24));
};

// --- Resume card builder ---

export const buildResumeCard = ({ progress, curriculum, now }) => {
    const currentTime = now || new Date();
    const progressRows = Array.isArray(progress) ? progress : [];

    if (progressRows.length === 0) {
        return {
            type: 'fresh_start',
            message: 'まだ始めていません。最初のレッスンから始めましょう。',
            next_lesson: resolveFirstLesson(curriculum),
            estimated_minutes: 10,
        };
    }

    // Find last activity
    const sorted = [...progressRows].sort((a, b) =>
        new Date(b.updated_at || b.doc_completed_at || 0) - new Date(a.updated_at || a.doc_completed_at || 0)
    );
    const lastActivity = sorted[0];
    const lastDate = lastActivity.updated_at || lastActivity.doc_completed_at || currentTime;
    const gapDays = daysBetween(lastDate, currentTime);

    // Count completed
    const completedCount = progressRows.filter((r) => r.status === 'done').length;
    const totalCount = progressRows.length;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Find next incomplete lesson
    const nextLesson = resolveNextLesson(progressRows, curriculum);

    // Determine resume type
    if (gapDays >= 7) {
        return {
            type: 'recovery',
            gap_days: gapDays,
            message: `${gapDays}日ぶりですね。復帰パックを用意しました。`,
            last_completed: {
                module_id: lastActivity.module_id,
                lesson_id: lastActivity.lesson_id,
                completed_at: lastDate,
            },
            recovery_plan: {
                review_lesson: lastActivity.lesson_id,
                next_lesson: nextLesson,
                reduced_load: true,
                estimated_minutes: 5,
                message: '前回の内容を軽く振り返ってから、次に進みましょう。',
            },
            completion_rate: completionRate,
        };
    }

    if (gapDays >= 3) {
        return {
            type: 'gentle_return',
            gap_days: gapDays,
            message: 'おかえりなさい。前回の続きから始めましょう。',
            last_completed: {
                module_id: lastActivity.module_id,
                lesson_id: lastActivity.lesson_id,
                completed_at: lastDate,
            },
            next_lesson: nextLesson,
            estimated_minutes: 10,
            completion_rate: completionRate,
        };
    }

    return {
        type: 'continue',
        gap_days: gapDays,
        message: '続きから始めましょう。',
        last_completed: {
            module_id: lastActivity.module_id,
            lesson_id: lastActivity.lesson_id,
            completed_at: lastDate,
        },
        next_lesson: nextLesson,
        estimated_minutes: 15,
        completion_rate: completionRate,
    };
};

// --- Helpers ---

const resolveFirstLesson = (curriculum) => {
    const content = asObject(curriculum);
    const modules = Array.isArray(content.modules) ? content.modules : [];
    if (modules.length === 0) return null;
    const firstModule = asObject(modules[0]);
    const lessons = Array.isArray(firstModule.lessons) ? firstModule.lessons : [];
    if (lessons.length === 0) return null;
    return {
        module_id: firstModule.module_id || 'm1',
        lesson_id: asObject(lessons[0]).lesson_id || 'm1-l1',
        title: asObject(lessons[0]).title || 'Lesson 1',
    };
};

const resolveNextLesson = (progressRows, curriculum) => {
    // Find the first lesson that is not 'done'
    const doneSet = new Set(
        progressRows.filter((r) => r.status === 'done').map((r) => `${r.module_id}:${r.lesson_id}`)
    );

    const content = asObject(curriculum);
    const modules = Array.isArray(content.modules) ? content.modules : [];

    for (const module of modules) {
        const m = asObject(module);
        const lessons = Array.isArray(m.lessons) ? m.lessons : [];
        for (const lesson of lessons) {
            const l = asObject(lesson);
            const key = `${m.module_id || ''}:${l.lesson_id || ''}`;
            if (!doneSet.has(key)) {
                return {
                    module_id: m.module_id,
                    lesson_id: l.lesson_id,
                    title: l.title || l.lesson_id,
                };
            }
        }
    }

    return null; // All done
};

// --- Weekly load adjuster ---

export const adjustWeeklyLoad = ({ progress, derivedLearningProfile, baseLoadMinutes }) => {
    const dp = asObject(derivedLearningProfile);
    const progressRows = Array.isArray(progress) ? progress : [];
    const base = Number(baseLoadMinutes) || 60;

    if (progressRows.length === 0) return { adjusted_minutes: base, adjustment: 'none', reason: 'no progress data' };

    // Calculate completion velocity
    const doneRows = progressRows.filter((r) => r.status === 'done');
    const inProgressRows = progressRows.filter((r) => r.status === 'in_progress');
    const totalRows = progressRows.length;
    const completionRate = totalRows > 0 ? doneRows.length / totalRows : 0;

    // Check for stalling
    const now = new Date();
    const recentDone = doneRows.filter((r) => {
        const d = new Date(r.doc_completed_at || r.updated_at || 0);
        return daysBetween(d, now) <= 7;
    });

    if (recentDone.length === 0 && inProgressRows.length > 0) {
        // Stalled: reduce load
        const reduced = Math.max(15, Math.round(base * 0.5));
        return {
            adjusted_minutes: reduced,
            adjustment: 'reduced',
            reason: 'no completions in the last 7 days',
            suggestion: '量を減らして、まず1つ完了を目指しましょう。',
        };
    }

    if (completionRate > 0.8 && recentDone.length >= 3) {
        // Ahead of pace: increase slightly
        const increased = Math.round(base * 1.2);
        return {
            adjusted_minutes: increased,
            adjustment: 'increased',
            reason: 'strong completion pace',
            suggestion: '順調です。発展課題に挑戦してみましょう。',
        };
    }

    // Reassurance need: cap the load
    if (dp.reassurance_need === 'high') {
        const capped = Math.min(base, 60);
        return {
            adjusted_minutes: capped,
            adjustment: capped < base ? 'capped' : 'none',
            reason: 'reassurance_need is high, keeping load manageable',
        };
    }

    return { adjusted_minutes: base, adjustment: 'none', reason: 'on track' };
};
