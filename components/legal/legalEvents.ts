/**
 * The window event the legal gate (components/legal/legalGateClient.ts) sends once per acceptance
 * this page recorded: "Agree and continue", or the sign-up marker's acceptance (Phase 8, S5). With
 * the server's terms check on (LEGAL_TERMS_REQUIRED), reads that raced the acceptance may have been
 * refused with terms_required; the achievements and review stores (components/ui/achievementsClient.ts)
 * read again on it, but only when their last read was refused that way. No imports.
 */
export const LEGAL_ACCEPTED_EVENT = 'rp:legal-accepted';
