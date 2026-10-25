import React from 'react';
// The generated public text (scripts/legal/build-legal-text.mjs). Only this module and PrivacyPage
// import content/legal/, and only through the conditional import in components/routes/lazyRoutes.tsx,
// so a production build without VITE_FEATURE_LEGAL_PAGES=true carries none of it.
import termsText from '../../../content/legal/terms.ja.md?raw';
import LegalDocument from './LegalDocument';

/** /terms — 利用規約 (Phase 4, design §2.3). */
const TermsPage: React.FC = () => <LegalDocument document="terms" text={termsText} />;

export default TermsPage;
