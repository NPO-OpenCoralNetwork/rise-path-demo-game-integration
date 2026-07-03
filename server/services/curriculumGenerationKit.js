import { PERSONALIZATION_STATIC } from './personalizationDeriver.js';

const SCHEMA_VERSION = '2026-03-10';
const POLICY_VERSION = '2026-03-10.a';
const DEFAULT_PORTAL_ID = 'general';
const DEFAULT_TEMPLATE_ID = 'default';
const DEFAULT_LEARNING_MODE = 'default';

// --- Learning Mode definitions (spec 13.2 / 16.1) ---
// Each mode overrides section_order, writing_rules, and lesson_template hints.
const LEARNING_MODES = {
    credential: {
        label: '資格モード',
        section_order: [
            'overview',
            'key_points',
            'examples',
            'checklist',
            'practice',
            'cautions',
            'reflection',
            'takeaway',
        ],
        extra_writing_rules: [
            'Start each lesson with "このレッスンでできるようになること" (what you will be able to do).',
            'Include a checklist of confirmation points per lesson.',
            'Add a mock exam or achievement check at the end of each module.',
        ],
        lesson_template_overrides: {
            fields_emphasis: ['checklist', 'practice', 'takeaway'],
            recommended_block_mix: { min_text_blocks: 2, target_list_blocks: 2, target_callouts: 1 },
        },
        ui_emphasis: { show_progress_rate: true, show_completion_badge: true, show_achievement_criteria: true },
    },
    practice: {
        label: '実践モード',
        section_order: [
            'overview',
            'examples',
            'practice',
            'key_points',
            'cautions',
            'reflection',
            'takeaway',
        ],
        extra_writing_rules: [
            'Prioritize actionable steps the learner can try immediately.',
            'Include observation logs or practice records when applicable.',
            'Keep theory minimal; lead with hands-on activities.',
        ],
        lesson_template_overrides: {
            fields_emphasis: ['practice', 'examples', 'reflection'],
            recommended_block_mix: { min_text_blocks: 1, target_list_blocks: 2, target_callouts: 1 },
        },
        ui_emphasis: { show_action_list: true, show_practice_log: true },
    },
    problem_solving: {
        label: '問題演習モード',
        section_order: [
            'overview',
            'examples',
            'key_points',
            'practice',
            'checklist',
            'cautions',
            'reflection',
            'takeaway',
        ],
        extra_writing_rules: [
            'Open each lesson with a short problem or question before explanation.',
            'Use the pattern: example problem -> principle -> practice.',
            'Explain "why" rather than just "what" in solutions.',
        ],
        lesson_template_overrides: {
            fields_emphasis: ['practice', 'examples', 'checklist'],
            recommended_block_mix: { min_text_blocks: 2, target_list_blocks: 1, target_callouts: 2 },
        },
        ui_emphasis: { show_quiz_prompt: true, show_case_study: true },
    },
    gentle: {
        label: 'やさしい理解モード',
        section_order: [
            'overview',
            'examples',
            'key_points',
            'cautions',
            'practice',
            'takeaway',
        ],
        extra_writing_rules: [
            'Start with concrete examples before abstract definitions.',
            'Keep each lesson focused on one main idea.',
            'Close with "今日はここまでで十分です" (this is enough for today).',
            'Limit practice to 1-2 light actions.',
            'Pair every caution with reassurance.',
        ],
        lesson_template_overrides: {
            fields_emphasis: ['examples', 'takeaway', 'cautions'],
            recommended_block_mix: { min_text_blocks: 2, target_list_blocks: 1, target_callouts: 2 },
        },
        ui_emphasis: { show_reassurance: true, limit_actions: 2 },
    },
};

export const SUPPORTED_LEARNING_MODES = Object.keys(LEARNING_MODES);

export const resolveLearningMode = (requestedMode) => {
    const normalized = cleanString(requestedMode).toLowerCase();
    if (normalized && LEARNING_MODES[normalized]) return normalized;
    return DEFAULT_LEARNING_MODE;
};

