// ViewState for the Programming and Vibe track paths, picked so the app shell matches each page's own
// background. Only a type import (erased at run time), so node:test can check it.
import type { ViewState } from '../types';

/** "/vibe/" and "/vibe" are the same route to React Router, so the view checks see one form. */
export const withoutTrailingSlash = (pathname: string): string =>
    pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;

/** The prefix itself or a path under it: "/vibe/prologue/x", but not "/vibe/prologuex". */
export const startsWithSegment = (pathname: string, prefix: string): boolean =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The Web track pages, which have a light background of their own. */
const LIGHT_PROGRAMMING_PAGES = new Set(['/programming', '/programming/web', '/programming/html-css', '/programming/html-css/course']);

/**
 * The view for a Programming or Vibe track path, or null for any other path.
 * - Light shell: the Web track pages, the Vibe course page and the old chapter URLs (they only
 *   redirect, to the lesson reader or back to the course page).
 * - Dark shell: the other Programming pages (AI and Python tracks, the course path, HTML/CSS part 2,
 *   the inspector) and the Vibe prologue.
 * @param path a pathname without a trailing slash (see withoutTrailingSlash)
 */
export const trackViewForPath = (path: string): `${ViewState}` | null => {
    if (LIGHT_PROGRAMMING_PAGES.has(path)) return 'programming_web';
    if (startsWithSegment(path, '/programming')) return 'PROGRAMMING';
    if (startsWithSegment(path, '/vibe/prologue')) return 'VIBE_PROLOGUE';
    if (startsWithSegment(path, '/vibe')) return 'VIBE_PATH';
    return null;
};
