import { isStrictAuthMode } from './middleware/authPolicy.js';

/**
 * The error text a failed request may show (PLAN §6.4): included while developing, left out in
 * production, where it can carry SQL, file paths, internal addresses or a provider's message. Log
 * the text where the error is handled. Spread it into the response body:
 *   res.status(500).json({ error: 'Failed to load curricula', ...errorDetail(error) });
 * Strict auth mode (NODE_ENV=production, RISEPATH_STRICT_AUTH=true or VITE_DEMO_MODE=false) counts as
 * production, so a deployment started without NODE_ENV still keeps the text to itself.
 * @param {unknown} errOrText an Error, or what an upstream service sent (text or an object)
 * @returns {{ detail?: string }}
 */
export function errorDetail(errOrText) {
    if (isStrictAuthMode() || errOrText == null) return {};
    let text;
    if (typeof errOrText === 'string') text = errOrText;
    else if (errOrText instanceof Error) text = errOrText.message;
    else {
        try {
            text = JSON.stringify(errOrText);
        } catch {
            text = String(errOrText);
        }
    }
    return text ? { detail: text } : {};
}
