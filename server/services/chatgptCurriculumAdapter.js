const DEFAULT_UI_TEMPLATE_ID = 'doc_chapter';

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const asObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
};

const asArray = (value) => Array.isArray(value) ? value : [];

const uniqueStrings = (values) => {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const cleaned = cleanString(value);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cleaned);
    }
    return out;
};

const MARKER_DEFINITIONS = [
    { key: 'practice', labels: ['やってみよう', 'practice', 'try this'] },
    { key: 'cautions', labels: ['気をつけたいこと', '注意点', 'caution', 'warning'] },
    { key: 'examples', labels: ['例', 'たとえば', 'example'] },
    { key: 'checklist', labels: ['チェック', 'checklist', 'self-check'] },
    { key: 'reflection', labels: ['ふりかえり', '振り返り', 'reflection'] },
    { key: 'takeaway', labels: ['まとめ', 'takeaway'] },
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toLocalizedText = (value, fallback = '') => {
    if (typeof value === 'string') {
        const cleaned = cleanString(value) || fallback;
        return { en: cleaned, jp: cleaned };
    }

    const record = asObject(value);
    const jp = cleanString(record.jp) || cleanString(record.en) || fallback;
    const en = cleanString(record.en) || cleanString(record.jp) || fallback;
    return { en, jp };
};

const toTextItems = (value) => {
    if (typeof value === 'string') {
        return value
            .split('\n')
            .map((item) => cleanString(item))
            .filter(Boolean);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return [String(value)];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => toTextItems(item));
    }
    if (value && typeof value === 'object') {
        const record = asObject(value);
        const direct = [
            record.text,
            record.title,
            record.label,
            record.value,
            record.description,
            record.objective,
            record.goal,
            record.summary,
            record.note,
        ].flatMap((item) => toTextItems(item));
        if (direct.length > 0) return direct;
    }
    return [];
};

const collectItems = (source, keys) => uniqueStrings(keys.flatMap((key) => toTextItems(source?.[key])));

const toLocalizedList = (items) => uniqueStrings(items).map((item) => toLocalizedText(item));

const buildSection = (id, title, content) => ({
    id,
    title: toLocalizedText(title),
    content,
});

const buildTextBlock = (text, style = 'normal') => ({
    type: 'text',
    text: toLocalizedText(text),
    style,
});

const buildListBlock = (items, style = 'bullet') => ({
    type: 'list',
    items: toLocalizedList(items),
    style,
});

const buildCalloutBlock = (title, text, variant) => ({
    type: 'callout',
    title: toLocalizedText(title),
    text: toLocalizedText(text),
    variant,
});

const parseStructuredText = (value) => {
    const text = cleanString(value);
    if (!text) return { intro: '', segments: {} };

    const labelToKey = new Map();
    const labelPatterns = [];
    for (const definition of MARKER_DEFINITIONS) {
        for (const label of definition.labels) {
            labelToKey.set(label.toLowerCase(), definition.key);
            labelPatterns.push(escapeRegExp(label));
        }
    }

    const markerRegex = new RegExp(`(${labelPatterns.join('|')})\\s*[:：]`, 'gi');
    const matches = Array.from(text.matchAll(markerRegex)).map((match) => ({
        key: labelToKey.get(match[1].toLowerCase()),
        index: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
    })).filter((match) => match.key);

    if (matches.length === 0) {
        return { intro: text, segments: {} };
    }

    const intro = cleanString(text.slice(0, matches[0].index));
    const segments = {};
    matches.forEach((match, index) => {
        const next = matches[index + 1];
        const rawSegment = text.slice(match.end, next ? next.index : text.length);
        const cleanedSegment = cleanString(rawSegment);
        if (!cleanedSegment) return;
        if (!segments[match.key]) segments[match.key] = [];
        segments[match.key].push(cleanedSegment);
    });

    return { intro, segments };
};

const mergeSegmentItems = (...values) => uniqueStrings(values.flatMap((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap((item) => toTextItems(item));
    return toTextItems(value);
}));

