/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** "true" shows the shared Hermes chats (config/features.ts → features.agentChat). Default off. */
  readonly VITE_FEATURE_AGENT_CHAT?: string;
}
