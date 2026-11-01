export type SignupFormInput = {
    email: string;
    password: string;
    passwordConfirm: string;
    displayName?: string;
    /** Phase 4: the sign-up checkbox 「利用規約に同意し、プライバシーポリシーを読みました」. */
    acceptedLegal?: boolean;
};

export type SignupFormError = {
    field: 'email' | 'password' | 'passwordConfirm' | 'displayName' | 'legal' | 'form';
    message: string;
};

export type SignupFormOptions = {
    /** features.legalPages: the checkbox must be ticked (off by default: today's form). */
    requireLegalAcceptance?: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phase 9 (D1): the app's sign-up is closed until VITE_FEATURE_LEGAL_PAGES=true (config/features.ts).
 * AuthContext.signUp throws this message before it calls Supabase; the login view maps it.
 */
export const SIGNUP_CLOSED = 'signup_closed';

export function normalizeAuthEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function deriveDisplayName(email: string, displayName?: string): string {
    const trimmed = displayName?.trim();
    if (trimmed) return trimmed.slice(0, 40);
    return (email.split('@')[0] || 'Learner').slice(0, 40);
}

export function validateSignupForm(
    input: SignupFormInput,
    { requireLegalAcceptance = false }: SignupFormOptions = {},
): SignupFormError | null {
    const email = normalizeAuthEmail(input.email);
    if (!email) {
        return { field: 'email', message: 'Email is required.' };
    }
    if (!EMAIL_PATTERN.test(email)) {
        return { field: 'email', message: 'Enter a valid email address.' };
    }

    if (!input.password) {
        return { field: 'password', message: 'Password is required.' };
    }
    if (input.password.length < 8) {
        return { field: 'password', message: 'Password must be at least 8 characters.' };
    }

    if (input.password !== input.passwordConfirm) {
        return { field: 'passwordConfirm', message: 'Passwords do not match.' };
    }

    const name = input.displayName?.trim();
    if (name && name.length > 40) {
        return { field: 'displayName', message: 'Display name must be 40 characters or fewer.' };
    }

    if (requireLegalAcceptance && input.acceptedLegal !== true) {
        return { field: 'legal', message: 'Agree to the terms of use to create an account.' };
    }

    return null;
}

export function mapSignupErrorMessage(message: string): string {
    if (message === SIGNUP_CLOSED) return SIGNUP_CLOSED;
    const lower = message.toLowerCase();
    if (lower.includes('already registered') || lower.includes('already been registered')) {
        return 'already_registered';
    }
    return message;
}