const normalizeLessonSource = ({ lesson, module }) => {
    const parsedObjective = parseStructuredText(lesson.objective);
    const parsedSummary = parseStructuredText(lesson.summary);
    const parsedDescription = parseStructuredText(lesson.description);
    const parsedExplanation = parseStructuredText(lesson.explanation);

    return {
        introText:
            parsedExplanation.intro
            || cleanString(lesson.explanation)
            || parsedSummary.intro
            || parsedDescription.intro
            || parsedObjective.intro
            || cleanString(lesson.objective)
            || cleanString(module.goal)
            || cleanString(module.objective),
        whyText:
            cleanString(lesson.why_it_matters)
            || cleanString(lesson.why)
            || cleanString(lesson.context),
        summaryText:
            parsedSummary.intro
            || cleanString(lesson.summary)
            || parsedDescription.intro
            || cleanString(lesson.description),
        learningItems: mergeSegmentItems(
            collectItems(lesson, [
                'content',
                'contents',
                'topics',
                'key_points',
                'keyPoints',
                'concepts',
                'learning_points',
                'takeaways',
            ]),
            parsedObjective.segments.key_points,
            parsedSummary.segments.key_points,
            parsedDescription.segments.key_points
        ),
        exampleItems: mergeSegmentItems(
            collectItems(lesson, ['examples', 'example', 'scenarios', 'applications']),
            parsedObjective.segments.examples,
            parsedSummary.segments.examples,
            parsedDescription.segments.examples
        ),
        practiceItems: mergeSegmentItems(
            collectItems(lesson, [
                'practice',
                'practices',
                'exercise',
                'exercises',
                'activity',
                'activities',
                'steps',
                'tasks',
                'homework',
            ]),
            parsedObjective.segments.practice,
            parsedSummary.segments.practice,
            parsedDescription.segments.practice
        ),
        checklistItems: mergeSegmentItems(
            collectItems(lesson, ['checklist', 'checks', 'self_check', 'self_checks']),
            parsedObjective.segments.checklist,
            parsedSummary.segments.checklist,
            parsedDescription.segments.checklist
        ),
        cautionItems: mergeSegmentItems(
            collectItems(lesson, [
                'caution',
                'cautions',
                'warning',
                'warnings',
                'safety',
                'safety_notes',
                'notes',
            ]),
            parsedObjective.segments.cautions,
            parsedSummary.segments.cautions,
            parsedDescription.segments.cautions
        ),
        reflectionItems: mergeSegmentItems(
            collectItems(lesson, [
                'reflection',
                'reflections',
                'reflection_prompts',
                'output',
                'outputs',
                'deliverable',
                'deliverables',
                'assignment',
            ]),
            parsedObjective.segments.reflection,
            parsedSummary.segments.reflection,
            parsedDescription.segments.reflection
        ),
        takeawayText:
            cleanString(lesson.takeaway)
            || cleanString(lesson.summary_takeaway)
            || mergeSegmentItems(
                parsedObjective.segments.takeaway,
                parsedSummary.segments.takeaway,
                parsedDescription.segments.takeaway
            ).join('\n'),
    };
};

const resolveEstimatedMinutes = (lesson) => {
    const candidates = [
        lesson?.estimated_min,
        lesson?.estimated_minutes,
        lesson?.minutes,
        lesson?.duration_minutes,
    ];
    for (const value of candidates) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
    return 15;
};

const resolveEstimatedHours = (module, lessons) => {
    const direct = Number(module?.estimated_hours);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const totalMinutes = lessons.reduce((sum, lesson) => sum + (lesson.estimated_min || 0), 0);
    if (totalMinutes <= 0) return 1;
    return Math.max(1, Math.round((totalMinutes / 60) * 10) / 10);
};

// Learning mode section builders for mode-specific additions
const buildModeSpecificSections = ({ normalized, learningMode }) => {
    const extra = [];
    if (learningMode === 'credential') {
        // Add "what you will be able to do" at the top
        extra.push({
            key: 'achievement',
            section: buildSection('achievement', 'このレッスンでできるようになること', [
                buildCalloutBlock('到達目標', normalized.introText || '基本事項を理解し確認できる', 'success'),
            ]),
            position: 'before_overview',
        });
    }
    if (learningMode === 'gentle') {
        // Add reassurance at the end
        extra.push({
            key: 'reassurance',
            section: buildSection('reassurance', 'おつかれさまでした', [
                buildCalloutBlock('今日はここまで', '今日はここまでで十分です。次回も自分のペースで進みましょう。', 'tip'),
            ]),
            position: 'after_takeaway',
        });
    }
    if (learningMode === 'problem_solving') {
        // Add opening problem if examples exist
        if (normalized.exampleItems.length > 0) {
            extra.push({
                key: 'opening_problem',
                section: buildSection('opening-problem', 'まず考えてみよう', [
                    buildCalloutBlock('問い', normalized.exampleItems[0], 'info'),
                ]),
                position: 'before_overview',
            });
        }
    }
    return extra;
};

