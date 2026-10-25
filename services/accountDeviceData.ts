/**
 * What a deleted account leaves in this browser, and what goes when its session ends here
 * (Phase 4, design §5.11 endDeletedAccountSession step 3; map §3.4). Lesson records, pending
 * markers, rp:progressSync:account, rp:lastLesson, learning events and legacy progress go through
 * ProgressSync.forget() (components/lesson/progressSync.ts); this module removes the rest:
 *
 *   - the AI data logout also clears (services/sharedDeviceData.ts), writing drafts included;
 *   - the stored user, notifications, the life journal's local store and its flags, the AI memory
 *     flag, the legal-consent markers (stage 6), a pending agent connection, the Blender bot's
 *     session id and the page to open after sign-in.
 *
 * Kept on purpose: preferences of the device (voice, reader settings, language, the Blender bot's
 * server address) and every P-School key (playerData, codeOfRuinsPlayerData, playerLevel,
 * currentStage, customBlocks): P-School is not part of a Rise Path deletion (owner decision D2).
 *
 * signOutThisBrowser is step 4: the local sign-outs, bounded in time, and the stored session
 * removed directly when auth-js kept it.
 *
 * Plain module (no React, no import.meta), so server/tests/accountDeletionFront.test.js runs it.
 * Every storage access is in try/catch: blocked storage never stops the sign-out that follows.
 */
import { clearSharedDeviceAiData } from './sharedDeviceData.ts';

export const DELETED_ACCOUNT_LOCAL_KEYS = [
  'rp_auth_user',
  'rp_notifications',
  'rp_life_journal_v1',
  'rp_life_journal_privacy_v1',
  'rp_life_journal_save_count',
  'rp_ai_memory_privacy_v1',
  'rp:legal:signupAcceptance',
  'rp:legal:noticeSeen',
  'rp:oauthPending',
  'teacherBotSessionId',
] as const;

export const DELETED_ACCOUNT_SESSION_KEYS = ['rp:returnTo'] as const;

type StorageLike = Pick<Storage, 'removeItem' | 'key' | 'length'>;
type RemovableStorage = Pick<Storage, 'removeItem'>;

const storageOrNull = (pick: () => StorageLike): StorageLike | null => {
  try {
    return pick();
  } catch {
    return null;
  }
};

function removeEach(storage: RemovableStorage | null, keys: readonly string[]): void {
  if (!storage) return;
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Blocked storage: nothing was kept there either.
    }
  }
}

export function forgetDeletedAccountOnDevice({
  local = storageOrNull(() => window.localStorage),
  session = storageOrNull(() => window.sessionStorage),
}: { local?: StorageLike | null; session?: StorageLike | null } = {}): void {
  try {
    clearSharedDeviceAiData({ keepDrafts: false, local, session });
  } catch {
    // Never stops the rest.
  }
  removeEach(local, DELETED_ACCOUNT_LOCAL_KEYS);
  removeEach(session, DELETED_ACCOUNT_SESSION_KEYS);
}

/** endDeletedAccountSession waits at most this long for the local sign-outs (design §5.11 step 4). */
export const SIGN_OUT_WAIT_MS = 5_000;

/** A Supabase client as far as the sign-out needs it (supabase-js's SupabaseClient fits). */
export type SignOutClient = { auth: { signOut(options: { scope: 'local' }): Promise<unknown> } };

/** auth-js's storage key of a client's session: a runtime field (protected in its types). */
function storedSessionKey(client: SignOutClient): string | null {
  try {
    const key = (client.auth as unknown as { storageKey?: unknown }).storageKey;
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

/**
 * Signs this browser out of each client with scope 'local' only (never other devices, never the
 * shared login's other sessions) and waits at most `waitMs`: a hanging request must not keep the
 * person on the page. auth-js keeps the stored session when the logout request fails (offline:
 * GoTrueClient _signOut returns the error before _removeSession), and a hanging one never gets
 * there, so the stored session is then removed directly (the keys _removeSession removes): on a
 * shared device nobody opens Rise Path later still signed in as the deleted account. Never throws.
 */
export async function signOutThisBrowser(
  clients: ReadonlyArray<SignOutClient | null | undefined>,
  {
    waitMs = SIGN_OUT_WAIT_MS,
    local = storageOrNull(() => window.localStorage),
  }: { waitMs?: number; local?: RemovableStorage | null } = {},
): Promise<void> {
  const present = clients.filter((client): client is SignOutClient => Boolean(client));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(present.map((client) => Promise.resolve().then(() => client.auth.signOut({ scope: 'local' })).catch(() => undefined))),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  clearTimeout(timer);
  for (const client of present) {
    const key = storedSessionKey(client);
    if (key) removeEach(local, [key, `${key}-code-verifier`, `${key}-user`]);
  }
}
