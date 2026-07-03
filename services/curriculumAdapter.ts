/**
 * Curriculum Adapter
 * 
 * Converts legacy curriculum formats to the new DocChapter format
 * for rendering in GeneratedDocView.
 */

import {
    DocChapter,
    DocSection,
    LocalizedDocBlock,
    LocalizedText,
    QuizData,
    QuizQuestion,
    QuizOption
} from '../types';

// --- Legacy Types (from current API response) ---

interface LegacyDocBlock {
    type: string;
    content?: string;
    items?: string[];
    language?: string;
}

interface LegacyQuizItem {
    q: string;
    choices: string[];
    answer: number;
}

interface LegacyLesson {
    lesson_id: string;
    nexloom?: Record<string, unknown>;
    worlds?: Record<string, unknown>;
    integration?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    summary?: string;
    estimated_min?: number;
    unlock_rule?: string;
    retry_policy?: string;
    doc_blocks?: LegacyDocBlock[];
    exercises?: { prompt: string; expected: string }[];
    quiz?: LegacyQuizItem[];
    resources?: { title: string; url: string }[];
    ui_hints?: {
        card_title?: string;
        card_text?: string;
        cta?: string;
        difficulty?: string;
        time?: string;
        tags?: string[];
    };
}

interface LegacyModule {
    module_id: string;
    title: string;
    objective?: string;
    prereq_modules?: string[];
    estimated_hours?: number;
    deliverable?: string;
    assessment?: string;
    module_ui_hints?: {
        card_title?: string;
        card_text?: string;
        tags?: string[];
        difficulty?: string;
    };
    lessons?: LegacyLesson[];
}

interface LegacyCurriculum {
    curriculum_id?: string;
    version?: number;
    ui_template_id?: string;
    title?: LocalizedText | string;
    description?: LocalizedText | string;
    modules?: LegacyModule[];
}

// --- Output Types ---

export interface GeneratedLesson extends DocChapter {
    lesson_id: string;
    estimated_min: number;
    unlock_rule: 'doc_completed' | 'manual' | 'immediate';
    nexloom?: Record<string, unknown>;
    worlds?: Record<string, unknown>;
    integration?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    quiz?: QuizData;
    exercises?: { prompt: string; expected: string }[];
    ui_hints?: {
        card_title: string;
        card_text: string;
        cta: string;
        difficulty: 'easy' | 'medium' | 'hard';
        time: string;
        tags: string[];
    };
}

export interface GeneratedModule {
    module_id: string;
    title: LocalizedText;
    objective: LocalizedText;
    estimated_hours: number;
    lessons: GeneratedLesson[];
    module_ui_hints?: {
        card_title: string;
        card_text: string;
        tags: string[];
        difficulty: 'easy' | 'medium' | 'hard';
    };
}

export interface CurriculumPersonalization {
    learning_mode?: string;
    credential_orientation?: string;
    problem_solving_orientation?: string;
    reassurance_need?: string;
    example_first_preference?: string;
    explanation_style?: string;
    [key: string]: string | undefined;
}