const SECTION_ORDER_MAP = {
    overview: 'overview',
    'key-points': 'key_points',
    key_points: 'key_points',
    examples: 'examples',
    practice: 'practice',
    checklist: 'checklist',
    cautions: 'cautions',
    reflection: 'reflection',
    takeaway: 'takeaway',
    achievement: 'achievement',
    reassurance: 'reassurance',
    'opening-problem': 'opening_problem',
    opening_problem: 'opening_problem',
};

const sectionSortKey = (sectionId, sectionOrder) => {
    // Strip trailing -N index
    const base = sectionId.replace(/-\d+$/, '');
    const normalized = SECTION_ORDER_MAP[base] || base;
    const idx = sectionOrder.indexOf(normalized);
    return idx >= 0 ? idx : sectionOrder.length;
};

// Explain Like Me: explanation_style -> section order (used when learningMode is 'default')
const EXPLANATION_STYLE_ORDERS = {
    example_then_principle: ['overview', 'examples', 'key_points', 'practice', 'checklist', 'cautions', 'reflection', 'takeaway'],
    principle_then_example: ['overview', 'key_points', 'examples', 'practice', 'checklist', 'cautions', 'reflection', 'takeaway'],
    compare_then_choose: ['overview', 'examples', 'key_points', 'practice', 'cautions', 'reflection', 'takeaway'],
    story_then_structure: ['overview', 'examples', 'key_points', 'practice', 'cautions', 'reflection', 'takeaway'],
};

const buildLessonSections = ({ lesson, module, learningMode, explanationStyle }) => {
    const normalized = normalizeLessonSource({ lesson, module });

    const sections = [];
    const overviewBlocks = [];
    if (normalized.introText) {
        overviewBlocks.push(buildTextBlock(normalized.introText, 'lead'));
    }
    if (normalized.summaryText && normalized.summaryText !== normalized.introText) {
        overviewBlocks.push(buildTextBlock(normalized.summaryText));
    }
    if (normalized.whyText) {
        overviewBlocks.push(buildCalloutBlock('このレッスンが大事な理由', normalized.whyText, 'info'));
    }
    if (overviewBlocks.length > 0) {
        sections.push(buildSection('overview', '学ぶ内容', overviewBlocks));
    }

    if (normalized.learningItems.length > 0) {
        sections.push(buildSection('key-points', 'ポイント整理', [
            buildListBlock(normalized.learningItems, 'key'),
        ]));
    }

    if (normalized.exampleItems.length > 0) {
        sections.push(buildSection('examples', '具体例', [
            buildListBlock(normalized.exampleItems, 'bullet'),
        ]));
    }

    if (normalized.practiceItems.length > 0) {
        const practiceLabel = learningMode === 'gentle' ? '試してみよう（軽めに）' : '軽い実践';
        sections.push(buildSection('practice', practiceLabel, [
            buildListBlock(normalized.practiceItems, 'check'),
        ]));
    }

    if (normalized.checklistItems.length > 0) {
        sections.push(buildSection('checklist', '確認ポイント', [
            buildListBlock(normalized.checklistItems, 'check'),
        ]));
    }

    if (normalized.cautionItems.length > 0) {
        const cautionBlocks = [buildCalloutBlock('注意点', normalized.cautionItems.join('\n'), 'warning')];
        if (learningMode === 'gentle') {
            cautionBlocks.push(buildCalloutBlock('でも大丈夫', 'ひとつずつ確認すれば問題ありません。', 'tip'));
        }
        sections.push(buildSection('cautions', '注意点', cautionBlocks));
    }

    if (normalized.reflectionItems.length > 0) {
        sections.push(buildSection('reflection', '振り返り・アウトプット', [
            buildListBlock(normalized.reflectionItems, 'bullet'),
        ]));
    }

    if (normalized.takeawayText) {
        sections.push(buildSection('takeaway', 'このレッスンのまとめ', [
            buildCalloutBlock('まとめ', normalized.takeawayText, 'success'),
        ]));
    }

    if (sections.length === 0) {
        sections.push(buildSection('overview', '学ぶ内容', [
            buildTextBlock(normalized.introText || 'このレッスンでは基本事項を確認します。', 'lead'),
        ]));
    }

    // Add mode-specific sections
    const modeExtras = buildModeSpecificSections({ normalized, learningMode });
    for (const extra of modeExtras) {
        if (extra.position === 'before_overview') {
            sections.unshift(extra.section);
        } else {
            sections.push(extra.section);
        }
    }

    // Reorder sections based on learning mode's section_order
    const MODE_SECTION_ORDERS = {
        credential: ['achievement', 'overview', 'key_points', 'examples', 'checklist', 'practice', 'cautions', 'reflection', 'takeaway'],
        practice: ['overview', 'examples', 'practice', 'key_points', 'cautions', 'reflection', 'takeaway'],
        problem_solving: ['opening_problem', 'overview', 'examples', 'key_points', 'practice', 'checklist', 'cautions', 'reflection', 'takeaway'],
        gentle: ['overview', 'examples', 'key_points', 'cautions', 'practice', 'takeaway', 'reassurance'],
    };
    const order = MODE_SECTION_ORDERS[learningMode]
        || (explanationStyle && EXPLANATION_STYLE_ORDERS[explanationStyle])
        || null;
    if (order) {
        sections.sort((a, b) => sectionSortKey(a.id, order) - sectionSortKey(b.id, order));
    }

    return sections.map((section, index) => ({
        ...section,
        id: `${section.id.replace(/-\d+$/, '')}-${index + 1}`,
    }));
};

