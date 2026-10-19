// @ts-check
import { DATA_NOT_INSTRUCTIONS, fence, languageName } from './shared.js';

/** @typedef {import('./shared.js').PromptSpec} PromptSpec */

const STABLE = [
  'You write the learning-profile summary shown after the Rise Path self-assessment.',
  'Input: Big Five trait scores from a short questionnaire (0-100; neuroticism high means more sensitive to stress).',
  '',
  'Purpose and limits:',
  '- This is a self-reflection aid for study habits, not a psychological diagnosis. Do not use clinical language.',
  '- Use the scores to suggest pacing, routines and ways of working. Do not claim that a "learning style" determines how someone learns best.',
  '- Be specific and encouraging; every point should be something the learner can act on this week.',
  '',
  'Fields:',
  '- personalityType: a short, positive label (about 15 Japanese characters or 4 English words).',
  '- strengths and growthTips: 3 items each; title of a few words, description in one sentence.',
  '- learningStrategy: a named approach, one-sentence approach, and 3 concrete steps (label like "Step 1").',
  '- careerCompatibility, relationshipAnalysis, businessPartnership, hiddenTalent: one or two sentences each.',
  '',
  DATA_NOT_INSTRUCTIONS,
  'Reply with the JSON object only.',
].join('\n');

/**
 * @param {import('zod/v4').infer<typeof import('../schemas.js').PersonalityInsightRequest>} input
 * @returns {PromptSpec}
 */
export function buildPersonalityInsightPrompt(input) {
  const s = input.scores;
  const scores = [
    `openness: ${Math.round(s.openness)}`,
    `conscientiousness: ${Math.round(s.conscientiousness)}`,
    `extraversion: ${Math.round(s.extraversion)}`,
    `agreeableness: ${Math.round(s.agreeableness)}`,
    `neuroticism: ${Math.round(s.neuroticism)}`,
  ].join('\n');

  return {
    system: [
      { text: STABLE, cache: true },
      { text: `Write every text field in ${languageName(input.locale)}.` },
    ],
    messages: [{ role: 'user', content: fence('scores', scores) }],
    input,
  };
}
