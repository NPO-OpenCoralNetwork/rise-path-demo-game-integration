/**
 * Service-to-service bridge token (RISE_PATH_BRIDGE_TOKEN), shared by the Express guards.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');
const digest = (value) => createHash('sha256').update(value).digest();

/**
 * Whether `value` is the configured bridge token. Compared in constant time over SHA-256 digests,
 * so neither the content nor the length of the token leaks through timing. Never matches when no
 * token is configured.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBridgeToken(value) {
    const expected = cleanString(process.env.RISE_PATH_BRIDGE_TOKEN);
    const provided = cleanString(value);
    if (!expected || !provided) return false;
    return timingSafeEqual(digest(provided), digest(expected));
}
