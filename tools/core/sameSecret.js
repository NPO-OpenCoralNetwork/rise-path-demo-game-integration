// @ts-check
import crypto from 'node:crypto';

const sha256 = (/** @type {string} */ value) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * Whether a secret a caller sent (the bridge token) equals the configured one, in constant time:
 * both are hashed to 32 bytes and compared with timingSafeEqual, so the time shows neither how much
 * of the value matched nor the configured length (timingSafeEqual alone needs equal lengths).
 * An empty or missing value never matches.
 * @param {unknown} provided
 * @param {unknown} expected
 * @returns {boolean}
 */
export function sameSecret(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
    return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}