const DEFAULT_KIT = {
    template_id: DEFAULT_TEMPLATE_ID,
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    required_slots: ['target_audience', 'goal', 'current_level', 'duration_weeks'],
    optional_slots: ['constraints', 'tone', 'delivery_style', 'materials', 'success_metric'],
    question_order: ['target_audience', 'goal', 'current_level', 'duration_weeks', 'constraints', 'delivery_style'],
    constraints: {
        min_duration_weeks: 1,
        max_duration_weeks: 52,
        max_modules: 12,
        max_lessons_per_module: 10,
    },
    output_schema: {
        type: 'object',
        required: ['title', 'summary', 'modules'],
        module_required: ['title', 'goal', 'lessons'],
        lesson_required: ['title', 'objective'],
        lesson_recommended: [
            'summary',
            'explanation',
            'why_it_matters',
            'key_points',
            'examples',
            'practice',
            'checklist',
            'cautions',
            'reflection',
            'takeaway',
        ],
    },
    content_blueprint: {
        ui_template_id: 'doc_chapter',
        reference_curricula: [
            'data/curricula/vibe_coding/chapter1.ts',
            'data/curricula/unity_ai/chapter1.ts',
            'services/curriculumApi.ts',
        ],
        writing_rules: [
            'Each lesson should feel like a complete mini chapter, not a single note.',
            'Prefer 3 to 5 sections per lesson with a mix of text, list, and callout style content.',
            'Do not pack practice or cautions into one objective sentence if they can be separated.',
            'For beginner audiences, explain terms in plain language before asking for action.',
            'When safety matters, add explicit cautions instead of vague reminders.',
        ],
        lesson_template: {
            section_order: [
                'overview',
                'key_points',
                'examples',
                'practice',
                'checklist',
                'cautions',
                'reflection',
                'takeaway',
            ],
            recommended_block_mix: {
                min_text_blocks: 2,
                target_list_blocks: 1,
                target_callouts: 1,
            },
            fields: {
                title: 'Lesson title shown in the UI',
                objective: 'One-sentence goal of the lesson',
                summary: 'Short subtitle or lesson summary',
                explanation: '2-4 sentence explanation of the concept in learner-friendly language',
                why_it_matters: 'Why this lesson matters in daily use or the full course flow',
                key_points: ['3 to 5 bullet points covering what to understand'],
                examples: ['1 to 3 short real examples, situations, or comparisons'],
                practice: ['2 to 4 light actions the learner can try right away'],
                checklist: ['2 to 5 quick self-check items'],
                cautions: ['1 to 3 safety notes, pitfalls, or scope limits'],
                reflection: ['1 to 2 reflection prompts or output prompts'],
                takeaway: 'One short closing message or lesson summary',
            },
        },
        authoring_prompt_hint: 'Generate lessons using the lesson_template fields so the adapter can expand them into a rich doc_chapter UI.',
    },
    save_defaults: {
        status: 'draft',
        is_public: true,
        ui_template_id: 'doc_chapter',
    },
};

const PORTAL_OVERRIDES = {
    village_welcome: {
        required_slots: ['target_audience', 'goal', 'arrival_context', 'duration_weeks', 'language_support'],
        optional_slots: ['constraints', 'tone', 'delivery_style', 'community_context', 'support_needs'],
        question_order: ['target_audience', 'arrival_context', 'goal', 'language_support', 'duration_weeks', 'community_context'],
        constraints: {
            min_duration_weeks: 1,
            max_duration_weeks: 8,
            max_modules: 8,
            max_lessons_per_module: 8,
        },
    },
    unity: {
        required_slots: ['target_audience', 'goal', 'current_level', 'duration_weeks', 'project_outcome'],
        optional_slots: ['constraints', 'engine_version', 'team_mode', 'delivery_style'],
        question_order: ['target_audience', 'current_level', 'goal', 'project_outcome', 'duration_weeks', 'constraints'],
    },
    vibe: {
        required_slots: ['target_audience', 'goal', 'current_level', 'duration_weeks', 'project_outcome'],
        optional_slots: ['constraints', 'repository_style', 'delivery_style', 'team_mode'],
        question_order: ['target_audience', 'current_level', 'goal', 'project_outcome', 'duration_weeks', 'repository_style'],
    },
};

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeLocale = (value) => cleanString(value) || 'ja-JP';

const asObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
};

const asArray = (value) => Array.isArray(value) ? value : [];

