/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** "true" shows the shared Hermes chats (config/features.ts → features.agentChat). Default off. */
  readonly VITE_FEATURE_AGENT_CHAT?: string;
  /** "true" shows the supporter plan's entry points and pages (config/features.ts → features.billing). Default off. */
  readonly VITE_FEATURE_BILLING?: string;
  /** https URL or mailto: where deletion and other requests arrive (config/support.ts). Unset: "tell the staff". */
  readonly VITE_SUPPORT_CONTACT?: string;
}
