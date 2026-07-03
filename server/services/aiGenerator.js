/**
 * AI Generator Service — Phase 13-C
 * 
 * Kit → RAG → Gemini → Structured Output
 * Handles 3-stage curriculum generation:
 *   requirements → roadmap → curriculum
 */
import { GoogleGenAI } from '@google/genai';
import { retrieveContext } from '../ragService.js';
import {
  buildRequirementsPrompt,
  buildRoadmapPrompt,
  buildCurriculumPrompt,
} from './aiPrompts.js';

const MODEL = process.env.AI_GENERATE_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 45000;

// --- Kit Cache (5 min TTL, LRU max 100) ---
const kitCache = new Map();
const KIT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

export async function getCachedKit(userId, getKitFn) {
  const cached = kitCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.kit;
  
  // Evict oldest entry if cache is full
  if (kitCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = kitCache.keys().next().value;
    kitCache.delete(oldestKey);
  }

  const kit = await getKitFn({ userId });
  kitCache.set(userId, { kit, expiresAt: Date.now() + KIT_TTL_MS });
  return kit;
}

// --- Gemini Call ---
let _genAI = null;
function getGenAI() {
  if (_genAI) return _genAI;
  // Support both server-side and Vite-prefixed env vars
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  _genAI = new GoogleGenAI({ apiKey });
  return _genAI;
}

async function callGemini(systemPrompt, userMessage) {
  const genAI = getGenAI();

  const result = await genAI.models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: userMessage }] }
    ],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.7,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      timeout: TIMEOUT_MS,
    },
  });

  const text = result.text || '';
  let structuredData = null;
  try {
    structuredData = JSON.parse(text);
  } catch {
    // If JSON parse fails, try extracting JSON from markdown code block
    const match = text.match(/```json\s*([\s\S]*?)```/);
    if (match) {
      try { structuredData = JSON.parse(match[1]); } catch { /* keep null */ }
    }
  }

  return { text, structuredData };
}

// --- Stage Handlers ---

export async function generateRequirements(message, userId, kit) {
  // RAG: search for relevant educational content
  let ragContext = '';
  try {
    const chunks = await retrieveContext(message, 3, userId);
    if (chunks.length > 0) {
      ragContext = chunks.join('\n---\n');
    }
  } catch (e) {
    console.warn('[AI Generator] RAG retrieval failed, continuing without:', e.message);
  }

  const systemPrompt = buildRequirementsPrompt(kit, ragContext);
  const result = await callGemini(systemPrompt, message);

  if (!result.structuredData) {
    return {
      message: result.text,
      intake: null,
    };
  }

  return {
    message: result.structuredData.message || result.text,
    intake: result.structuredData.intake || null,
  };
}

export async function generateRoadmap(intake, userId, kit) {
  const systemPrompt = buildRoadmapPrompt(kit);
  const userMessage = `以下の学習要件に基づきロードマップを作成してください:\n\n${JSON.stringify(intake, null, 2)}`;
  const result = await callGemini(systemPrompt, userMessage);

  if (!result.structuredData) {
    return { message: result.text, modules: null };
  }

  return {
    message: result.structuredData.message || result.text,
    modules: result.structuredData.modules || null,
  };
}

export async function generateCurriculum(intake, modules, userId, kit) {
  const systemPrompt = buildCurriculumPrompt(kit);
  const userMessage = `以下の要件とロードマップに基づき、完全なカリキュラムを生成してください:\n\n## 要件\n${JSON.stringify(intake, null, 2)}\n\n## モジュール構成\n${JSON.stringify(modules, null, 2)}`;
  const result = await callGemini(systemPrompt, userMessage);

  if (!result.structuredData) {
    return { curriculum: null, rawText: result.text };
  }

  return {
    curriculum: result.structuredData.curriculum || result.structuredData,
  };
}
