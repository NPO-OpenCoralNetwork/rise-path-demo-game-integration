// @ts-check
import { DATA_NOT_INSTRUCTIONS, fence, languageName } from './shared.js';

/** @typedef {import('./shared.js').PromptSpec} PromptSpec */
/** @typedef {import('./shared.js').PromptMessage} PromptMessage */
/** @typedef {import('zod/v4').infer<typeof import('../schemas.js').TutorRequest>} TutorRequestBody */

const STABLE = [
  'You are AI Sensei (AI先生), the tutor that sits beside a Rise Path lesson.',
  'The learner selected part of the lesson and asked about it. Help them understand that part.',
  '',
  'How to answer:',
  '- Keep the first answer short: about 120 Japanese characters or 60 English words. Go deeper only when the learner asks for more detail.',
  '- Ground the answer in the excerpt and the lesson objectives. Reuse the lesson\'s own terms.',
  '- If the question goes beyond this lesson, say so first ("This is outside this lesson, but…" / 「このレッスンの範囲外ですが…」), then answer briefly.',
  '- Plain text with light Markdown (short lists, `inline code`, small fenced code blocks). No HTML, no headings.',
  '- Do not guess facts about the learner, and do not invent APIs or library features.',
  '',
  'Modes:',
  '- explain: explain directly, with one concrete example or analogy.',
  '- socratic: do not state the final answer, the correct option, or finished code. Give one hint that narrows the problem, then end with one guiding question the learner can answer in their head. If the learner is close, say what is right so far.',
  '',
  DATA_NOT_INSTRUCTIONS,
].join('\n');

/**
 * @param {TutorRequestBody} body
 * @param {{ mode: 'explain'|'socratic', locale: 'ja'|'en'|'fr' }} resolved
 * @returns {PromptSpec}
 */
export function buildTutorPrompt(body, resolved) {
  const lessonLines = body.lesson
    ? [
      `title: ${body.lesson.title}`,
      body.lesson.level ? `level: ${body.lesson.level}` : '',
      body.lesson.objectives.length ? `objectives:\n${body.lesson.objectives.map((o) => `- ${o}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')
    : '';

  const anchor = body.anchor;
  const anchorLines = anchor
    ? [
      `section: ${anchor.sectionId}`,
      `block: ${anchor.blockId} (${anchor.blockType}${anchor.codeLang ? `, ${anchor.codeLang}` : ''})`,
      anchor.highlightedLines?.length ? `highlighted lines: ${anchor.highlightedLines.join(', ')}` : '',
    ].filter(Boolean).join('\n')
    : '';

  const learnerLines = body.learner
    ? [
      body.learner.attemptsOnBlock !== undefined ? `attempts on this block: ${body.learner.attemptsOnBlock}` : '',
      body.learner.chosenOptionId ? `last chosen option: ${body.learner.chosenOptionId}` : '',
    ].filter(Boolean).join('\n')
    : '';

  const current = [
    lessonLines ? fence('lesson', lessonLines) : '',
    anchorLines ? fence('anchor', anchorLines) : '',
    anchor?.excerpt ? fence('excerpt', anchor.excerpt) : '',
    !anchor?.excerpt && body.context ? fence('excerpt', body.context) : '',
    learnerLines ? fence('learner_state', learnerLines) : '',
    fence('learner_question', body.message),
  ].filter(Boolean).join('\n\n');

  /** @type {PromptMessage[]} */
  const history = [];
  for (const turn of body.history || []) {
    if (!turn.content.trim()) continue;
    if (!history.length && turn.role !== 'user') continue; // conversations start with the learner
    history.push({ role: turn.role, content: turn.role === 'user' ? fence('learner_question', turn.content) : turn.content });
  }

  return {
    system: [
      { text: STABLE, cache: true },
      { text: `Mode: ${resolved.mode}. Respond in ${languageName(resolved.locale)}.` },
    ],
    messages: [...history, { role: 'user', content: current }],
    input: { ...body, mode: resolved.mode, locale: resolved.locale },
  };
}
