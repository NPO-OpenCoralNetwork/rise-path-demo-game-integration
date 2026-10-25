import React from 'react';
// The generated public text (scripts/legal/build-legal-text.mjs). Only this module and TermsPage
// import content/legal/, and only through the conditional import in components/routes/lazyRoutes.tsx,
// so a production build without VITE_FEATURE_LEGAL_PAGES=true carries none of it.
import privacyText from '../../../content/legal/privacy.ja.md?raw';
import LegalDocument from './LegalDocument';

/** /privacy — プライバシーポリシー (Phase 4, design §2.3). */
const PrivacyPage: React.FC = () => <LegalDocument document="privacy" text={privacyText} />;

export default PrivacyPage;
