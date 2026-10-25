import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSupabaseClient, getNexloomSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';
import {
    allowGuestLogin,
    allowMockLogin,
    isStoredAuthUserAllowed,
} from '../services/authPolicy';
import { apiPut, setAuthProvider } from '../services/apiClient';
import { deriveDisplayName, normalizeAuthEmail } from '../services/authFormValidation.ts';
import { hydrateFromApi } from '../services/progressService';
import { hydrateNotifications } from '../services/notificationService';
import { clearUserProfileCache } from '../services/userProfileService';
import { clearSharedDeviceAiData } from '../services/sharedDeviceData';
import { forgetDeletedAccountOnDevice, signOutThisBrowser } from '../services/accountDeviceData';
import { ACCOUNT_DELETED_EVENT, ACCOUNT_DELETED_PATH, accountDeletedUrl, markDeletionInFlight, type DeletedBy } from '../services/accountDeletionState';
import { forgetSignupAcceptance, rememberSignupAcceptance, signUpMadeNoAccount } from '../services/legalConsentApi';
import { features } from '../config/features';
import {
    forgetProgressAccount,
    progressChoicePending,
    signInProgressSync,
    signOutProgressSync,
    stopProgressSync,
    whenAccountKnown,
} from '../components/lesson/progressSyncClient';

export type SignUpResult =
    | { status: 'session_ready' }
    | { status: 'email_confirmation_required'; email: string };

export type SignUpOptions = {
    displayName?: string;
    /** Phase 4: the sign-up form's terms checkbox was ticked (only with VITE_FEATURE_LEGAL_PAGES=true). */
    legalAccepted?: boolean;
};

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    avatar: string;
    isGuest: boolean;
}

