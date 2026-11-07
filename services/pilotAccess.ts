/**
 * Phase 9 (D1): the server's pilot list refused this browser's session (403 with error_type
 * pilot_only, server/middleware/pilotGate.js). apiFetch (services/apiClient.ts) reports every such
 * answer with the user id of the token it sent; App.tsx then shows the full-page notice
 * (components/common/PilotOnlyView.tsx) instead of the app while that user is signed in. A
 * different account signing in on this page is not covered by the refusal (another id). Nothing is
 * stored: a reload asks the server again, and signing out forgets the refusal (forgetPilotRefusal).
 */

export const PILOT_ONLY = 'pilot_only';

let refusedUserId: string | null = null;
const listeners = new Set<() => void>();

/** The user id (the token's `sub`) the server refused, or null. */
export const pilotRefusedUserId = (): string | null => refusedUserId;

/** For useSyncExternalStore. */
export function subscribePilotRefusal(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The server refused `userId` with pilot_only. */
export function reportPilotOnly(userId: string): void {
    if (!userId || refusedUserId === userId) return;
    refusedUserId = userId;
    for (const listener of [...listeners]) listener();
}

/**
 * Forget the refusal: App.tsx calls it once nobody (or only a guest) is signed in, so a later sign-in
 * on this page (the owner may have added the account to the list meanwhile) asks the server again
 * instead of showing the notice from the old answer.
 */
export function forgetPilotRefusal(): void {
    if (refusedUserId === null) return;
    refusedUserId = null;
    for (const listener of [...listeners]) listener();
}

/** Tests only: forget the refusal. */
export function resetPilotRefusalForTests(): void {
    refusedUserId = null;
    for (const listener of [...listeners]) listener();
}

/**
 * The `sub` of a Supabase access token sent as `Bearer <jwt>` (no signature check: only which
 * signed-in account the server answered for), or null.
 */
export function bearerSubject(authorization: string | undefined | null): string | null {
    if (typeof authorization !== 'string' || !/^bearer /i.test(authorization)) return null;
    const payload = authorization.slice(7).trim().split('.')[1];
    if (!payload) return null;
    try {
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { sub?: unknown };
        return typeof json?.sub === 'string' && json.sub ? json.sub : null;
    } catch {
        return null;
    }
}

/**
 * Reads a 403's error_type from a copy of the body; pilot_only → reportPilotOnly(the token's sub).
 * Callers get the response unchanged.
 */
export async function notePilotOnly(res: Response, authorization: string | undefined): Promise<void> {
    if (res.status !== 403) return;
    try {
        const body = await res.clone().json();
        if (body && typeof body === 'object' && (body as { error_type?: unknown }).error_type === PILOT_ONLY) {
            const userId = bearerSubject(authorization);
            if (userId) reportPilotOnly(userId);
        }
    } catch {
        // Not JSON (a proxy page): not the server's pilot list.
    }
}
