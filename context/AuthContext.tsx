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

export type SignUpResult =
    | { status: 'session_ready' }
    | { status: 'email_confirmation_required'; email: string };

export type SignUpOptions = {
    displayName?: string;
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
}

const AuthContext = createContext<AuthContextType | null>(null);

const GUEST_USER: AuthUser = {
    id: 'guest',
    email: 'guest@risepath.system',
    name: 'Guest Explorer',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
    isGuest: true,
};

// Hydrate user data from backend after login
const hydrateUserData = async () => {
    try {
        await Promise.all([hydrateFromApi(), hydrateNotifications()]);
    } catch (e) {
        console.warn('[Auth] Hydration partial failure:', e);
    }
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

        const handleSession = (session: any) => {
            if (session?.user) {
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
                if (session?.user) handleSession(session);
                if (!nexloomSupabase) setIsLoading(false);
            });
        }
        if (nexloomSupabase) {
            nexloomSupabase.auth.getSession().then(({ data: { session } }) => {
                if (session?.user) handleSession(session);
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
                    handleSession(session);
                } else if (!_event.startsWith('SIGNED_IN') && !session) {
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
                    handleSession(session);
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
                await hydrateUserData();
                try {
                    await apiPut('/user/profile', { display_name: displayName });
                    clearUserProfileCache();
                } catch (e) {
                    console.warn('[Auth] Profile sync after sign-up failed:', e);
                }
                return { status: 'session_ready' };
            }

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

    const logout = useCallback(async () => {
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
    }, []);

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