const mergeKit = (portalId) => {
    const override = PORTAL_OVERRIDES[portalId] || {};
    const mergedConstraints = {
        ...DEFAULT_KIT.constraints,
        ...asObject(override.constraints),
    };
    const mergedSaveDefaults = {
        ...DEFAULT_KIT.save_defaults,
        ...asObject(override.save_defaults),
    };

    return {
        ...DEFAULT_KIT,
        ...override,
        constraints: mergedConstraints,
        content_blueprint: {
            ...DEFAULT_KIT.content_blueprint,
            ...asObject(override.content_blueprint),
        },
        save_defaults: mergedSaveDefaults,
    };
};

const toFollowupQuestion = (field) => {
    const prompts = {
        target_audience: '想定学習者は誰ですか？',
        goal: 'このカリキュラムで最終的に何を達成したいですか？',
        current_level: '受講者の現在レベルはどの程度ですか？',
        duration_weeks: '何週間で完了する想定ですか？',
        arrival_context: '移住や参加の前提状況はどうなっていますか？',
        language_support: '言語面でどの支援が必要ですか？',
        project_outcome: '最後にどんな成果物を作る想定ですか？',
        constraints: '避けたい制約や必須条件はありますか？',
        delivery_style: '講義中心、実践中心など希望する進め方はありますか？',
    };
    return prompts[field] || `${field} を確認してください。`;
};

export const getGenerationKit = ({ portalId, templateId, locale, learningMode } = {}) => {
    const normalizedPortalId = cleanString(portalId) || DEFAULT_PORTAL_ID;
    const normalizedTemplateId = cleanString(templateId) || DEFAULT_TEMPLATE_ID;
    const resolvedMode = resolveLearningMode(learningMode);
    const modeConfig = LEARNING_MODES[resolvedMode] || null;
    const base = mergeKit(normalizedPortalId);

    const sectionOrder = modeConfig
        ? [...modeConfig.section_order]
        : [...asArray(base.content_blueprint?.lesson_template?.section_order)];

    const writingRules = [
        ...asArray(base.content_blueprint?.writing_rules),
        ...(modeConfig ? modeConfig.extra_writing_rules : []),
    ];

    const recommendedBlockMix = modeConfig?.lesson_template_overrides?.recommended_block_mix
        ? { ...modeConfig.lesson_template_overrides.recommended_block_mix }
        : { ...asObject(base.content_blueprint?.lesson_template?.recommended_block_mix) };

    const kit = {
        portal_id: normalizedPortalId,
        template_id: normalizedTemplateId,
        locale: normalizeLocale(locale),
        schema_version: base.schema_version,
        policy_version: base.policy_version,
        learning_mode: resolvedMode,
        supported_learning_modes: SUPPORTED_LEARNING_MODES,
        required_slots: [...base.required_slots],
        optional_slots: [...base.optional_slots],
        question_order: [...base.question_order],
        constraints: { ...base.constraints },
        output_schema: { ...base.output_schema },
        content_blueprint: {
            ...base.content_blueprint,
            lesson_template: {
                ...asObject(base.content_blueprint?.lesson_template),
                recommended_block_mix: recommendedBlockMix,
                fields: {
                    ...asObject(base.content_blueprint?.lesson_template?.fields),
                },
                fields_emphasis: modeConfig?.lesson_template_overrides?.fields_emphasis || [],
                section_order: sectionOrder,
            },
            writing_rules: writingRules,
            reference_curricula: [...asArray(base.content_blueprint?.reference_curricula)],
        },
        save_defaults: { ...base.save_defaults },
        personalization: { ...PERSONALIZATION_STATIC },
    };

    if (modeConfig?.ui_emphasis) {
        kit.ui_emphasis = { ...modeConfig.ui_emphasis };
    }

    return kit;
};

export const normalizeIntake = (intake) => {
    const raw = asObject(intake);
    const normalized = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') {
            const cleaned = value.trim();
            if (cleaned) normalized[key] = cleaned;
            continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            normalized[key] = value;
            continue;
        }
        if (typeof value === 'boolean') {
            normalized[key] = value;
            continue;
        }
        if (Array.isArray(value)) {
            const cleanedList = value
                .map((item) => typeof item === 'string' ? item.trim() : item)
                .filter((item) => item !== '' && item !== null && item !== undefined);
            if (cleanedList.length > 0) normalized[key] = cleanedList;
            continue;
        }
        if (value && typeof value === 'object') {
            normalized[key] = value;
        }
    }
    return normalized;
};

