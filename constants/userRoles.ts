export const USER_ROLE_ADMIN = 'admin';
export const USER_ROLE_LEARNER = 'learner';

export function isAdminRole(role: string | null | undefined): boolean {
    return role === USER_ROLE_ADMIN;
}