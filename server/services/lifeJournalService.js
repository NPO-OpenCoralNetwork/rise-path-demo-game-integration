// Life Journal Service — daily reflections + lifestyle logs
// Phase 16-1: validation, upsert, daily/range reads with learning metrics join

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const cleanString = (v) => (typeof v === 'string' ? v.trim() : '');

export const VALID_MOODS = ['great', 'good', 'okay', 'struggled'];
export const VALID_EXERCISE_INTENSITIES = ['none', 'light', 'moderate', 'hard'];
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const MAX_RANGE_DAYS = 366;

export const moodToScore = (mood) => {
    const map = { great: 5, good: 4, okay: 3, struggled: 2 };
    return map[mood] ?? null;
};

export const getTodayInTimezone = (timezone = DEFAULT_TIMEZONE) => {
    const tzCheck = validateTimezone(timezone);
    const tz = tzCheck.valid ? tzCheck.normalized : DEFAULT_TIMEZONE;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
};

export const validateEntryDate = (date) => {
    const d = cleanString(date);
    if (!d) return { valid: false, errors: ['date is required'] };
    if (!DATE_RE.test(d)) return { valid: false, errors: ['date must be YYYY-MM-DD'] };
    const parsed = new Date(`${d}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return { valid: false, errors: ['date is invalid'] };
    // Reject impossible calendar dates (e.g. 2026-02-30 rolls forward in JS Date)
    if (parsed.toISOString().slice(0, 10) !== d) {
        return { valid: false, errors: ['date is invalid'] };
    }
    return { valid: true, errors: [], normalized: d };
};

export const validateWritableEntryDate = (date, timezone = DEFAULT_TIMEZONE) => {
    const base = validateEntryDate(date);
    if (!base.valid) return base;

    const today = getTodayInTimezone(timezone);
    if (base.normalized > today) {
        return { valid: false, errors: ['date cannot be in the future'] };
    }

    return base;
};

export const validateDateRange = (from, to) => {
    const fromCheck = validateEntryDate(from);
    const toCheck = validateEntryDate(to);
    const errors = [];

    if (!fromCheck.valid) errors.push(...fromCheck.errors.map((e) => `from: ${e}`));
    if (!toCheck.valid) errors.push(...toCheck.errors.map((e) => `to: ${e}`));

    if (fromCheck.valid && toCheck.valid) {
        if (fromCheck.normalized > toCheck.normalized) {
            errors.push('from must be <= to');
        } else {
            const fromMs = new Date(`${fromCheck.normalized}T12:00:00Z`).getTime();
            const toMs = new Date(`${toCheck.normalized}T12:00:00Z`).getTime();
            const spanDays = Math.floor((toMs - fromMs) / 86400000) + 1;
            if (spanDays > MAX_RANGE_DAYS) {
                errors.push(`date range must not exceed ${MAX_RANGE_DAYS} days`);
            }
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors };
    }

    return {
        valid: true,
        errors: [],
        from: fromCheck.normalized,
        to: toCheck.normalized,
    };
};

export const validateTimezone = (timezone) => {
    const tz = cleanString(timezone) || DEFAULT_TIMEZONE;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return { valid: true, errors: [], normalized: tz };
    } catch {
        return { valid: false, errors: [`timezone is invalid: ${timezone}`] };
    }
};

const validateScale = (value, field, errors) => {
    if (value === undefined || value === null) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
        errors.push(`${field} must be an integer between 1 and 5`);
    }
};

const validateNonNegativeInt = (value, field, errors) => {
    if (value === undefined || value === null) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
        errors.push(`${field} must be a non-negative integer`);
    }
};

const validateMeals = (meals, errors) => {
    if (meals === undefined || meals === null) return;
    if (typeof meals !== 'object' || Array.isArray(meals)) {
        errors.push('meals must be an object');
        return;
    }
    for (const [meal, data] of Object.entries(meals)) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            errors.push(`meals.${meal} must be an object`);
            continue;
        }
        if (data.balance !== undefined && data.balance !== null) {
            validateScale(data.balance, `meals.${meal}.balance`, errors);
        }
    }
};

export const validateReflection = (reflection) => {
    const r = asObject(reflection);
    const errors = [];

    if (r.mood !== undefined && r.mood !== null && !VALID_MOODS.includes(r.mood)) {
        errors.push(`mood must be one of: ${VALID_MOODS.join(', ')}`);
    }

    validateScale(r.energy, 'energy', errors);
    validateScale(r.focus, 'focus', errors);
    validateScale(r.stress, 'stress', errors);
    validateScale(r.confidence, 'confidence', errors);

    if (r.tags !== undefined && r.tags !== null) {
        if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== 'string')) {
            errors.push('tags must be an array of strings');
        }
    }

    const hasContent = Boolean(
        r.mood || r.energy || r.focus || r.stress || r.confidence
        || cleanString(r.diary_text) || (Array.isArray(r.tags) && r.tags.length > 0),
    );

    return { valid: errors.length === 0, errors, hasContent };
};

export const validateLifestyle = (lifestyle) => {
    const l = asObject(lifestyle);
    const errors = [];

    if (l.sleep_hours !== undefined && l.sleep_hours !== null) {
        const n = Number(l.sleep_hours);
        if (Number.isNaN(n) || n < 0 || n > 24) {
            errors.push('sleep_hours must be between 0 and 24');
        }
    }

    validateScale(l.sleep_quality, 'sleep_quality', errors);
    validateNonNegativeInt(l.exercise_min, 'exercise_min', errors);
    validateNonNegativeInt(l.steps, 'steps', errors);
    validateScale(l.meal_balance, 'meal_balance', errors);
    validateNonNegativeInt(l.hydration_cups, 'hydration_cups', errors);
    validateNonNegativeInt(l.screen_time_before_sleep_min, 'screen_time_before_sleep_min', errors);

    if (l.exercise_intensity !== undefined && l.exercise_intensity !== null
        && !VALID_EXERCISE_INTENSITIES.includes(l.exercise_intensity)) {
        errors.push(`exercise_intensity must be one of: ${VALID_EXERCISE_INTENSITIES.join(', ')}`);
    }

    if (l.caffeine !== undefined && l.caffeine !== null) {
        const c = asObject(l.caffeine);
        if (c.cups !== undefined && c.cups !== null) {
            const cups = Number(c.cups);
            if (Number.isNaN(cups) || cups < 0) errors.push('caffeine.cups must be non-negative');
        }
    }

    validateMeals(l.meals, errors);

    if (l.custom_metrics !== undefined && l.custom_metrics !== null) {
        const cm = asObject(l.custom_metrics);
        if (cm.drink_type !== undefined && cm.drink_type !== null) {
            const validDrinkTypes = ['water', 'coffee', 'tea', 'other'];
            if (!validDrinkTypes.includes(cm.drink_type)) {
                errors.push(`custom_metrics.drink_type must be one of: ${validDrinkTypes.join(', ')}`);
            }
        }
    }

    const hasContent = Object.keys(l).length > 0
        && Object.values(l).some((v) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0));

    return { valid: errors.length === 0, errors, hasContent };
};

export const validateDailyPayload = ({ reflection, lifestyle }) => {
    const errors = [];
    let hasContent = false;

    if (reflection !== undefined) {
        const r = validateReflection(reflection);
        if (!r.valid) errors.push(...r.errors);
        hasContent = hasContent || r.hasContent;
    }

    if (lifestyle !== undefined) {
        const l = validateLifestyle(lifestyle);
        if (!l.valid) errors.push(...l.errors);
        hasContent = hasContent || l.hasContent;
    }

    if (!hasContent) {
        errors.push('At least one reflection or lifestyle field is required');
    }

    return { valid: errors.length === 0, errors };
};

const mapReflectionRow = (row) => {
    if (!row) return null;
    return {
        mood: row.mood,
        energy: row.energy,
        focus: row.focus,
        stress: row.stress,
        confidence: row.confidence,
        diary_text: row.diary_text,
        tags: row.tags || [],
        updated_at: row.updated_at,
    };
};

const mapLifestyleRow = (row) => {
    if (!row) return null;
    return {
        sleep_hours: row.sleep_hours != null ? Number(row.sleep_hours) : null,
        sleep_quality: row.sleep_quality,
        bedtime: row.bedtime,
        wake_time: row.wake_time,
        exercise_min: row.exercise_min,
        exercise_intensity: row.exercise_intensity,
        exercise_type: row.exercise_type,
        steps: row.steps,
        meals: row.meals || {},
        meal_balance: row.meal_balance,
        hydration_cups: row.hydration_cups,
        caffeine: row.caffeine || {},
        alcohol: row.alcohol,
        screen_time_before_sleep_min: row.screen_time_before_sleep_min,
        health_note: row.health_note,
        custom_metrics: row.custom_metrics || {},
        updated_at: row.updated_at,
    };
};

const mapLearningRow = (row) => {
    if (!row || row.journal_entries === 0) {
        return {
            total_learning_min: 0,
            journal_entries: 0,
            avg_confidence: null,
            avg_mood_score: null,
        };
    }
    return {
        total_learning_min: Number(row.total_learning_min) || 0,
        journal_entries: Number(row.journal_entries) || 0,
        avg_confidence: row.avg_confidence != null ? Number(row.avg_confidence) : null,
        avg_mood_score: row.avg_mood_score != null ? Number(row.avg_mood_score) : null,
    };
};

const flattenDay = (date, reflection, lifestyle, learning) => ({
    date,
    mood: reflection?.mood ?? null,
    energy: reflection?.energy ?? null,
    focus: reflection?.focus ?? null,
    stress: reflection?.stress ?? null,
    confidence: reflection?.confidence ?? null,
    diary_text: reflection?.diary_text ?? null,
    tags: reflection?.tags ?? [],
    sleep_hours: lifestyle?.sleep_hours ?? null,
    sleep_quality: lifestyle?.sleep_quality ?? null,
    exercise_min: lifestyle?.exercise_min ?? null,
    exercise_intensity: lifestyle?.exercise_intensity ?? null,
    exercise_type: lifestyle?.exercise_type ?? null,
    meals: lifestyle?.meals ?? {},
    meal_balance: lifestyle?.meal_balance ?? null,
    hydration_cups: lifestyle?.hydration_cups ?? null,
    caffeine: lifestyle?.caffeine ?? {},
    alcohol: lifestyle?.alcohol ?? null,
    total_learning_min: learning.total_learning_min,
    journal_entries: learning.journal_entries,
    avg_confidence: learning.avg_confidence,
    avg_mood_score: learning.avg_mood_score,
});

const learningMetricsSubquery = `
    select
        user_id,
        (created_at at time zone $TIMEZONE$)::date as entry_date,
        coalesce(sum(time_spent_min), 0)::int as total_learning_min,
        count(*)::int as journal_entries,
        round(avg(confidence)::numeric, 2) as avg_confidence,
        round(avg(
            case mood
                when 'great' then 5
                when 'good' then 4
                when 'okay' then 3
                when 'struggled' then 2
            end
        )::numeric, 2) as avg_mood_score
    from learning_journal
    where user_id = cast($1 as uuid)
    group by user_id, (created_at at time zone $TIMEZONE$)::date
`;

export const quoteTimezoneForSql = (timezone) => `'${timezone.replace(/'/g, "''")}'`;