export const validateIntakePayload = ({ intake, kit }) => {
    const normalizedIntake = normalizeIntake(intake);
    const missingFields = [];
    const conflicts = [];

    for (const field of asArray(kit?.required_slots)) {
        const value = normalizedIntake[field];
        if (value === undefined || value === null || value === '') {
            missingFields.push(field);
        }
    }

    const durationWeeks = normalizedIntake.duration_weeks;
    const minDuration = Number(kit?.constraints?.min_duration_weeks || 1);
    const maxDuration = Number(kit?.constraints?.max_duration_weeks || 52);
    if (durationWeeks !== undefined) {
        if (!Number.isFinite(Number(durationWeeks))) {
            conflicts.push('duration_weeks must be a number');
        } else {
            const durationValue = Number(durationWeeks);
            if (durationValue < minDuration || durationValue > maxDuration) {
                conflicts.push(`duration_weeks must be between ${minDuration} and ${maxDuration}`);
            }
        }
    }

    const recommendedFollowups = missingFields.map((field) => ({
        field,
        question: toFollowupQuestion(field),
    }));

    return {
        valid: missingFields.length === 0 && conflicts.length === 0,
        missing_fields: missingFields,
        conflicts,
        recommended_followups: recommendedFollowups,
        normalized_intake: normalizedIntake,
    };
};

export const validateCurriculumDraft = ({ curriculum, kit }) => {
    const normalizedCurriculum = asObject(curriculum);
    const conflicts = [];
    const requiredKeys = asArray(kit?.output_schema?.required);
    const modules = asArray(normalizedCurriculum.modules);
    const maxModules = Number(kit?.constraints?.max_modules || 12);
    const maxLessonsPerModule = Number(kit?.constraints?.max_lessons_per_module || 10);

    for (const key of requiredKeys) {
        const value = normalizedCurriculum[key];
        const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
        if (missing) conflicts.push(`curriculum.${key} is required`);
    }

    if (modules.length > maxModules) {
        conflicts.push(`modules must not exceed ${maxModules}`);
    }

    const normalizedModules = modules.map((module, moduleIndex) => {
        const normalizedModule = asObject(module);
        const lessons = asArray(normalizedModule.lessons);
        if (!cleanString(normalizedModule.title)) {
            conflicts.push(`modules[${moduleIndex}].title is required`);
        }
        if (!cleanString(normalizedModule.goal)) {
            conflicts.push(`modules[${moduleIndex}].goal is required`);
        }
        if (lessons.length === 0) {
            conflicts.push(`modules[${moduleIndex}].lessons must not be empty`);
        }
        if (lessons.length > maxLessonsPerModule) {
            conflicts.push(`modules[${moduleIndex}].lessons must not exceed ${maxLessonsPerModule}`);
        }

        const normalizedLessons = lessons.map((lesson, lessonIndex) => {
            const normalizedLesson = asObject(lesson);
            if (!cleanString(normalizedLesson.title)) {
                conflicts.push(`modules[${moduleIndex}].lessons[${lessonIndex}].title is required`);
            }
            if (!cleanString(normalizedLesson.objective)) {
                conflicts.push(`modules[${moduleIndex}].lessons[${lessonIndex}].objective is required`);
            }
            return normalizedLesson;
        });

        return {
            ...normalizedModule,
            lessons: normalizedLessons,
        };
    });

    return {
        valid: conflicts.length === 0,
        conflicts,
        normalized_curriculum: {
            ...normalizedCurriculum,
            modules: normalizedModules,
        },
        lesson_count: normalizedModules.reduce((sum, module) => sum + asArray(module.lessons).length, 0),
    };
};

