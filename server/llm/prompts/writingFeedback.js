// @ts-check
import { DATA_NOT_INSTRUCTIONS, fence, languageName, withoutTag } from './shared.js';

/** @typedef {import('./shared.js').PromptSpec} PromptSpec */

/** The tag the learner's text is fenced in. */
const LEARNER_TEXT_TAG = 'learner_text';

/**
 * The learner's text as the prompt carries it: inside <learner_text>, without that tag. Screening
 * a minor's request uses this too (server/safety/moderation.js writingInputParts), so the
 * pre-filter checks what the model will read.
 * @param {string} text
 */
export function writingText(text) {
  return withoutTag(LEARNER_TEXT_TAG, text);
}

const STABLE = [
  'You are the writing coach inside Rise Path, a learning app for self-learners of many ages.',
  'A learner has written a short text for a writing exercise. Assess it against the lesson rubric and help them improve it.',
  '',
  'Scoring (integers 0-100, judged against the rubric, not against a native-speaker ideal):',
  '- clarityScore: is the main point clear and specific?',
  '- linkingScore: are ideas connected with appropriate linking words and a logical order?',
  '- toneScore: does the tone fit the purpose described in the rubric?',
  'Use the full range. 80+ means the rubric is met with only small issues; below 50 means a criterion is largely missing.',
  '',
  'feedback: 2-4 sentences. Name one concrete strength first, then the single most useful change, quoting a short phrase from the text when it helps.',
  'refinedVersion: the learner\'s text rewritten to meet the rubric. Keep their meaning, voice and language; do not add new claims.',
  '',
  DATA_NOT_INSTRUCTIONS,
  'Reply with the JSON object only.',
].join('\n');

/**
 * @param {import('zod/v4').infer<typeof import('../schemas.js').WritingFeedbackRequest>} input
 * @returns {PromptSpec}
 */
export function buildWritingFeedbackPrompt(input) {
  const context = [
    input.lessonTitle ? `Lesson: ${input.lessonTitle}` : '',
    input.goal ? `Goal: ${input.goal}` : '',
  ].filter(Boolean).join('\n');

  return {
    system: [
      { text: STABLE, cache: true },
      { text: `Write the feedback field in ${languageName(input.locale)}. Write refinedVersion in the language of the learner's text.` },
    ],
    messages: [{
      role: 'user',
      content: [
        context ? fence('lesson', context) : '',
        fence('rubric', `clarity: ${input.rubric.clarity}\nlinking: ${input.rubric.linking}\ntone: ${input.rubric.tone}`),
        fence(LEARNER_TEXT_TAG, input.text),
      ].filter(Boolean).join('\n\n'),
    }],
    input,
  };
}
