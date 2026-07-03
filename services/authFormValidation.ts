export type SignupFormInput = {
    email: string;
    password: string;
    passwordConfirm: string;
    displayName?: string;
};

export type SignupFormError = {
    field: 'email' | 'password' | 'passwordConfirm' | 'displayName' | 'form';
    message: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAuthEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function deriveDisplayName(email: string, displayName?: string): string {
    const trimmed = displayName?.trim();
    if (trimmed) return trimmed.slice(0, 40);
    return (email.split('@')[0] || 'Learner').slice(0, 40);
}

export function validateSignupForm(input: SignupFormInput): SignupFormError | null {
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

    return null;
}

export function mapSignupErrorMessage(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('already registered') || lower.includes('already been registered')) {
        return 'already_registered';
    }
    return message;
}