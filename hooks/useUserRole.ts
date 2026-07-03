import { useEffect, useState } from 'react';
import { isAdminRole } from '../constants/userRoles';
import { useAuth } from '../context/AuthContext';
import { clearUserProfileCache, loadUserProfile } from '../services/userProfileService';

export function useUserRole() {
    const { user } = useAuth();
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user || user.isGuest) {
            clearUserProfileCache();
            setRole(null);
            setLoading(false);
            return;
        }

        let active = true;
        setRole(null);
        setLoading(true);
        loadUserProfile(user.id)
            .then((profile) => {
                if (!active) return;
                setRole(profile?.role ?? 'learner');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [user?.id, user?.isGuest]);

    const isAdmin = !loading && isAdminRole(role);

    return {
        role,
        isAdmin,
        loading,
    };
}