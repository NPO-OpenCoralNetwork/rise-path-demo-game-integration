// @ts-check
/**
 * An on/off switch read from the environment (ACCOUNT_DELETION_ENABLED in server/routes/account.js,
 * LEGAL_TERMS_REQUIRED in tools/core/legalAcceptance.js). Off is the default: only true/1/on/yes
 * (trimmed, any case) turn it on; unset, empty and false/0/off/no leave it off on purpose; any other
 * value ("ture", "enabled") leaves it off too and is reported as not recognised, so the caller can
 * warn once about it.
 */

/** The only values that turn a switch on (trimmed, any case). */
const SWITCH_ON = new Set(['true', '1', 'on', 'yes']);
/** Values that leave it off on purpose, as unset and empty do. */
const SWITCH_OFF = new Set(['', 'false', '0', 'off', 'no']);

/**
 * @param {string | undefined} raw
 * @returns {{ on: boolean, recognised: boolean }}
 */
export function readEnvSwitch(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (SWITCH_ON.has(value)) return { on: true, recognised: true };
    return { on: false, recognised: SWITCH_OFF.has(value) };
}