const adaptDocChapterLesson = ({ lesson, module, moduleIndex, lessonIndex, learningMode, explanationStyle }) => {
    const estimatedMin = resolveEstimatedMinutes(lesson);
    const title = cleanString(lesson.title) || `Lesson ${lessonIndex + 1}`;
    const subtitle =
        cleanString(lesson.summary)
        || cleanString(lesson.objective)
        || cleanString(lesson.description)
        || cleanString(module.goal)
        || '';

    return {
        lesson_id: `m${moduleIndex + 1}-l${lessonIndex + 1}`,
        title: toLocalizedText(title, title),
        subtitle: toLocalizedText(subtitle, subtitle || title),
        reading_time: toLocalizedText(`${estimatedMin}分`, `${estimatedMin} min`),
        estimated_min: estimatedMin,
        sections: buildLessonSections({ lesson, module, learningMode, explanationStyle }),
        ui_hints: {
            card_title: title,
            card_text: subtitle,
            cta: 'Start',
            difficulty: 'easy',
            time: `${estimatedMin} min`,
            tags: collectItems(lesson, ['tags', 'keywords']),
        },
    };
};

const adaptDocChapterModule = ({ module, moduleIndex, learningMode, explanationStyle }) => {
    const normalizedModule = asObject(module);
    const lessons = asArray(normalizedModule.lessons).map((lesson, lessonIndex) =>
        adaptDocChapterLesson({
            lesson: asObject(lesson),
            module: normalizedModule,
            moduleIndex,
            lessonIndex,
            learningMode,
            explanationStyle,
        })
    );
    const title = cleanString(normalizedModule.title) || `Module ${moduleIndex + 1}`;
    const objective =
        cleanString(normalizedModule.goal)
        || cleanString(normalizedModule.objective)
        || '';

    return {
        module_id: `m${moduleIndex + 1}`,
        title: toLocalizedText(title, title),
        objective: toLocalizedText(objective, objective || title),
        estimated_hours: resolveEstimatedHours(normalizedModule, lessons),
        lessons,
        module_ui_hints: {
            card_title: title,
            card_text: objective,
            tags: collectItems(normalizedModule, ['tags', 'keywords']),
            difficulty: 'easy',
        },
    };
};

export const resolveCurriculumUiTemplate = (requestedTemplateId) => {
    const normalized = cleanString(requestedTemplateId).toLowerCase();
    if (!normalized || normalized === 'default' || normalized === 'doc_chapter') {
        return DEFAULT_UI_TEMPLATE_ID;
    }
    return DEFAULT_UI_TEMPLATE_ID;
};

export const adaptCurriculumDraftForSave = ({
    curriculum,
    curriculumId,
    templateId,
    title,
    description,
    learningMode,
    explanationStyle,
}) => {
    const normalizedCurriculum = asObject(curriculum);
    const modules = asArray(normalizedCurriculum.modules).map((module, moduleIndex) =>
        adaptDocChapterModule({ module, moduleIndex, learningMode, explanationStyle })
    );

    return {
        curriculum_id: curriculumId,
        ui_template_id: resolveCurriculumUiTemplate(templateId),
        title: toLocalizedText(
            normalizedCurriculum.title,
            title || cleanString(normalizedCurriculum.title) || 'Generated Curriculum'
        ),
        description: toLocalizedText(
            normalizedCurriculum.summary || normalizedCurriculum.description,
            description || cleanString(normalizedCurriculum.summary) || ''
        ),
        modules,
    };
};
