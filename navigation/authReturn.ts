// Where to land after sign-in. No imports, so node:test can check it.

/** A path inside this app (never a protocol-relative or backslash URL that leaves the origin). */
export const isInAppPath = (path: string): boolean =>
    path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');

/** Sign-in plumbing (/auth/callback, /auth/confirm-pending): never a page to come back to. */
const isAuthPath = (pathname: string): boolean => {
    const path = pathname.replace(/\/+$/, '') || '/';
    return path === '/auth' || path.startsWith('/auth/');
};

/**
 * The page to open after sign-in, saved when the visitor chooses to sign in. In order:
 * - the target the sign-in button asked for (the landing's "read chapter 1", /oauth/consent's own
 *   path);
 * - nothing while an AI app's connection request is waiting: postSignInPath returns to that
 *   request when nothing was saved;
 * - else the page the visitor was on, with its query and hash (a shared lesson link opened while
 *   signed out shows the landing at that URL). Not a sign-in plumbing page, and not a hash with
 *   "=": the reader's anchors are #s-… and #b-…, while an auth response can arrive as
 *   #access_token=….
 * null for the root, with or without a query or hash ("/?ref=…" is still the landing), or a path
 * outside the app.
 */
export const authReturnTarget = (
    returnTo: string | undefined,
    current: { pathname: string; search?: string; hash?: string },
    consentWaiting = false,
): string | null => {
    let target = returnTo;
    if (target === undefined) {
        if (consentWaiting || isAuthPath(current.pathname)) return null;
        const hash = current.hash && !current.hash.includes('=') ? current.hash : '';
        target = `${current.pathname}${current.search ?? ''}${hash}`;
    }
    if (!isInAppPath(target) || /^\/(?:[?#]|$)/.test(target)) return null;
    return target;
};

/**
 * Where to go after sign-in: the saved in-app path, else a pending AI-app connection request
 * (/oauth/consent), else the dashboard.
 * @param saved the path saved by openAuth (sessionStorage), if any
 * @param consentPath services/oauthConsentRules.ts pendingConsentReturnPath
 */
export const postSignInPath = (saved: string | null, consentPath: string | null): string =>
    saved && isInAppPath(saved) ? saved : consentPath ?? '/';
