/**
 * "Ask the AI tutor" event bridge (PLAN §9.1 contract).
 *
 * Anything in the app can open the tutor with `openTutor({...})`; the chat UI
 * listens with `onTutorRequest(...)`. The event name is kept from the original
 * glossary popover, which still dispatches the legacy `{ message, context: string }`
 * shape directly; `normalizeTutorDetail` accepts both.
 *
 * WP-08's `/api/v2/llm/tutor` validates the same shape server-side.
 */

export const TUTOR_EVENT = 'open-rise-path-chat';

/** Upper bound on the quoted lesson text sent with a question (PLAN §5.7). */
export const TUTOR_EXCERPT_MAX = 1500;

export type TutorMode = 'explain' | 'socratic';

export type TutorLessonRef = {
  courseId: string;
  lessonId: string;
  title: string;
  objectives: string[];
  level?: string;
};

export type TutorAnchor = {
  sectionId: string;
  blockId: string;
  blockType: string;
  excerpt: string;
  codeLang?: string;
  highlightedLines?: number[];
};

export type TutorLearnerState = {
  attemptsOnBlock?: number;
  chosenOptionId?: string;
};

export type AskTutorDetail = {
  message: string;
  mode?: TutorMode;
  lesson?: TutorLessonRef;
  anchor?: TutorAnchor;
  learner?: TutorLearnerState;
};

/** What GlossaryText dispatches today. */
export type LegacyTutorDetail = {
  message: string;
  context?: string;
};

/** The lesson-aware part of a request, forwarded as chat `context`. */
export type TutorChatContext = Pick<AskTutorDetail, 'mode' | 'lesson' | 'anchor' | 'learner'>;

export type TutorRequest = {
  message: string;
  /** Free-text context from the legacy glossary event. */
  legacyContext?: string;
  tutor: TutorChatContext;
};

export function openTutor(detail: AskTutorDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AskTutorDetail>(TUTOR_EVENT, { detail }));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

function normalizeLesson(raw: unknown): TutorLessonRef | undefined {
  if (!isRecord(raw)) return undefined;
  const courseId = str(raw.courseId, 200);
  const lessonId = str(raw.lessonId, 200);
  if (!courseId || !lessonId) return undefined;
  const objectives = Array.isArray(raw.objectives)
    ? raw.objectives.map((o) => str(o, 500)).filter((o): o is string => Boolean(o)).slice(0, 12)
    : [];
  const level = str(raw.level, 40);
  return { courseId, lessonId, title: str(raw.title, 300) ?? '', objectives, ...(level ? { level } : {}) };
}

function normalizeAnchor(raw: unknown): TutorAnchor | undefined {
  if (!isRecord(raw)) return undefined;
  const blockId = str(raw.blockId, 200);
  if (!blockId) return undefined;
  const codeLang = str(raw.codeLang, 40);
  const highlightedLines = Array.isArray(raw.highlightedLines)
    ? raw.highlightedLines.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 200)
    : undefined;
  return {
    sectionId: str(raw.sectionId, 200) ?? '',
    blockId,
    blockType: str(raw.blockType, 60) ?? 'unknown',
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt.slice(0, TUTOR_EXCERPT_MAX) : '',
    ...(codeLang ? { codeLang } : {}),
    ...(highlightedLines?.length ? { highlightedLines } : {}),
  };
}

function normalizeLearner(raw: unknown): TutorLearnerState | undefined {
  if (!isRecord(raw)) return undefined;
  const attempts = raw.attemptsOnBlock;
  const attemptsOnBlock = Number.isInteger(attempts) && (attempts as number) >= 0
    ? Math.min(attempts as number, 1000)
    : undefined;
  const chosenOptionId = str(raw.chosenOptionId, 200);
  if (attemptsOnBlock === undefined && !chosenOptionId) return undefined;
  return {
    ...(attemptsOnBlock !== undefined ? { attemptsOnBlock } : {}),
    ...(chosenOptionId ? { chosenOptionId } : {}),
  };
}

/**
 * Accepts an AskTutorDetail or the legacy `{ message, context: string }` and
 * returns a bounded request, or null when there is no message.
 */
export function normalizeTutorDetail(raw: unknown): TutorRequest | null {
  if (!isRecord(raw)) return null;
  const message = str(raw.message, 2000);
  if (!message) return null;

  const tutor: TutorChatContext = {};
  if (raw.mode === 'explain' || raw.mode === 'socratic') tutor.mode = raw.mode;
  const lesson = normalizeLesson(raw.lesson);
  if (lesson) tutor.lesson = lesson;
  const anchor = normalizeAnchor(raw.anchor);
  if (anchor) tutor.anchor = anchor;
  const learner = normalizeLearner(raw.learner);
  if (learner) tutor.learner = learner;

  const legacyContext = str(raw.context, TUTOR_EXCERPT_MAX);
  return { message, tutor, ...(legacyContext ? { legacyContext } : {}) };
}

/** Subscribe to tutor requests. Returns the unsubscribe function. */
export function onTutorRequest(handler: (request: TutorRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const request = normalizeTutorDetail((event as CustomEvent<unknown>).detail);
    if (request) handler(request);
  };
  window.addEventListener(TUTOR_EVENT, listener);
  return () => window.removeEventListener(TUTOR_EVENT, listener);
}
