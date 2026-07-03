import { apiGet, isApiAvailable } from './apiClient';

export type UserProfile = {
    display_name: string;
    avatar_url: string;
    role: string;
    created_at: string | null;
    preferences: Record<string, unknown>;
};

type ProfileResponse = {
    ok: boolean;
    profile?: UserProfile;
};

let cachedUserId: string | null = null;
let cachedProfile: UserProfile | null = null;
let inflight: Promise<UserProfile | null> | null = null;
let inflightUserId: string | null = null;

export function clearUserProfileCache(): void {
    cachedUserId = null;
    cachedProfile = null;
    inflight = null;
    inflightUserId = null;
}

export async function loadUserProfile(userId?: string | null): Promise<UserProfile | null> {
    if (!isApiAvailable()) return null;

    const requestUserId = userId ?? null;

    if (requestUserId && cachedUserId === requestUserId && cachedProfile) {
        return cachedProfile;
    }

    if (inflight && inflightUserId === requestUserId) {
        return inflight;
    }

    inflightUserId = requestUserId;
    inflight = apiGet<ProfileResponse>('/user/profile')
        .then((res) => {
            const profile = res.profile ?? null;
            cachedProfile = profile;
            cachedUserId = requestUserId;
            return profile;
        })
        .catch(() => null)
        .finally(() => {
            inflight = null;
            inflightUserId = null;
        });

    return inflight;
}