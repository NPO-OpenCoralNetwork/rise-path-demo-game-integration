/**
 * Learner AI memory privacy — Phase 19 opt-in (user_profiles.preferences).
 */

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function extractAiMemoryPreferences(preferences) {
    const aiMemory = asObject(asObject(preferences).privacy).ai_memory;
    return {
        enabled: asObject(aiMemory).enabled === true,
        allow_conversation_capture: asObject(aiMemory).allow_conversation_capture === true,
    };
}

export async function loadAiMemoryPreferences(pool, userId) {
    if (!pool || !userId) {
        return { enabled: false, allow_conversation_capture: false };
    }

    try {
        const result = await pool.query(
            'SELECT preferences FROM user_profiles WHERE user_id = $1',
            [userId],
        );
        if (!result.rowCount) {
            return { enabled: false, allow_conversation_capture: false };
        }
        return extractAiMemoryPreferences(result.rows[0].preferences);
    } catch {
        return { enabled: false, allow_conversation_capture: false };
    }
}

export async function isAiMemoryEnabled(pool, userId) {
    const prefs = await loadAiMemoryPreferences(pool, userId);
    return prefs.enabled === true;
}