// @ts-check
/**
 * Zod schemas for /api/v2/llm request bodies and structured LLM outputs.
 *
 * Output schemas double as provider structured-output schemas (structured.js strips the
 * keywords providers reject); the bounds stripped there are still enforced here by zod.
 */
import * as z from 'zod/v4';

export const LOCALES = /** @type {const} */ (['ja', 'en', 'fr']);
export const Locale = z.enum(LOCALES);

/**
 * Accept the app's UI language codes too ('jp' is the app-wide code for Japanese).
 * @param {unknown} value
 */
const normalizeLocale = (value) => (value === 'jp' ? 'ja' : value);
const LocaleInput = z.preprocess(normalizeLocale, Locale);

const Score = z.number().int().min(0).max(100);
const TraitScore = z.number().min(0).max(100);
const ShortText = (max = 400) => z.string().trim().min(1).max(max);

// --- writing.feedback -------------------------------------------------------

export const WritingFeedbackRequest = z.object({
  text: z.string().trim().min(20).max(6000),
  rubric: z.object({
    clarity: z.string().max(500),
    linking: z.string().max(500),
    tone: z.string().max(500),
  }),
  lessonTitle: z.string().max(200).optional(),
  goal: z.string().max(500).optional(),
  locale: LocaleInput.default('en'),
});

export const WritingFeedback = z.object({
  clarityScore: Score.describe('0-100: how clear and specific the text is'),
  linkingScore: Score.describe('0-100: how well ideas are connected with linking words'),
  toneScore: Score.describe('0-100: how well the tone fits the rubric'),
  feedback: ShortText(1200).describe('2-4 sentences of specific, kind coaching feedback'),
  refinedVersion: ShortText(8000).describe("The learner's text rewritten to meet the rubric, same language as the original"),
});

// --- assessment.insight ------------------------------------------------------

export const PersonalityInsightRequest = z.object({
  scores: z.object({
    openness: TraitScore,
    conscientiousness: TraitScore,
    extraversion: TraitScore,
    agreeableness: TraitScore,
    neuroticism: TraitScore,
  }),
  locale: LocaleInput.default('ja'),
});

const TitledPoint = z.object({ title: ShortText(60), description: ShortText(200) });

export const PersonalityInsight = z.object({
  personalityType: ShortText(40).describe('A short, encouraging label for this learner'),
  strengths: z.array(TitledPoint).min(2).max(4),
  growthTips: z.array(TitledPoint).min(2).max(4),
  learningStrategy: z.object({
    title: ShortText(80),
    approach: ShortText(200),
    steps: z.array(z.object({ label: ShortText(40), action: ShortText(200) })).min(2).max(4),
  }),
  careerCompatibility: ShortText(300),
  relationshipAnalysis: z.object({ style: ShortText(300), idealPartner: ShortText(300), advice: ShortText(300) }),
  businessPartnership: z.object({ role: ShortText(300), bestSync: ShortText(300), warning: ShortText(300) }),
  hiddenTalent: TitledPoint,
});

// --- tutor.chat (PLAN §9.1 AskTutorDetail) -----------------------------------

export const TUTOR_EXCERPT_MAX = 1500;
export const TUTOR_MODES = /** @type {const} */ (['explain', 'socratic']);

/** Block types where the tutor must not give away the answer before two attempts (PLAN §5.7). */
export const ASSESSMENT_BLOCK_TYPES = new Set(['quiz', 'exercise', 'sandbox', 'check', 'reflection']);

export const TutorRequest = z.object({
  message: z.string().trim().min(1).max(2000),
  mode: z.enum(TUTOR_MODES).optional(),
  lesson: z.object({
    courseId: z.string().max(200),
    lessonId: z.string().max(200),
    title: z.string().max(300),
    objectives: z.array(z.string().max(500)).max(12),
    level: z.string().max(40).optional(),
  }).optional(),
  anchor: z.object({
    sectionId: z.string().max(200),
    blockId: z.string().max(200),
    blockType: z.string().max(60),
    excerpt: z.string().max(TUTOR_EXCERPT_MAX),
    codeLang: z.string().max(40).optional(),
    highlightedLines: z.array(z.number().int().min(1).max(100000)).max(200).optional(),
  }).optional(),
  learner: z.object({
    attemptsOnBlock: z.number().int().min(0).max(1000).optional(),
    chosenOptionId: z.string().max(200).optional(),
    // The quiz question the state describes ("why?" button); absent for the whole block.
    questionId: z.string().max(200).optional(),
    // The answer is on screen (correct pick, second miss or "show answer"); for a whole block,
    // every question's. The client sends it so a reveal needs no fake attempt count.
    answerShown: z.boolean().optional(),
  }).optional(),
  // Optional extras outside the §9.1 contract.
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(12).optional(),
  context: z.string().max(TUTOR_EXCERPT_MAX).optional(), // legacy { message, context } from GlossaryText
  locale: LocaleInput.optional(),
});

/**
 * Socratic when asked for, and always on assessment blocks until the learner has tried twice or
 * the answer is already on screen, so the tutor never gives away a quiz answer early.
 * @param {z.infer<typeof TutorRequest>} body
 * @returns {'explain'|'socratic'}
 */
export function resolveTutorMode(body) {
  if (body.mode === 'socratic') return 'socratic';
  const blockType = body.anchor?.blockType?.toLowerCase();
  const attempts = body.learner?.attemptsOnBlock ?? 0;
  if (blockType && ASSESSMENT_BLOCK_TYPES.has(blockType) && attempts < 2 && !body.learner?.answerShown) return 'socratic';
  return 'explain';
}

/**
 * zod issues → short "path: message" lines (for 400 responses and repair prompts).
 * @param {z.ZodError} error
 * @param {number} [limit]
 */
export function formatIssues(error, limit = 12) {
  return error.issues
    .slice(0, limit)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`);
}
