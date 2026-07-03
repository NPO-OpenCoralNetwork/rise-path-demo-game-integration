/**
 * Kokoro TTS script entrypoint.
 * Replaces scripts/gemini_tts_node.js (Issue #3).
 */
export { generateAudioContent, synthesize, requestTts } from '../tools/core/kokoroTts.js';