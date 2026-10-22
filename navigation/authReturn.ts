// Where to land after sign-in. No imports, so node:test can check it.

/** sessionStorage key, so the target survives the OAuth redirect through /auth/callback. */
export const RETURN_TO_KEY = 'rp:returnTo';

/** A path inside this app (never a protocol-relative or backslash URL that leaves the origin). */
export const isInAppPath = (path: string): boolean =>
    path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');

/**
 * The given target, or else the page the visitor was on when they chose to sign in (a shared lesson
 * link opened while signed out shows the landing at that URL). null for the root, with or without a
 * query ("/?ref=…" is still the landing), or a path outside the app.
 */
export const authReturnTarget = (
    returnTo: string | undefined,
    current: { pathname: string; search?: string },
): string | null => {
    const target = returnTo ?? `${current.pathname}${current.search ?? ''}`;
    if (!isInAppPath(target) || /^\/(?:[?#]|$)/.test(target)) return null;
    return target;
};
