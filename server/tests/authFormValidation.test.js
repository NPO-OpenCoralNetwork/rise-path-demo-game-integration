import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    deriveDisplayName,
    mapSignupErrorMessage,
    normalizeAuthEmail,
    validateSignupForm,
} from '../../services/authFormValidation.ts';

describe('authFormValidation', () => {
    it('normalizes email', () => {
        assert.equal(normalizeAuthEmail('  User@Example.COM '), 'user@example.com');
    });

    it('derives display name from email when omitted', () => {
        assert.equal(deriveDisplayName('learner@risepath.system'), 'learner');
    });

    it('trims and caps display name', () => {
        const long = 'a'.repeat(50);
        assert.equal(deriveDisplayName('x@y.z', `  ${long}  `).length, 40);
    });

    it('rejects invalid signup form', () => {
        const result = validateSignupForm({
            email: 'not-an-email',
            password: 'short',
            passwordConfirm: 'other',
        });
        assert.ok(result);
        assert.equal(result.field, 'email');
    });

    it('rejects password mismatch', () => {
        const result = validateSignupForm({
            email: 'user@example.com',
            password: 'password123',
            passwordConfirm: 'password999',
        });
        assert.ok(result);
        assert.equal(result.field, 'passwordConfirm');
    });

    it('accepts valid signup form', () => {
        const result = validateSignupForm({
            email: 'user@example.com',
            password: 'password123',
            passwordConfirm: 'password123',
            displayName: 'Learner',
        });
        assert.equal(result, null);
    });

    it('maps already registered errors', () => {
        assert.equal(
            mapSignupErrorMessage('User already registered'),
            'already_registered',
        );
    });
});