export const buildLearningQuery = (timezone, { bounded = false } = {}) => {
    const tzQuoted = quoteTimezoneForSql(timezone);
    let sql = learningMetricsSubquery.replace(/\$TIMEZONE\$/g, tzQuoted);
    if (bounded) {
        sql = sql.replace(
            'where user_id = cast($1 as uuid)',
            `where user_id = cast($1 as uuid)
    and (created_at at time zone ${tzQuoted})::date between $2::date and $3::date`,
        );
    }
    return sql;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const resolveReflectionValue = (r, key) => {
    if (key === 'diary_text') return cleanString(r.diary_text) || null;
    if (key === 'tags') return Array.isArray(r.tags) ? r.tags : [];
    return r[key] ?? null;
};

const resolveLifestyleValue = (r, key) => {
    if (key === 'meals' || key === 'caffeine' || key === 'custom_metrics') {
        return JSON.stringify(r[key] ?? {});
    }
    return r[key] ?? null;
};

const REFLECTION_COLUMNS = ['mood', 'energy', 'focus', 'stress', 'confidence', 'diary_text', 'tags'];
const LIFESTYLE_COLUMNS = [
    'sleep_hours', 'sleep_quality', 'bedtime', 'wake_time',
    'exercise_min', 'exercise_intensity', 'exercise_type', 'steps',
    'meals', 'meal_balance', 'hydration_cups', 'caffeine', 'alcohol',
    'screen_time_before_sleep_min', 'health_note', 'custom_metrics',
];

const LIFESTYLE_JSONB_COLUMNS = new Set(['meals', 'caffeine', 'custom_metrics']);

const buildPatchUpsert = ({ table, columns, jsonbColumns, payload, userId, entryDate, resolver }) => {
    const present = columns.filter((col) => hasOwn(payload, col));
    const insertCols = ['user_id', 'entry_date', ...columns];
    const insertValues = [
        userId,
        entryDate,
        // Always resolve defaults (e.g. tags → [], meals → {}) so NOT NULL columns are never null on insert.
        ...columns.map((col) => resolver(payload, col)),
    ];
    const insertPlaceholders = [
        'cast($1 as uuid)',
        '$2::date',
        ...columns.map((col, i) => (jsonbColumns.has(col) ? `$${i + 3}::jsonb` : `$${i + 3}`)),
    ];
    const updateSets = present.map((col) => `${col} = excluded.${col}`);
    updateSets.push('updated_at = now()');

    return {
        sql: `insert into ${table} (${insertCols.join(', ')})
            values (${insertPlaceholders.join(', ')})
            on conflict (user_id, entry_date) do update set ${updateSets.join(', ')}`,
        values: insertValues,
    };
};

export async function fetchLearningMetricsForDate(pool, userId, entryDate, timezone = DEFAULT_TIMEZONE) {
    const result = await pool.query(
        `select * from (${buildLearningQuery(timezone)}) lm
         where lm.user_id = cast($1 as uuid) and lm.entry_date = $2::date`,
        [userId, entryDate],
    );
    return mapLearningRow(result.rows[0]);
}

export async function getDailyEntry({ pool, userId, entryDate, timezone = DEFAULT_TIMEZONE }) {
    const [reflectionRes, lifestyleRes, learning] = await Promise.all([
        pool.query(
            `select mood, energy, focus, stress, confidence, diary_text, tags, updated_at
             from daily_reflections
             where user_id = cast($1 as uuid) and entry_date = $2::date`,
            [userId, entryDate],
        ),
        pool.query(
            `select sleep_hours, sleep_quality, bedtime, wake_time,
                    exercise_min, exercise_intensity, exercise_type, steps,
                    meals, meal_balance, hydration_cups, caffeine, alcohol,
                    screen_time_before_sleep_min, health_note, custom_metrics, updated_at
             from lifestyle_logs
             where user_id = cast($1 as uuid) and entry_date = $2::date`,
            [userId, entryDate],
        ),
        fetchLearningMetricsForDate(pool, userId, entryDate, timezone),
    ]);

    const reflection = mapReflectionRow(reflectionRes.rows[0]);
    const lifestyle = mapLifestyleRow(lifestyleRes.rows[0]);

    return {
        date: entryDate,
        reflection,
        lifestyle,
        learning,
        day: flattenDay(entryDate, reflection, lifestyle, learning),
    };
}

export async function upsertDailyEntry({
    pool,
    userId,
    entryDate,
    reflection,
    lifestyle,
    timezone = DEFAULT_TIMEZONE,
}) {
    const client = await pool.connect();
    try {
        await client.query('begin');

        if (reflection !== undefined) {
            const r = asObject(reflection);
            const reflectionUpsert = buildPatchUpsert({
                table: 'daily_reflections',
                columns: REFLECTION_COLUMNS,
                jsonbColumns: new Set(),
                payload: r,
                userId,
                entryDate,
                resolver: resolveReflectionValue,
            });
            await client.query(reflectionUpsert.sql, reflectionUpsert.values);
        }

        if (lifestyle !== undefined) {
            const l = asObject(lifestyle);
            const lifestyleUpsert = buildPatchUpsert({
                table: 'lifestyle_logs',
                columns: LIFESTYLE_COLUMNS,
                jsonbColumns: LIFESTYLE_JSONB_COLUMNS,
                payload: l,
                userId,
                entryDate,
                resolver: resolveLifestyleValue,
            });
            await client.query(lifestyleUpsert.sql, lifestyleUpsert.values);
        }

        await client.query('commit');
    } catch (err) {
        await client.query('rollback');
        throw err;
    } finally {
        client.release();
    }

    return getDailyEntry({ pool, userId, entryDate, timezone });
}

export async function getRangeEntries({ pool, userId, from, to, timezone = DEFAULT_TIMEZONE }) {
    const learningSql = buildLearningQuery(timezone, { bounded: true });

    const result = await pool.query(
        `with dates as (
            select generate_series($2::date, $3::date, interval '1 day')::date as entry_date
         ),
         reflections as (
            select entry_date, mood, energy, focus, stress, confidence, diary_text, tags
            from daily_reflections
            where user_id = cast($1 as uuid)
              and entry_date between $2::date and $3::date
         ),
         lifestyles as (
            select entry_date, sleep_hours, sleep_quality, exercise_min, exercise_intensity,
                   exercise_type, meals, meal_balance, hydration_cups, caffeine, alcohol
            from lifestyle_logs
            where user_id = cast($1 as uuid)
              and entry_date between $2::date and $3::date
         ),
         learning as (
            ${learningSql}
         )
         select d.entry_date as date,
                r.mood, r.energy, r.focus, r.stress, r.confidence, r.diary_text, r.tags,
                l.sleep_hours, l.sleep_quality, l.exercise_min, l.exercise_intensity,
                l.exercise_type, l.meals, l.meal_balance, l.hydration_cups, l.caffeine, l.alcohol,
                coalesce(lm.total_learning_min, 0) as total_learning_min,
                coalesce(lm.journal_entries, 0) as journal_entries,
                lm.avg_confidence,
                lm.avg_mood_score
         from dates d
         left join reflections r on r.entry_date = d.entry_date
         left join lifestyles l on l.entry_date = d.entry_date
         left join learning lm on lm.entry_date = d.entry_date
         order by d.entry_date asc`,
        [userId, from, to],
    );

    const days = result.rows.map((row) => ({
        date: row.date instanceof Date
            ? row.date.toISOString().slice(0, 10)
            : String(row.date).slice(0, 10),
        mood: row.mood,
        energy: row.energy,
        focus: row.focus,
        stress: row.stress,
        confidence: row.confidence,
        diary_text: row.diary_text,
        tags: row.tags || [],
        sleep_hours: row.sleep_hours != null ? Number(row.sleep_hours) : null,
        sleep_quality: row.sleep_quality,
        exercise_min: row.exercise_min,
        exercise_intensity: row.exercise_intensity,
        exercise_type: row.exercise_type,
        meals: row.meals || {},
        meal_balance: row.meal_balance,
        hydration_cups: row.hydration_cups,
        caffeine: row.caffeine || {},
        alcohol: row.alcohol,
        total_learning_min: Number(row.total_learning_min) || 0,
        journal_entries: Number(row.journal_entries) || 0,
        avg_confidence: row.avg_confidence != null ? Number(row.avg_confidence) : null,
        avg_mood_score: row.avg_mood_score != null ? Number(row.avg_mood_score) : null,
    }));

    return { from, to, timezone, days };
}