export interface GeneratedCurriculumV2 {
    curriculum_id: string;
    version: number;
    ui_template_id: string;
    title: LocalizedText;
    description: LocalizedText;
    modules: GeneratedModule[];
    created_at?: Date;
    personalization?: CurriculumPersonalization;
    nexloom?: Record<string, unknown>;
    worlds?: Record<string, unknown>;
    integration?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

// --- Helper Functions ---

/**
 * Normalize a string or LocalizedText to LocalizedText
 */
export const normalizeLocalizedText = (
    value: string | LocalizedText | undefined,
    fallback: string = ''
): LocalizedText => {
    if (!value) return { en: fallback, jp: fallback };
    if (typeof value === 'string') return { en: value, jp: value };
    return {
        en: value.en || value.jp || fallback,
        jp: value.jp || value.en || fallback
    };
};

/**
 * Convert legacy doc_block to LocalizedDocBlock
 */
const convertDocBlock = (block: LegacyDocBlock, index: number): LocalizedDocBlock | null => {
    switch (block.type) {
        case 'text':
            return {
                type: 'text',
                text: normalizeLocalizedText(block.content),
                style: index === 0 ? 'lead' : 'normal'
            };

        case 'code':
            return {
                type: 'code',
                code: block.content || '',
                language: block.language || 'javascript',
                filename: block.language ? `example.${getFileExtension(block.language)}` : undefined
            };

        case 'bullets':
        case 'list':
            if (!block.items || block.items.length === 0) return null;
            return {
                type: 'list',
                items: block.items.map(item => normalizeLocalizedText(item)),
                style: 'bullet'
            };

        default:
            // Fallback: treat unknown types as text
            if (block.content) {
                return {
                    type: 'text',
                    text: normalizeLocalizedText(block.content),
                    style: 'normal'
                };
            }
            return null;
    }
};

/**
 * Get file extension for a programming language
 */
const getFileExtension = (language: string): string => {
    const extensions: Record<string, string> = {
        javascript: 'js',
        typescript: 'ts',
        python: 'py',
        java: 'java',
        json: 'json',
        html: 'html',
        css: 'css',
        sql: 'sql',
        bash: 'sh',
        shell: 'sh'
    };
    return extensions[language.toLowerCase()] || language;
};

/**
 * Convert legacy quiz format to QuizData
 */
const convertQuiz = (quizItems: LegacyQuizItem[], lessonId: string): QuizData => {
    const questions: QuizQuestion[] = quizItems.map((item, idx) => {
        const options: QuizOption[] = item.choices.map((choice, choiceIdx) => ({
            id: `${lessonId}-q${idx}-opt${choiceIdx}`,
            text: normalizeLocalizedText(choice)
        }));

        return {
            id: `${lessonId}-q${idx}`,
            text: normalizeLocalizedText(item.q),
            options,
            correctAnswer: options[item.answer]?.id || options[0]?.id,
            explanation: normalizeLocalizedText('') // Legacy format doesn't have explanations
        };
    });

    return {
        id: `${lessonId}-quiz`,
        title: normalizeLocalizedText('理解度チェック', 'Comprehension Check'),
        questions
    };
};

/**
 * Convert a legacy lesson to GeneratedLesson (DocChapter compatible)
 */
export const convertLessonToDocChapter = (lesson: LegacyLesson): GeneratedLesson => {
    // Convert doc_blocks to LocalizedDocBlock[]
    const contentBlocks: LocalizedDocBlock[] = [];

    if (lesson.doc_blocks) {
        lesson.doc_blocks.forEach((block, idx) => {
            const converted = convertDocBlock(block, idx);
            if (converted) contentBlocks.push(converted);
        });
    }

    // Add exercises as a callout if present
    if (lesson.exercises && lesson.exercises.length > 0) {
        contentBlocks.push({
            type: 'callout',
            variant: 'tip',
            title: normalizeLocalizedText('実践演習', 'Exercise'),
            text: normalizeLocalizedText(
                lesson.exercises.map(e => `• ${e.prompt}`).join('\n'),
                lesson.exercises.map(e => `• ${e.prompt}`).join('\n')
            )
        });
    }

    // Add resources as a list if present
    if (lesson.resources && lesson.resources.length > 0) {
        contentBlocks.push({
            type: 'list',
            items: lesson.resources.map(r => normalizeLocalizedText(`[${r.title}](${r.url})`)),
            style: 'bullet'
        });
    }

    // Ensure at least one content block
    if (contentBlocks.length === 0) {
        contentBlocks.push({
            type: 'text',
            text: normalizeLocalizedText(lesson.summary || 'このレッスンの内容', 'Lesson content'),
            style: 'lead'
        });
    }

    // Build the section
    const mainSection: DocSection = {
        id: `${lesson.lesson_id}-main`,
        title: normalizeLocalizedText(
            lesson.ui_hints?.card_title || lesson.summary || 'レッスン',
            lesson.ui_hints?.card_title || lesson.summary || 'Lesson'
        ),
        content: contentBlocks
    };

    // Build quiz if present
    const quizData = lesson.quiz && lesson.quiz.length > 0
        ? convertQuiz(lesson.quiz, lesson.lesson_id)
        : undefined;

    return {
        id: lesson.lesson_id,
        lesson_id: lesson.lesson_id,
        title: normalizeLocalizedText(
            lesson.ui_hints?.card_title || lesson.summary || 'レッスン',
            lesson.ui_hints?.card_title || lesson.summary || 'Lesson'
        ),
        subtitle: normalizeLocalizedText(
            lesson.ui_hints?.card_text || lesson.summary || '',
            lesson.ui_hints?.card_text || lesson.summary || ''
        ),
        readingTime: normalizeLocalizedText(
            `${lesson.estimated_min || 10}分`,
            `${lesson.estimated_min || 10} min`
        ),
        sections: [mainSection],
        estimated_min: lesson.estimated_min || 10,
        unlock_rule: (lesson.unlock_rule as 'doc_completed' | 'manual' | 'immediate') || 'immediate',
        quiz: quizData,
        exercises: lesson.exercises,
        nexloom: lesson.nexloom,
        worlds: lesson.worlds,
        integration: lesson.integration,
        metadata: lesson.metadata,
        ui_hints: lesson.ui_hints ? {
            card_title: lesson.ui_hints.card_title || '',
            card_text: lesson.ui_hints.card_text || '',
            cta: lesson.ui_hints.cta || 'Start',
            difficulty: (lesson.ui_hints.difficulty as 'easy' | 'medium' | 'hard') || 'medium',
            time: lesson.ui_hints.time || `${lesson.estimated_min || 10} min`,
            tags: lesson.ui_hints.tags || []
        } : undefined
    };
};

/**
 * Convert a new-format lesson (with sections) to GeneratedLesson
 */
const convertNewFormatLesson = (lesson: any): GeneratedLesson => {
    // Lesson already has sections structure
    return {
        id: lesson.lesson_id || lesson.id,
        lesson_id: lesson.lesson_id || lesson.id,
        title: normalizeLocalizedText(lesson.title),
        subtitle: normalizeLocalizedText(lesson.subtitle || ''),
        readingTime: normalizeLocalizedText(
            lesson.reading_time || `${lesson.estimated_min || 10}分`,
            lesson.reading_time || `${lesson.estimated_min || 10} min`
        ),
        sections: lesson.sections || [],
        estimated_min: lesson.estimated_min || 10,
        unlock_rule: 'immediate',
        quiz: lesson.quiz ? convertNewQuizFormat(lesson.quiz) : undefined,
        exercises: undefined,
        nexloom: lesson.nexloom,
        worlds: lesson.worlds,
        integration: lesson.integration,
        metadata: lesson.metadata,
        ui_hints: undefined
    };
};

/**
 * Convert new quiz format to QuizData
 */
const convertNewQuizFormat = (quiz: any): QuizData | undefined => {
    if (!quiz || !quiz.questions || quiz.questions.length === 0) return undefined;

    return {
        id: quiz.id || 'quiz',
        title: normalizeLocalizedText(quiz.title || '理解度チェック', quiz.title || 'Comprehension Check'),
        questions: quiz.questions.map((q: any, idx: number) => ({
            id: q.id || `q${idx}`,
            text: normalizeLocalizedText(q.text),
            options: (q.options || []).map((opt: any, optIdx: number) => ({
                id: opt.id || `opt${optIdx}`,
                text: normalizeLocalizedText(opt.text)
            })),
            correctAnswer: q.correctAnswer || q.correct_answer || '',
            explanation: normalizeLocalizedText(q.explanation || '')
        }))
    };
};

/**
 * Check if a lesson is in new format (has sections)
 */
const isNewFormatLesson = (lesson: any): boolean => {
    return Array.isArray(lesson.sections) && lesson.sections.length > 0;
};

/**
 * Convert a legacy module to GeneratedModule
 * Handles both new format (with sections) and legacy format (with doc_blocks)
 */
export const convertModuleToGeneratedModule = (module: any): GeneratedModule => {
    const lessons = (module.lessons || []).map((lesson: any) => {
        if (isNewFormatLesson(lesson)) {
            // New format: lesson already has sections
            return convertNewFormatLesson(lesson);
        } else {
            // Legacy format: needs conversion
            return convertLessonToDocChapter(lesson);
        }
    });

    return {
        module_id: module.module_id,
        title: normalizeLocalizedText(module.title),
        objective: normalizeLocalizedText(module.objective || ''),
        estimated_hours: module.estimated_hours || 1,
        lessons,
        module_ui_hints: module.module_ui_hints ? {
            card_title: module.module_ui_hints.card_title || (typeof module.title === 'string' ? module.title : module.title?.jp || ''),
            card_text: module.module_ui_hints.card_text || (typeof module.objective === 'string' ? module.objective : module.objective?.jp || ''),
            tags: module.module_ui_hints.tags || [],
            difficulty: (module.module_ui_hints.difficulty as 'easy' | 'medium' | 'hard') || 'medium'
        } : undefined
    };
};

/**
 * Convert a GeneratedCourse (from curriculumApi) or legacy curriculum to GeneratedCurriculumV2
 * 
 * Handles multiple data sources:
 * 1. New doc_chapter format with 'modules' containing lessons with sections
 * 2. Legacy format with 'chapters' (simple structure)
 */
export const convertToGeneratedCurriculumV2 = (
    curriculum: any,
    curriculumId?: string
): GeneratedCurriculumV2 => {
    console.log('[curriculumAdapter] Converting to V2:', {
        hasChapters: Array.isArray(curriculum.chapters),
        hasModules: Array.isArray(curriculum.modules),
        chaptersCount: curriculum.chapters?.length,
        modulesCount: curriculum.modules?.length,
        uiTemplateId: curriculum.ui_template_id,
        firstModuleHasLessons: curriculum.modules?.[0]?.lessons?.length > 0
    });

    // Check if we have the new doc_chapter format (modules with lessons that have sections)
    const hasNewModulesFormat = Array.isArray(curriculum.modules) &&
        curriculum.modules.length > 0 &&
        curriculum.modules[0]?.lessons?.length > 0;

    if (hasNewModulesFormat) {
        // New format: use modules directly
        console.log('[curriculumAdapter] Using new modules format');
        const modules: GeneratedModule[] = curriculum.modules.map((module: any) =>
            convertModuleToGeneratedModule(module)
        );

        console.log('[curriculumAdapter] Converted modules:', modules.length);

        // Extract personalization from _meta if present
        const meta = curriculum._meta || {};
        const personalization: CurriculumPersonalization | undefined =
            meta.personalization || meta.learning_mode
                ? { ...meta.personalization, learning_mode: meta.learning_mode }
                : undefined;

        return {
            curriculum_id: curriculumId || curriculum.id || curriculum.curriculum_id || crypto.randomUUID(),
            version: curriculum.version || 1,
            ui_template_id: curriculum.ui_template_id || 'doc_chapter',
            title: normalizeLocalizedText(curriculum.title, 'Generated Curriculum'),
            description: normalizeLocalizedText(curriculum.description, ''),
            modules,
            created_at: curriculum.createdAt || new Date(),
            nexloom: curriculum.nexloom,
            worlds: curriculum.worlds,
            integration: curriculum.integration,
            metadata: curriculum.metadata,
            personalization,
        };
    }

    // Legacy format: use chapters
    console.log('[curriculumAdapter] Using legacy chapters format');
    const sourceData = curriculum.chapters || [];

    // Convert chapters to GeneratedModule format
    const modules: GeneratedModule[] = sourceData.map((item: any, index: number) => {
        // Check if this is a chapter (from GeneratedCourse) or a module
        const isChapter = !item.module_id && !item.lessons;

        if (isChapter) {
            // Convert GeneratedChapter to GeneratedModule with a single lesson
            return convertChapterToModule(item, index);
        } else {
            // Already in module format
            return convertModuleToGeneratedModule(item);
        }
    });

    console.log('[curriculumAdapter] Converted modules:', modules.length);

    return {
        curriculum_id: curriculumId || curriculum.id || curriculum.curriculum_id || crypto.randomUUID(),
        version: curriculum.version || 1,
        ui_template_id: curriculum.ui_template_id || curriculum.preferredTemplate || 'doc_chapter',
        title: normalizeLocalizedText(curriculum.title, 'Generated Curriculum'),
        description: normalizeLocalizedText(curriculum.description, ''),
        modules,
        created_at: curriculum.createdAt || new Date(),
        nexloom: curriculum.nexloom,
        worlds: curriculum.worlds,
        integration: curriculum.integration,
        metadata: curriculum.metadata,
    };
};

/**
 * Convert a GeneratedChapter to GeneratedModule
 * (Used when processing data from curriculumApi's normalizeGeneratedCourse)
 */
const convertChapterToModule = (chapter: any, index: number): GeneratedModule => {
    // Extract content for the lesson
    const contentBlocks: LocalizedDocBlock[] = [];

    // Add main content if available
    if (chapter.content) {
        contentBlocks.push({
            type: 'text',
            text: normalizeLocalizedText(chapter.content),
            style: 'lead'
        });
    }

    // Add blocks if available (from workshop_split or similar)
    if (chapter.blocks && Array.isArray(chapter.blocks)) {
        chapter.blocks.forEach((block: any, idx: number) => {
            const converted = convertAnyBlock(block, idx);
            if (converted) contentBlocks.push(converted);
        });
    }

    // Fallback if no content
    if (contentBlocks.length === 0) {
        contentBlocks.push({
            type: 'text',
            text: normalizeLocalizedText(chapter.title || `Chapter ${index + 1}`),
            style: 'lead'
        });
    }

    // Create a single lesson from the chapter
    const lesson: GeneratedLesson = {
        id: chapter.id || `chapter-${index}`,
        lesson_id: chapter.id || `chapter-${index}`,
        title: normalizeLocalizedText(chapter.title || `Chapter ${index + 1}`),
        subtitle: normalizeLocalizedText(chapter.type || ''),
        readingTime: normalizeLocalizedText(chapter.duration || '10分', chapter.duration || '10 min'),
        sections: [{
            id: `${chapter.id || `chapter-${index}`}-main`,
            title: normalizeLocalizedText(chapter.title || 'Content'),
            content: contentBlocks
        }],
        estimated_min: parseInt(chapter.duration) || 10,
        unlock_rule: 'immediate',
        quiz: undefined,
        exercises: undefined,
        ui_hints: undefined
    };

    return {
        module_id: chapter.id || `module-${index}`,
        title: normalizeLocalizedText(chapter.title || `Module ${index + 1}`),
        objective: normalizeLocalizedText(chapter.content || ''),
        estimated_hours: (parseInt(chapter.duration) || 10) / 60,
        lessons: [lesson],
        module_ui_hints: undefined
    };
};

/**
 * Convert any block format to LocalizedDocBlock
 */
const convertAnyBlock = (block: any, index: number): LocalizedDocBlock | null => {
    if (!block) return null;

    // Handle different block formats
    if (block.type === 'text' || block.type === 'paragraph') {
        return {
            type: 'text',
            text: normalizeLocalizedText(block.content || block.text || ''),
            style: index === 0 ? 'lead' : 'normal'
        };
    }

    if (block.type === 'code') {
        return {
            type: 'code',
            code: block.content || block.code || '',
            language: block.language || 'javascript',
            filename: block.filename
        };
    }

    if (block.type === 'bullets' || block.type === 'list') {
        const items = block.items || block.content?.split?.('\n') || [];
        if (items.length === 0) return null;
        return {
            type: 'list',
            items: items.map((item: any) => normalizeLocalizedText(typeof item === 'string' ? item : item.text || '')),
            style: 'bullet'
        };
    }

    if (block.type === 'callout' || block.type === 'note' || block.type === 'tip') {
        return {
            type: 'callout',
            variant: block.variant || 'info',
            title: block.title ? normalizeLocalizedText(block.title) : undefined,
            text: normalizeLocalizedText(block.content || block.text || '')
        };
    }

    // Default: treat as text
    if (block.content || block.text) {
        return {
            type: 'text',
            text: normalizeLocalizedText(block.content || block.text),
            style: 'normal'
        };
    }

    return null;
};

/**
 * Check if curriculum is already in new format
 */
export const isNewFormat = (curriculum: any): boolean => {
    if (!curriculum?.modules || curriculum.modules.length === 0) return false;
    const firstModule = curriculum.modules[0];
    if (!firstModule?.lessons || firstModule.lessons.length === 0) return false;
    const firstLesson = firstModule.lessons[0];
    // New format has 'sections' instead of 'doc_blocks'
    return Array.isArray(firstLesson.sections);
};

/**
 * Get a specific lesson by module and lesson index
 */
export const getLessonFromCurriculum = (
    curriculum: GeneratedCurriculumV2,
    moduleIndex: number,
    lessonIndex: number
): GeneratedLesson | null => {
    const module = curriculum.modules[moduleIndex];
    if (!module) return null;
    return module.lessons[lessonIndex] || null;
};

/**
 * Get a specific lesson by lesson_id
 */
export const getLessonById = (
    curriculum: GeneratedCurriculumV2,
    lessonId: string
): { lesson: GeneratedLesson; moduleIndex: number; lessonIndex: number } | null => {
    for (let mi = 0; mi < curriculum.modules.length; mi++) {
        const module = curriculum.modules[mi];
        for (let li = 0; li < module.lessons.length; li++) {
            if (module.lessons[li].lesson_id === lessonId) {
                return { lesson: module.lessons[li], moduleIndex: mi, lessonIndex: li };
            }
        }
    }
    return null;
};