export const validateQualityRubric = ({ curriculum, derivedLearningProfile }) => {
    const normalizedCurriculum = asObject(curriculum);
    const modules = asArray(normalizedCurriculum.modules);
    const dp = asObject(derivedLearningProfile);
    const warnings = [];

    const rubric = PERSONALIZATION_STATIC.quality_rubric;
    const requiredBlocks = new Set(rubric.lesson_required_blocks);

    modules.forEach((module, mi) => {
        const lessons = asArray(module?.lessons);

        lessons.forEach((lesson, li) => {
            const loc = `modules[${mi}].lessons[${li}]`;
            const l = asObject(lesson);

            // Count populated sections
            const sectionKeys = [
                'summary', 'explanation', 'why_it_matters',
                'key_points', 'examples', 'practice',
                'checklist', 'cautions', 'reflection', 'takeaway',
            ];
            const populatedCount = sectionKeys.filter((k) => {
                const v = l[k];
                if (Array.isArray(v)) return v.length > 0;
                return typeof v === 'string' && v.trim().length > 0;
            }).length;
            // overview counts if objective or explanation exists
            const hasOverview = cleanString(l.objective) || cleanString(l.explanation) || cleanString(l.summary);
            const totalSections = populatedCount + (hasOverview ? 1 : 0);

            if (totalSections < rubric.lesson_min_sections) {
                warnings.push(`${loc}: has ${totalSections} sections, minimum is ${rubric.lesson_min_sections}`);
            }

            // Required blocks
            for (const block of requiredBlocks) {
                if (block === 'overview') {
                    if (!hasOverview) warnings.push(`${loc}: missing overview (objective/explanation/summary)`);
                    continue;
                }
                if (block === 'key_points') {
                    if (asArray(l.key_points).length === 0 && asArray(l.keyPoints).length === 0) {
                        warnings.push(`${loc}: missing key_points`);
                    }
                    continue;
                }
                const v = l[block];
                const empty = v === undefined || v === null
                    || (typeof v === 'string' && !v.trim())
                    || (Array.isArray(v) && v.length === 0);
                if (empty) {
                    warnings.push(`${loc}: missing required block "${block}"`);
                }
            }

            // Explanation length
            const explanation = cleanString(l.explanation) || cleanString(l.summary) || cleanString(l.objective) || '';
            if (explanation.length < rubric.lesson_min_explanation_chars) {
                warnings.push(`${loc}: explanation is ${explanation.length} chars, minimum is ${rubric.lesson_min_explanation_chars}`);
            }

            // Practice items
            const practiceItems = asArray(l.practice).length;
            if (practiceItems < rubric.lesson_min_practice_items) {
                warnings.push(`${loc}: has ${practiceItems} practice items, minimum is ${rubric.lesson_min_practice_items}`);
            }
        });

        // Personalization-aware checks
        if (dp.credential_orientation === 'high') {
            const hasChecklist = lessons.some((l) => asArray(asObject(l).checklist).length > 0);
            if (!hasChecklist) {
                warnings.push(`modules[${mi}]: credential_orientation is high but no lesson has a checklist`);
            }
        }

        if (dp.problem_solving_orientation === 'high') {
            // At least one lesson in the module should have quiz-like content
            const hasQuizContent = lessons.some((l) => {
                const lo = asObject(l);
                return asArray(lo.checklist).length > 0
                    || asArray(lo.practice).some((p) => {
                        const s = typeof p === 'string' ? p.toLowerCase() : '';
                        return s.includes('問題') || s.includes('quiz') || s.includes('テスト') || s.includes('ケース');
                    });
            });
            if (!hasQuizContent) {
                warnings.push(`modules[${mi}]: problem_solving_orientation is high but no quiz/case content found`);
            }
        }
    });

    return { quality_warnings: warnings };
};

export const buildCurriculumDescription = ({ intake, curriculum }) => {
    const normalizedCurriculum = asObject(curriculum);
    const normalizedIntake = asObject(intake);
    return cleanString(normalizedCurriculum.summary)
        || cleanString(normalizedIntake.goal)
        || cleanString(normalizedCurriculum.description)
        || 'ChatGPT generated curriculum draft';
};

export const buildCurriculumTitle = ({ intake, curriculum, portalId }) => {
    const normalizedCurriculum = asObject(curriculum);
    const normalizedIntake = asObject(intake);
    return cleanString(normalizedCurriculum.title)
        || cleanString(normalizedIntake.title)
        || cleanString(normalizedIntake.goal)
        || `${cleanString(portalId) || DEFAULT_PORTAL_ID} curriculum draft`;
};

export const buildRoadmapSummary = ({ curriculum }) => {
    const normalizedCurriculum = asObject(curriculum);
    const modules = asArray(normalizedCurriculum.modules);
    return {
        modules: modules.map((module, index) => ({
            index: index + 1,
            title: cleanString(module?.title) || `Module ${index + 1}`,
            lesson_count: asArray(module?.lessons).length,
        })),
    };
};