interface AuthContextType {
    user: AuthUser | null;
    isLoggedIn: boolean;
    isLoading: boolean;
    login: (email: string, password: string, options?: { useNexloomAuth?: boolean }) => Promise<void>;
    loginAsGuest: () => void;
    signUp: (email: string, password: string, options?: SignUpOptions) => Promise<SignUpResult>;
    logout: () => Promise<void>;
    updateProfile: (updates: Partial<Pick<AuthUser, 'name' | 'avatar'>>) => void;
    /** Phase 4: this account's Rise Path data is gone (here: by 'self'; elsewhere: 'other'). Never resolves into the app again. */
    endDeletedAccountSession: (outcome: { by: DeletedBy; at?: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const GUEST_USER: AuthUser = {
    id: 'guest',
    email: 'guest@risepath.system',
    name: 'Guest Explorer',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
    isGuest: true,
};

// Hydrate user data from backend after login. While the lesson progress adoption choice is open,
// the device's legacy progress may be someone else's: hydrateFromApi would upload it into this
// account, so it waits for the choice (chooseProgressAdoption runs it). It also waits for this page
// load's lesson-progress GET (Phase 4, design §5.10): on a re-opened account that GET's epoch rule
// clears the deleted account's legacy progress first; when the GET failed, nothing local is pushed.
const hydrateUserData = async () => {
    try {
        await Promise.all([progressChoicePending() ? Promise.resolve() : whenAccountKnown().then((s) => hydrateFromApi({ pushLocal: s === 'known' })), hydrateNotifications()]);
    } catch (e) {
        console.warn('[Auth] Hydration partial failure:', e);
    }
};

/**
 * What a deleted account leaves on this page and in this browser (design §5.11 steps 2–3): lesson
 * progress (forgotten, no upload), the account's local keys and AI data (P-School and device
 * preferences stay), the profile cache, the api identity. endDeletedAccountSession runs it before
 * the sign-outs and again after them: meanwhile a token refresh inside signOut (TOKEN_REFRESHED →
 * handleSession) writes rp_auth_user back and restarts the progress sync, and a lesson page may
 * still write its records. Idempotent.
 */
const forgetDeletedAccountHere = () => {
    forgetProgressAccount();
    forgetDeletedAccountOnDevice();
    clearUserProfileCache();
    setAuthProvider(() => null);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Keep API client's auth provider in sync
    useEffect(() => {
        setAuthProvider(() => user?.id || null);
    }, [user]);

    // On mount: check for existing session
    useEffect(() => {
        const supabase = getSupabaseClient();
        const nexloomSupabase = getNexloomSupabaseClient();

        if (!supabase && !nexloomSupabase) {
            // No Supabase — check localStorage for guest/mock session
            const stored = localStorage.getItem('rp_auth_user');
            if (stored) {
                try {
                    const parsed = JSON.parse(stored) as AuthUser;
                    if (isStoredAuthUserAllowed(parsed)) {
                        setUser(parsed);
                        setAuthProvider(() => parsed.id);
                        hydrateUserData();
                    } else {
                        localStorage.removeItem('rp_auth_user');
                    }
                } catch { /* ignore */ }
            }
            setIsLoading(false);
            return;
        }

        // `client`: which Supabase project the session belongs to. Only the primary one is the
        // identity apiFetch sends, so only it syncs lesson progress (Nexloom-only sessions do not).
        const handleSession = (session: any, client: 'primary' | 'nexloom') => {
            if (session?.user) {
                // Lesson progress owner rule (Phase 2, ai-access-plan §6): synchronous, before this
                // learner is shown, so another learner's progress on a shared device never appears
                // under their name. Repeated events (INITIAL_SESSION, TOKEN_REFRESHED, SIGNED_IN on
                // refocus) do not hydrate again unless the last try failed; they keep the access
                // token current for the page-hide upload.
                if (client === 'primary' && session.access_token) signInProgressSync(session.user.id, session.access_token);
                const u: AuthUser = {
                    id: session.user.id,
                    email: session.user.email || '',
                    name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Learner',
                    avatar: session.user.user_metadata?.avatar_url || '',
                    isGuest: false,
                };
                setUser(u);
                localStorage.setItem('rp_auth_user', JSON.stringify(u));
                setAuthProvider(() => u.id);
                hydrateUserData();
            }
        };

        // Get initial sessions
        if (supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (session?.user) handleSession(session, 'primary');
                if (!nexloomSupabase) setIsLoading(false);
            });
        }
        if (nexloomSupabase) {
            nexloomSupabase.auth.getSession().then(({ data: { session } }) => {
                if (session?.user) handleSession(session, 'nexloom');
                setIsLoading(false);
            });
        } else if (supabase) {
            setIsLoading(false);
        }

        // Listen for auth changes
        let sub1: any;
        let sub2: any;

        if (supabase) {
            const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
                if (session?.user) {
                    handleSession(session, 'primary');
                } else if (!_event.startsWith('SIGNED_IN') && !session) {
                    // The primary session ended (here or in another tab): stop syncing. Logout
                    // already cleared this learner's lesson data; an expiry keeps it for their
                    // next sign-in (what someone else writes meanwhile is asked about first).
                    stopProgressSync();
                    if (nexloomSupabase) {
                        nexloomSupabase.auth.getSession().then(({ data: { session: ns } }) => {
                            if (!ns) setUser(null);
                        });
                    } else {
                        setUser(null);
                    }
                }
            });
            sub1 = subscription;
        }

        if (nexloomSupabase) {
            const { data: { subscription } } = nexloomSupabase.auth.onAuthStateChange((_event, session) => {
                if (session?.user) {
                    handleSession(session, 'nexloom');
                } else if (!_event.startsWith('SIGNED_IN') && !session) {
                    if (supabase) {
                        supabase.auth.getSession().then(({ data: { session: s } }) => {
                            if (!s) setUser(null);
                        });
                    } else {
                        setUser(null);
                    }
                }
            });
            sub2 = subscription;
        }

        return () => {
            if (sub1) sub1.unsubscribe();
            if (sub2) sub2.unsubscribe();
        };
    }, []);

    const login = useCallback(async (email: string, password: string, options?: { useNexloomAuth?: boolean }) => {
        const supabase = options?.useNexloomAuth
            ? (getNexloomSupabaseClient() || getSupabaseClient())
            : getSupabaseClient();

        if (supabase) {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw new Error(error.message);
            // onAuthStateChange will update user + hydrate
        } else if (allowMockLogin()) {
            await new Promise(resolve => setTimeout(resolve, 800));
            const mockUser: AuthUser = {
                id: 'mock_' + Date.now(),
                email,
                name: email.split('@')[0] || 'Demo User',
                avatar: '',
                isGuest: false,
            };
            setUser(mockUser);
            localStorage.setItem('rp_auth_user', JSON.stringify(mockUser));
            setAuthProvider(() => mockUser.id);
            await hydrateUserData();
        } else {
            throw new Error('Supabase authentication is required. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
        }
    }, []);

    const signUp = useCallback(async (
        email: string,
        password: string,
        options?: SignUpOptions,
    ): Promise<SignUpResult> => {
        const normalizedEmail = normalizeAuthEmail(email);
        const displayName = deriveDisplayName(normalizedEmail, options?.displayName);
        const supabase = getSupabaseClient();

        if (supabase) {
            // Phase 4 (design §4.2): the first session of this email on this device records the acceptance.
            if (features.legalPages && options?.legalAccepted === true) await rememberSignupAcceptance(normalizedEmail);
            const { data, error } = await supabase.auth.signUp({
                email: normalizedEmail,
                password,
                options: {
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                    data: {
                        name: displayName,
                        full_name: displayName,
                    },
                },
            });
            if (error) throw new Error(error.message);

            if (data.session) {
                // Not awaited: the legacy hydrate waits for this page load's lesson-progress GET and
                // its bounded retries (whenAccountKnown), which must not hold the sign-up screen.
                // handleSession (SIGNED_IN) has started the same hydrate already.
                void hydrateUserData();
                try {
                    await apiPut('/user/profile', { display_name: displayName });
                    clearUserProfileCache();
                } catch (e) {
                    console.warn('[Auth] Profile sync after sign-up failed:', e);
                }
                return { status: 'session_ready' };
            }

            // An address that is already registered gets the same answer as a new one (Supabase hides
            // which addresses exist), but no account was made: the marker must not answer for the
            // owner's later sign-in on this device.
            if (signUpMadeNoAccount(data.user)) forgetSignupAcceptance();
            return { status: 'email_confirmation_required', email: normalizedEmail };
        }

        if (allowMockLogin()) {
            await login(normalizedEmail, password);
            return { status: 'session_ready' };
        }

        throw new Error('Supabase authentication is required for sign-up.');
    }, [login]);

    const loginAsGuest = useCallback(() => {
        if (!allowGuestLogin()) {
            throw new Error('Guest access is disabled when Supabase auth is active.');
        }
        setUser(GUEST_USER);
        localStorage.setItem('rp_auth_user', JSON.stringify(GUEST_USER));
        setAuthProvider(() => GUEST_USER.id);
        hydrateUserData();
    }, []);

    const updateProfile = useCallback((updates: Partial<Pick<AuthUser, 'name' | 'avatar'>>) => {
        setUser(prev => {
            if (!prev) return prev;
            const updated = { ...prev, ...updates };
            localStorage.setItem('rp_auth_user', JSON.stringify(updated));
            return updated;
        });
        // Sync to API
        import('../services/apiClient').then(({ apiPut, isApiAvailable }) => {
            if (isApiAvailable()) {
                apiPut('/user/profile', {
                    display_name: updates.name,
                    avatar_url: updates.avatar,
                })
                    .then(() => clearUserProfileCache())
                    .catch(() => {});
            }
        });
    }, []);

    /**
     * Phase 4 (design §5.11): the account's Rise Path data was deleted, here (by 'self', with the
     * deletion time when known) or on another device or by staff ('other'). Not the logout below: its
     * progress upload would only get 401, and its sign-out is global (Nexloom's sessions too).
     * 1. hold the "deleted elsewhere" signal for good; 2–3. forget lesson progress (no upload) and
     * clear what the account left in this browser; 4. sign this browser out of both clients, scope
     * 'local' only, at most 5 s, and remove a stored session auth-js kept; 2–3 again, for what
     * was written meanwhile; 5. a full load of the deleted page, the outcome in its URL (not in
     * storage).
     */
    const endDeletedAccountSession = useCallback(async ({ by, at = null }: { by: DeletedBy; at?: string | null }) => {
        markDeletionInFlight();
        forgetDeletedAccountHere();
        await signOutThisBrowser([getSupabaseClient(), getNexloomSupabaseClient()]);
        forgetDeletedAccountHere();
        // Already on the deleted page (a sign-in there within the 30 s margin, or a session that
        // outlived the sign-out, answered 401 again): stay, so the page never reloads itself in a loop.
        const path = window.location.pathname.replace(/\/+$/, '');
        if (path.endsWith(ACCOUNT_DELETED_PATH)) return;
        window.location.replace(accountDeletedUrl(import.meta.env.BASE_URL || '/', by, at));
    }, []);

    // The server answered 401 account_deleted to a request of this tab (services/apiClient.ts),
    // outside a deletion made here: the account was deleted on another device or by staff.
    useEffect(() => {
        const onDeleted = () => {
            void endDeletedAccountSession({ by: 'other' });
        };
        window.addEventListener(ACCOUNT_DELETED_EVENT, onDeleted);
        return () => window.removeEventListener(ACCOUNT_DELETED_EVENT, onDeleted);
    }, [endDeletedAccountSession]);

    const logout = useCallback(async () => {
        // First, so a failed remote sign-out still leaves no AI answers on a shared device.
        clearSharedDeviceAiData({ keepDrafts: user?.isGuest === true });
        // Lesson progress (Phase 2): upload what is still pending (at most 3 s, while the token is
        // valid; a stalled sync loads and uploads once more), then clear this learner's lesson
        // records, rp:lastLesson, learning events and legacy course progress. Records still
        // pending stay for this learner's next sign-in; another learner's clears them.
        await signOutProgressSync();
        const supabase = getSupabaseClient();
        const nexloomSupabase = getNexloomSupabaseClient();
        await Promise.all([
            supabase ? supabase.auth.signOut() : Promise.resolve(),
            nexloomSupabase ? nexloomSupabase.auth.signOut() : Promise.resolve(),
        ]);
        setUser(null);
        localStorage.removeItem('rp_auth_user');
        clearUserProfileCache();
        setAuthProvider(() => null);
    }, [user?.isGuest]);

    return (
        <AuthContext.Provider value={{
            user,
            isLoggedIn: user !== null,
            isLoading,
            login,
            loginAsGuest,
            signUp,
            logout,
            updateProfile,
            endDeletedAccountSession,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
