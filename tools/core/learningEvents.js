// @ts-check
/**
 * The learning history's input rule (POST /api/v2/user/events, server/routes/user.js; table
 * learning_events, server/migrations/002_user_app_tables.sql). Phase 5: the history is only a
 * history (ProfileHistoryView). It earns no XP and adds no learning day: XP and the streak come from
 * the server's own records (tools/core/achievements.js), never from an event a browser sends.
 *
 * Lenient on purpose, so tabs of an older bundle keep working: only `type` is required and must be
 * one of the table's six types; `title` and `description` keep their string `en` and `jp` (each cut
 * to LEARNING_EVENT_TEXT_MAX characters) and drop everything else; anything that is not an object
 * becomes {}. Other fields of the body (an id or a timestamp from the browser) are ignored.
 */

/** The types of the learning_events CHECK (002_user_app_tables.sql). */
export const LEARNING_EVENT_TYPES = Object.freeze([
    'lesson_start', 'lesson_complete', 'stage_complete',
    'course_complete', 'diagnosis_complete', 'course_generated',
]);

/** Longest kept `en` or `jp` text, in characters (code points). */
export const LEARNING_EVENT_TEXT_MAX = 300;

/**
 * @typedef {{ en?: string, jp?: string }} EventText
 * @typedef {{ type: string, title: EventText, description: EventText }} LearningEventInput
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Only the string `en` and `jp` of a text, each cut to LEARNING_EVENT_TEXT_MAX characters.
 * @param {unknown} value
 * @returns {EventText}
 */
function eventText(value) {
    /** @type {EventText} */
    const text = {};
    if (!isPlainObject(value)) return text;
    for (const locale of /** @type {const} */ (['en', 'jp'])) {
        const s = value[locale];
        if (typeof s === 'string') text[locale] = Array.from(s).slice(0, LEARNING_EVENT_TEXT_MAX).join('');
    }
    return text;
}

/**
 * @param {unknown} body the parsed JSON body
 * @returns {{ ok: true, event: LearningEventInput } | { ok: false, error: string }}
 */
export function parseLearningEventInput(body) {
    if (!isPlainObject(body)) return { ok: false, error: 'Send a JSON object { type, title, description }.' };
    const { type } = body;
    if (typeof type !== 'string' || !LEARNING_EVENT_TYPES.includes(type)) {
        return { ok: false, error: `type must be one of ${LEARNING_EVENT_TYPES.join(', ')}.` };
    }
    return { ok: true, event: { type, title: eventText(body.title), description: eventText(body.description) } };
}
