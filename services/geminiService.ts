/**
 * @deprecated The browser no longer talks to Gemini (or any model) directly, and no model key
 * is bundled into the client. Import from `./llmApi` instead; this module only re-exports it
 * for older call sites.
 */
export { analyzePersonality, analyzeWriting } from './llmApi';
