#!/usr/bin/env node
// @ts-check
/**
 * Staff: study time of job training (doc/brushup-2026/training-plan.ja.md §4.9, D12; tables of
 * server/migrations/022_training_study_time.sql and 023_training_study_time_recounts.sql, logic in
 * tools/core/trainingTime.js, trainingTimeCheck.js and trainingTimeRecount.js).
 *
 * Run it in the school deployment's api container (DATABASE_URL_PHASE1 and TRAINING_ENABLED are
 * already there). The unit list and the rules file are private (D2, D9): they live outside the
 * checkout, readable by root only, and are piped to stdin, so `-T` matters:
 *
 *   sudo cat <private folder>/course.json | docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --load-catalog --by <who> --note <text>
 *   sudo cat <private folder>/time-rules.json | docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --load-rules --by <who> --note <text>
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --set 2026-11-web --catalog <sha256> --rules <sha256> --from YYYY-MM-DD --by <who> --reason <text>
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --show 2026-11-web [--learner <account uuid>]
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --close 2026-11-web [--learner <account uuid>]
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --stats 2026-11-web
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --verify 2026-11-web [--learner <account uuid>]
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --recompute 2026-11-web --from YYYY-MM-DD --to YYYY-MM-DD [--rules <sha256>] [--catalog <sha256>] --by <who> --reason <text> --dry-run
 *   docker compose --env-file stack.env exec -T api node scripts/training-time.mjs --recompute 2026-11-web --from YYYY-MM-DD --to YYYY-MM-DD [--rules <sha256>] [--catalog <sha256>] --by <who> --reason <text> --expect <plan sha256>
 *
 * --load-catalog  a unit list (risepath.training-course/v1) as a version that never changes, named by
 *                 its sha256; the same content again is the version already there.
 * --load-rules    the counting rules the same way. A value is never printed: an error names fields only.
 * --set           a cohort uses a unit list and rules (by sha256) from a Japan-time day: today at the
 *                 earliest, tomorrow once a setting is in effect; never after the cohort's last day;
 *                 once the cohort has study time, only the course in effect today. Settings are only
 *                 added.
 * --show          the cohort's settings and recounts (versions and plans by sha256), or one learner's
 *                 closed days (each with its earlier rows and the recount that wrote each) and units.
 * --close         closes the final days of every learner of the cohort (or one), each in its own
 *                 transaction. The api closes a learner's final days too, when the learner's page
 *                 sends a signal or reads its study time; this closes those of pages that stopped.
 * --stats         the cohort's row counts (marked rows of deleted accounts too) and its last closed day.
 * --verify        checks every closed day of the cohort's learners (or one): the versions it was
 *                 counted with, the setting or recount they came from, its evidence and its values.
 *                 Reads only, in one snapshot per learner, with no advisory lock. Its tables are
 *                 locked for reading first, without waiting: while a migration's DDL holds one (or
 *                 an index of one, for over 20 ms), it holds nothing and tries again, for about 10 s.
 * --recompute     D12: other rules, another unit list, or both (by sha256) for the days from..to;
 *                 every later closed day is counted again with its own versions and the new carry.
 *                 First with --dry-run: it prints each changed day before and after, and the plan's
 *                 sha256, which binds --by and --reason too; nothing is written. The same command
 *                 with --expect <that sha256> instead of --dry-run writes it, only when nothing
 *                 changed since; the old rows stay. Both read as --verify does; the write then holds
 *                 the locks of the learners it counts only while it reads their rows again and
 *                 writes, and waits at most 20 ms for any lock while it holds one.
 *
 * Refuses everything unless TRAINING_ENABLED is exactly "true" here (the public Rise Path stack
 * leaves it unset). Exit: 0 done (or already so), 1 usage, 2 refused, 3 unavailable (database, or a
 * lock busy for 10 s: try again), 4 --verify found a difference or --recompute found closed days that
 * do not check (keep the output in the school; report privately that there was one, without learner
 * data, SECURITY.md).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPool } from '../server/db.js';
import { canonicalUserId } from '../tools/core/accountDeletions.js';
import { COHORT_SLUG } from '../tools/core/training.js';
import {
    closeDays,
    cohortBySlug,
    cohortLearners,
    cohortSettings,
    cohortStats,
    loadCatalog,
    loadRules,
    setCohortTime,
} from '../tools/core/trainingTime.js';
import { sameUnits, verifyCohort } from '../tools/core/trainingTimeCheck.js';
import { cohortRecounts, learnerHistory, planRecount, recountCohort } from '../tools/core/trainingTimeRecount.js';
import { jstDayOf } from '../shared/training/studyTime.js';

export const USAGE = [
    'Usage (the files over stdin):',
    '  node scripts/training-time.mjs --load-catalog --by <who> --note <text> < course.json',
    '  node scripts/training-time.mjs --load-rules --by <who> --note <text> < time-rules.json',
    '  node scripts/training-time.mjs --set <cohort slug> --catalog <sha256> --rules <sha256> --from YYYY-MM-DD --by <who> --reason <text>',
    '  node scripts/training-time.mjs --show <cohort slug> [--learner <account uuid>]',
    '  node scripts/training-time.mjs --close <cohort slug> [--learner <account uuid>]',
    '  node scripts/training-time.mjs --stats <cohort slug>',
    '  node scripts/training-time.mjs --verify <cohort slug> [--learner <account uuid>]',
    '  node scripts/training-time.mjs --recompute <cohort slug> --from YYYY-MM-DD --to YYYY-MM-DD [--rules <sha256>] [--catalog <sha256>] --by <who> --reason <text> (--dry-run | --expect <plan sha256>)',
].join('\n');

export const EXIT = Object.freeze({ ok: 0, usage: 1, refused: 2, unavailable: 3, differs: 4 });

/** The largest file read from stdin (a unit list of 500 units is far below it). */
export const STDIN_LIMIT = 1024 * 1024;

/** How long the script waits for the first bytes of the piped file before it says none was piped. */
export const STDIN_WAIT_MS = 5000;

/** Who closes in a staff run (training_time_days.computed_by). */
export const STAFF_CLOSER = 'staff';

/** What a recount uses where it overrides nothing: each day's own version (its current row's). */
const OWN = "each day's own";

/**
 * @typedef {{
 *   getPool: () => import('../tools/core/training.js').TrainingPool | null,
 *   env: Record<string, string | undefined>,
 *   log: (line: string) => void,
 *   readStdin: () => Promise<string | null>,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} Deps
 *   readStdin: the whole of stdin, or null when nothing was piped (a terminal, or no bytes within STDIN_WAIT_MS)
 *   sleep: the wait between the tries of --verify, --recompute and --show --learner for their locks
 *   (the core module's own when left out)
 */

const MODES = /** @type {const} */ (['loadCatalog', 'loadRules', 'set', 'show', 'close', 'stats', 'verify', 'recompute']);
const MODE_LIST = 'choose exactly one of --load-catalog, --load-rules, --set, --show, --close, --stats, --verify, --recompute';
const FLAGS = Object.freeze({
    '--load-catalog': 'loadCatalog', '--load-rules': 'loadRules', '--set': 'set', '--show': 'show', '--close': 'close', '--stats': 'stats', '--verify': 'verify',
    '--recompute': 'recompute',
    '--by': 'by', '--note': 'note', '--reason': 'reason', '--catalog': 'catalog', '--rules': 'rules', '--from': 'from', '--learner': 'learner',
    '--to': 'to', '--expect': 'expect', '--dry-run': 'dryRun',
});
/** The options each mode takes (and needs). */
const OPTIONS = Object.freeze({
    loadCatalog: { needs: ['by', 'note'], takes: ['by', 'note'] },
    loadRules: { needs: ['by', 'note'], takes: ['by', 'note'] },
    set: { needs: ['catalog', 'rules', 'from', 'by', 'reason'], takes: ['catalog', 'rules', 'from', 'by', 'reason'] },
    show: { needs: [], takes: ['learner'] },
    close: { needs: [], takes: ['learner'] },
    stats: { needs: [], takes: [] },
    verify: { needs: [], takes: ['learner'] },
    recompute: { needs: ['from', 'to', 'by', 'reason'], takes: ['from', 'to', 'rules', 'catalog', 'by', 'reason', 'expect', 'dryRun'] },
});
/** Modes and options that take no value. */
const NO_VALUE = new Set(['loadCatalog', 'loadRules', 'dryRun']);

/** @param {string[]} argv */
export function parseArgs(argv) {
    /** @type {{ mode?: typeof MODES[number], slug?: string, values: Record<string, string>, help: boolean, error?: string }} */
    const out = { values: {}, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            out.help = true;
            continue;
        }
        const name = /** @type {Record<string, string>} */ (FLAGS)[arg];
        if (!name) {
            out.error ??= `unknown argument ${arg}`;
            continue;
        }
        const isMode = /** @type {readonly string[]} */ (MODES).includes(name);
        if (isMode && out.mode) {
            out.error ??= MODE_LIST;
            continue;
        }
        if (isMode && NO_VALUE.has(name)) {
            out.mode = /** @type {any} */ (name);
            continue;
        }
        if (NO_VALUE.has(name)) {
            if (name in out.values) out.error ??= `${arg} is given twice`;
            else out.values[name] = 'yes';
            continue;
        }
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out.error ??= `${arg} needs a value`;
            continue;
        }
        i += 1;
        if (isMode) {
            out.mode = /** @type {any} */ (name);
            out.slug = next;
        } else if (name in out.values) out.error ??= `${arg} is given twice`;
        else out.values[name] = next;
    }
    if (out.error || out.help) return out;
    if (!out.mode) return { ...out, error: MODE_LIST };
    const { needs, takes } = OPTIONS[out.mode];
    const flag = (/** @type {string} */ name) => Object.keys(FLAGS).find((key) => /** @type {Record<string, string>} */ (FLAGS)[key] === name);
    for (const name of Object.keys(out.values)) {
        if (!(/** @type {readonly string[]} */ (takes)).includes(name)) return { ...out, error: `${flag(name)} does not go with ${flag(out.mode)}` };
    }
    for (const name of needs) {
        if (!(name in out.values)) return { ...out, error: `${flag(out.mode)} needs ${flag(name)}` };
    }
    if (out.slug !== undefined && !COHORT_SLUG.test(out.slug)) return { ...out, error: 'a cohort slug takes a-z, 0-9 and "-" (up to 80, not starting with "-")' };
    if (out.values.learner !== undefined && !canonicalUserId(out.values.learner)) return { ...out, error: '--learner needs an account id (a UUID)' };
    if (out.mode === 'recompute') {
        if (('dryRun' in out.values) === ('expect' in out.values)) return { ...out, error: '--recompute needs exactly one of --dry-run or --expect' };
        if (!('rules' in out.values) && !('catalog' in out.values)) return { ...out, error: '--recompute needs --rules, --catalog or both' };
    }
    return out;
}

/** h:mm:ss of a duration. @param {number} ms */
export const hms = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The difference of two durations as hms prints them: of their whole seconds, so it is always the
 * printed after minus the printed before ("±0:00:00" when they print the same).
 * @param {number} before @param {number} after
 */
export const signed = (before, after) => {
    const s = Math.floor(after / 1000) - Math.floor(before / 1000);
    return `${s > 0 ? '+' : s < 0 ? '-' : '±'}${hms(Math.abs(s) * 1000)}`;
};

/**
 * A refusal of the core module: a usage error, or the database (3; a busy lock says so, with what may
 * hold it: a close or an account deletion; for --verify, --show --learner and a recount's dry run,
 * which only read and lock their tables for reading, a migration's DDL; for a recount's write, also
 * the learners' own requests).
 * @param {{ error: string, error_type: string }} result @param {Deps} deps @param {string} [holder]
 */
function failed(result, deps, holder = 'an account deletion or a close may be running') {
    if (result.error_type === 'validation') {
        deps.log(`${result.error}\n${USAGE}`);
        return EXIT.usage;
    }
    if (result.error_type === 'account_busy') {
        deps.log(`Unavailable: a lock was busy for 10 s (${holder}). Try again.`);
        return EXIT.unavailable;
    }
    if (result.error_type === 'invalid_setting') {
        deps.log('Refused: a stored rules or unit list version does not parse with this code. Nothing was changed; ask the developers.');
        return EXIT.refused;
    }
    deps.log(`Unavailable: the database could not do it (${result.error_type}). Try again later.`);
    return EXIT.unavailable;
}

/** The piped file as JSON, or a refusal. @param {Deps} deps @returns {Promise<{ input: unknown } | { code: number }>} */
async function readFile(deps) {
    const text = await deps.readStdin();
    if (text === null) {
        deps.log(`Refused: pipe the file to stdin (sudo cat <file> | docker compose … exec -T api node scripts/training-time.mjs …); nothing arrived within ${STDIN_WAIT_MS / 1000} s.`);
        return { code: EXIT.usage };
    }
    if (Buffer.byteLength(text, 'utf8') > STDIN_LIMIT) {
        deps.log(`Refused: the file is larger than ${STDIN_LIMIT} bytes.`);
        return { code: EXIT.refused };
    }
    try {
        return { input: JSON.parse(text) };
    } catch {
        deps.log('Refused: the file is not JSON.');
        return { code: EXIT.refused };
    }
}

/** @param {'catalog' | 'rules'} kind @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function loadOne(kind, args, deps) {
    const file = await readFile(deps);
    if ('code' in file) return file.code;
    const params = { input: file.input, loadedBy: args.values.by, note: args.values.note, pool: deps.getPool() };
    const result = kind === 'catalog' ? await loadCatalog(params) : await loadRules(params);
    if ('error_type' in result) return failed(result, deps);
    if (result.status === 'invalid') {
        deps.log(`Refused: the ${kind === 'catalog' ? 'unit list' : 'rules file'} is not valid (${result.errors.join('; ')}). Nothing was loaded.`);
        return EXIT.refused;
    }
    const what = 'courseKey' in result ? `the unit list ${result.courseKey} (${result.units} unit(s))` : `the rules (${result.algorithm})`;
    deps.log(result.status === 'loaded'
        ? `Loaded ${what} as version ${result.id}, sha256 ${result.sha256}.`
        : `Already loaded: ${what} is version ${result.id}, sha256 ${result.sha256}. Nothing changed.`);
    return EXIT.ok;
}

/** @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function setOne(args, deps) {
    const slug = String(args.slug);
    const { catalog, rules, from, by, reason } = args.values;
    const result = await setCohortTime({ cohortSlug: slug, catalogSha256: catalog, rulesSha256: rules, effectiveFrom: from, setBy: by, reason, pool: deps.getPool() });
    if ('error_type' in result) return failed(result, deps);
    switch (result.status) {
        case 'set':
            deps.log(`Cohort ${slug} uses unit list ${catalog.slice(0, 12)}… and rules ${rules.slice(0, 12)}… from ${result.effectiveFrom} (setting ${result.id}).`);
            return EXIT.ok;
        case 'no_cohort':
            deps.log(`Refused: there is no cohort ${slug}.`);
            return EXIT.refused;
        case 'no_dates':
            deps.log(`Refused: ${slug} has no start and end dates; study time counts nothing in it.`);
            return EXIT.refused;
        case 'no_catalog':
            deps.log('Refused: no unit list has that sha256 (--load-catalog first).');
            return EXIT.refused;
        case 'no_rules':
            deps.log('Refused: no rules have that sha256 (--load-rules first).');
            return EXIT.refused;
        case 'past':
            deps.log(`Refused: ${from} is before today (${result.today}, Japan time).`);
            return EXIT.refused;
        case 'in_effect_today':
            deps.log(`Refused: a setting is already in effect today (${result.today}); a new one starts tomorrow at the earliest.`);
            return EXIT.refused;
        case 'after_end':
            deps.log(`Refused: ${from} is after the cohort's last day.`);
            return EXIT.refused;
        default:
            deps.log(`Refused: ${slug} already has study time under the course ${result.courseKey}; a new setting keeps that course.`);
            return EXIT.refused;
    }
}

/**
 * The cohort of a slug, or the exit code.
 * @param {string} slug @param {Deps} deps
 * @returns {Promise<{ code: number } | { cohort: { id: string, slug: string, name: string, startsOn: string | null, endsOn: string | null } }>}
 */
async function cohortOf(slug, deps) {
    const found = await cohortBySlug({ cohortSlug: slug, pool: deps.getPool() });
    if (found === null) {
        deps.log(`Refused: there is no cohort ${slug}.`);
        return { code: EXIT.refused };
    }
    if ('error_type' in found) return { code: failed(found, deps) };
    return { cohort: found };
}

/** @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function showOne(args, deps) {
    const found = await cohortOf(String(args.slug), deps);
    if ('code' in found) return found.code;
    const { cohort } = found;
    if (args.values.learner !== undefined) {
        // Every live row, in day and id order: a day's current value is its last row, and the
        // earlier ones stay (D12). No row's time is printed (D9).
        const result = await learnerHistory({ userId: args.values.learner, cohortId: cohort.id, pool: deps.getPool(), sleep: deps.sleep });
        if ('error_type' in result) return failed(result, deps, 'a migration may be running');
        /** @type {Map<string, typeof result.rows>} */
        const byDay = new Map();
        for (const row of result.rows) {
            const rows = byDay.get(row.day);
            if (rows) rows.push(row);
            else byDay.set(row.day, [row]);
        }
        const days = [...byDay.keys()];
        deps.log(`${result.userId} in ${cohort.slug}: ${days.length} closed day(s)${days.length ? `, through ${days.at(-1)}` : ''}`);
        for (const rows of byDay.values()) {
            const d = rows[rows.length - 1];
            deps.log(`  ${d.day}  ${hms(d.countedMs).padStart(9)}  over the set time ${hms(d.overCapMs)}  signals ${d.signals}${d.kind === 'close' ? '' : `  (recount ${d.recomputeId ?? '-'})`}`);
            for (const r of rows.slice(0, -1)) {
                deps.log(`    earlier: ${hms(r.countedMs)}, over the set time ${hms(r.overCapMs)}, ${r.kind === 'close' ? 'closed' : `recount ${r.recomputeId ?? '-'}`} by ${r.computedBy}`);
            }
        }
        for (const u of result.units) deps.log(`  unit ${u.unitKey}: ${hms(u.countedMs)} counted, ${hms(u.overCapMs)} over the set time`);
        return EXIT.ok;
    }
    const settings = await cohortSettings({ cohortId: cohort.id, pool: deps.getPool() });
    if ('error_type' in settings) return failed(settings, deps);
    const recounts = await cohortRecounts({ cohortId: cohort.id, pool: deps.getPool() });
    if ('error_type' in recounts) return failed(recounts, deps);
    const today = jstDayOf((deps.now ?? Date.now)());
    const current = settings.filter((s) => s.effectiveFrom <= today).at(-1);
    deps.log(`${cohort.slug} (${cohort.id}): ${cohort.name}, ${cohort.startsOn ?? '-'} … ${cohort.endsOn ?? '-'}, ${settings.length} setting(s), ${recounts.length} recount(s)${current ? '' : '; none in effect today: nothing is counted'}`);
    for (const s of settings) {
        deps.log(`  from ${s.effectiveFrom}${s === current ? ' (in effect today)' : ''}: unit list ${s.courseKey} (${s.units} unit(s)) ${s.catalogSha256}, rules ${s.algorithm} ${s.rulesSha256}; set ${s.setAt ?? '-'} by ${s.setBy}: ${s.reason}`);
    }
    for (const r of recounts) {
        deps.log(`  recount ${r.id}, ${r.fromDay} … ${r.toDay}: rules ${r.rulesSha256 ?? OWN}, unit list ${r.catalogSha256 ?? OWN}; plan ${r.planSha256}; ${r.recomputedAt ?? '-'} by ${r.recomputedBy}: ${r.reason}`);
    }
    return EXIT.ok;
}

/** @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function closeSome(args, deps) {
    const found = await cohortOf(String(args.slug), deps);
    if ('code' in found) return found.code;
    const { cohort } = found;
    /** @type {string[] | import('../tools/core/dbTransaction.js').CoreError} */
    const learners = args.values.learner !== undefined
        ? [/** @type {string} */ (canonicalUserId(args.values.learner))]
        : await cohortLearners({ cohortId: cohort.id, pool: deps.getPool() });
    if ('error_type' in learners) return failed(learners, deps);
    /** @type {number} */
    let code = EXIT.ok;
    let closed = 0;
    for (const userId of learners) {
        const result = await closeDays({ userId, cohortId: cohort.id, computedBy: STAFF_CLOSER, pool: deps.getPool() });
        if ('error_type' in result) {
            deps.log(`${userId}: not closed.`);
            code = Math.max(code, failed(result, deps));
            continue;
        }
        if (result.status === 'closed') {
            closed += result.days;
            deps.log(`${userId}: closed ${result.days} day(s), ${result.fromDay} … ${result.toDay}`);
        } else deps.log(`${userId}: nothing to close (${result.reason})`);
    }
    deps.log(`${cohort.slug}: ${learners.length} learner(s), ${closed} day(s) closed.`);
    return code;
}

/** What a difference found by --verify is, in a line (no rule value). @param {import('../tools/core/trainingTimeCheck.js').Difference} d */
function differenceLine(d) {
    const detail = /** @type {any} */ (d.detail);
    switch (d.what) {
        case 'values':
            if (detail.stored.countedMs === detail.counted.countedMs && detail.stored.overCapMs === detail.counted.overCapMs) return `  ${d.day}: the time per unit differs (the day's totals match)`;
            return `  ${d.day}: the values differ: stored ${hms(detail.stored.countedMs)} (over the set time ${hms(detail.stored.overCapMs)}), counted ${hms(detail.counted.countedMs)} (over the set time ${hms(detail.counted.overCapMs)})`;
        case 'evidence':
            return `  ${d.day}: the evidence differs from when it was counted (signals ${detail.stored} then, ${detail.found} now, or their content)`;
        case 'setting':
            return `  ${d.day}: its versions are not the cohort's setting of that day`;
        case 'recount':
            return `  ${d.day}: its versions are not those of its recount ${detail.recount ?? '-'}`;
        default:
            // 'version', by its cause (tools/core/trainingTimeCheck.js versionCause).
            if (detail.cause === 'unparsed') return `  ${d.day}: its rules or unit list version does not parse with this code`;
            if (detail.cause === 'rules_row') return `  ${d.day}: its rules row names ${detail.rulesAlgorithm}, another algorithm than its rules`;
            if (detail.cause === 'row') return `  ${d.day}: counted with ${detail.algorithm}, not with its rules' algorithm (${detail.rulesAlgorithm})`;
            return `  ${d.day}: its rules are ${detail.rulesAlgorithm}, which this code cannot count`;
    }
}

/** @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function verifyOne(args, deps) {
    const slug = String(args.slug);
    const result = await verifyCohort({ cohortSlug: slug, learner: args.values.learner, pool: deps.getPool(), sleep: deps.sleep });
    if ('error_type' in result) return failed(result, deps, 'a migration may be running');
    if (result.status !== 'checked') {
        deps.log(result.status === 'no_cohort' ? `Refused: there is no cohort ${slug}.` : `Refused: ${args.values.learner} is not a learner of ${slug}.`);
        return EXIT.refused;
    }
    let days = 0;
    let differences = 0;
    let learners = 0;
    for (const l of result.learners) {
        days += l.days;
        differences += l.differences.length;
        if (!l.differences.length) {
            deps.log(`${l.userId}: ok (${l.days} day(s))`);
            continue;
        }
        learners += 1;
        deps.log(`${l.userId}: ${l.differences.length} difference(s) in ${l.days} day(s)`);
        for (const d of l.differences) deps.log(differenceLine(d));
    }
    if (!differences) {
        deps.log(`Checked ${slug}: ${result.learners.length} learner(s), ${days} day(s); all match.`);
        return EXIT.ok;
    }
    deps.log(`Checked ${slug}: ${result.learners.length} learner(s), ${days} day(s); ${differences} difference(s) in ${learners} learner(s). Keep this output in the school (learners' ids and times); report privately (SECURITY.md) that --verify found differences, without learner data, and change nothing until they are understood.`);
    return EXIT.differs;
}

/** @typedef {import('../tools/core/trainingTimeCheck.js').Units} Units */

/** A version's sha256 as a recount's day line shows it. @param {string | null} sha */
const shortSha = (sha) => (sha ? `${sha.slice(0, 12)}…` : '-');

/**
 * A changed day's units, one line each (every unit of the day before or after, in code-unit order).
 * @param {Units} before @param {Units} after
 */
function unitLines(before, after) {
    const keys = [...new Set([...before.map((u) => u[0]), ...after.map((u) => u[0])])].sort();
    const of = (/** @type {Units} */ units, /** @type {string} */ key) => units.find((u) => u[0] === key) ?? [key, 0, 0];
    return keys.map((key) => {
        const [, c1, o1] = of(before, key);
        const [, c2, o2] = of(after, key);
        return `    unit ${key}: ${hms(c1)} → ${hms(c2)} counted, ${hms(o1)} → ${hms(o2)} over the set time`;
    });
}

/**
 * A recount's dry run: who, why and the overrides as the plan binds them, each changed day before
 * and after (its versions when they change, its units when they differ), the totals and the plan's
 * sha256. No instant and no rule value.
 * @param {import('../tools/core/trainingTimeRecount.js').RecountPlan} plan @param {string} slug @param {Deps} deps
 */
function printPlan(plan, slug, deps) {
    const p = plan.plan;
    deps.log(`Recount of ${slug}, ${p.from} … ${p.to}: rules ${p.rules ?? OWN}, unit list ${p.catalog ?? OWN}; by ${p.by}: ${p.reason}`);
    let days = 0;
    let before = 0;
    let after = 0;
    for (const l of plan.learners) {
        deps.log(`${l.userId}: ${l.days.length} day(s)`);
        for (const d of l.days) {
            days += 1;
            before += d.before.countedMs;
            after += d.after.countedMs;
            const versions = [
                d.before.rules === d.after.rules ? '' : `; rules ${shortSha(d.before.rules)} → ${shortSha(d.after.rules)}`,
                d.before.catalog === d.after.catalog ? '' : `; unit list ${shortSha(d.before.catalog)} → ${shortSha(d.after.catalog)}`,
            ].join('');
            deps.log(`  ${d.day}  ${hms(d.before.countedMs)} → ${hms(d.after.countedMs)} (${signed(d.before.countedMs, d.after.countedMs)}), over the set time ${hms(d.before.overCapMs)} → ${hms(d.after.overCapMs)}${versions}`);
            if (!sameUnits(d.before.units, d.after.units)) for (const line of unitLines(d.before.units, d.after.units)) deps.log(line);
        }
    }
    if (!days) {
        deps.log('No day changes; nothing to write.');
        deps.log(`Plan sha256 ${plan.sha256}.`);
        return;
    }
    deps.log(`${plan.learners.length} learner(s), ${days} day(s) change: counted ${hms(before)} → ${hms(after)} (${signed(before, after)}).`);
    deps.log(`Plan sha256 ${plan.sha256}. Nothing was written. To write it, run the same command with --expect ${plan.sha256} instead of --dry-run.`);
}

/** Why a version given by --rules or --catalog cannot be counted with (trainingTimeCheck.js rulesCause). */
const VERSION_CAUSES = Object.freeze({
    unknown: 'a version this code does not have',
    rules_row: 'a version whose rules row names another algorithm than its rules',
    unparsed: 'a version that does not parse with this code',
});

/**
 * A recount's refusal, in lines (a day, never an instant; no sha256), and its exit code: 4 for
 * closed days that do not check, else 2.
 * @param {import('../tools/core/trainingTimeRecount.js').RecountRefusal | { status: 'plan_changed' }} result
 * @param {ReturnType<typeof parseArgs>} args @param {Deps} deps
 */
function recountRefused(result, args, deps) {
    const slug = String(args.slug);
    switch (result.status) {
        case 'no_cohort':
            deps.log(`Refused: there is no cohort ${slug}.`);
            return EXIT.refused;
        case 'no_dates':
            deps.log(`Refused: ${slug} has no start and end dates; study time counts nothing in it.`);
            return EXIT.refused;
        case 'outside_dates':
            deps.log(`Refused: ${args.values.from} … ${args.values.to} is not within ${slug}'s dates.`);
            return EXIT.refused;
        case 'no_rules':
            deps.log('Refused: no rules have that sha256 (--load-rules first).');
            return EXIT.refused;
        case 'no_catalog':
            deps.log('Refused: no unit list has that sha256 (--load-catalog first).');
            return EXIT.refused;
        case 'invalid_version':
            deps.log(`Refused: ${result.which === 'catalog' ? '--catalog' : '--rules'} names ${VERSION_CAUSES[result.cause] ?? VERSION_CAUSES.unparsed}; ask the developers.`);
            return EXIT.refused;
        case 'not_final':
            deps.log(`Refused: ${result.day} is not final yet${args.values.rules ? ' under those rules or its own' : ''}. Try again later.`);
            return EXIT.refused;
        case 'not_closed':
            deps.log(`Refused: ${result.learners.length} learner(s) have days up to ${args.values.to} that are not closed. Run --close ${slug} first, or wait until those days are final: ${result.learners.join(', ')}`);
            return EXIT.refused;
        case 'course_differs':
            deps.log(`Refused: the --catalog unit list is of another course than ${result.day}'s own; a recount keeps each day's course.`);
            return EXIT.refused;
        case 'unverified':
            deps.log(`Refused: ${result.learners.length} learner(s) have closed days that do not check (as --verify ${slug} finds them).`);
            for (const l of result.learners) {
                deps.log(`${l.userId}: ${l.differences.length} difference(s)`);
                for (const d of l.differences) deps.log(differenceLine(d));
            }
            deps.log("Keep this output in the school (learners' ids and times); report privately (SECURITY.md) that --recompute found closed days that do not check, without learner data, and recount nothing until they are understood.");
            return EXIT.differs;
        default:
            deps.log('Refused: the plan is not the one confirmed: something changed since the dry run, or --from, --to, --rules, --catalog, --by or --reason differ. Nothing was written; run --dry-run again and review it.');
            return EXIT.refused;
    }
}

/** @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function recomputeOne(args, deps) {
    const slug = String(args.slug);
    const { from, to, rules, catalog, by, reason, expect } = args.values;
    const input = { cohortSlug: slug, fromDay: from, toDay: to, rulesSha256: rules, catalogSha256: catalog, recomputedBy: by, reason, pool: deps.getPool(), sleep: deps.sleep };
    if (expect === undefined) {
        const plan = await planRecount(input);
        // The dry run only reads, locking its tables for reading (as --verify).
        if ('error_type' in plan) return failed(plan, deps, 'a migration may be running');
        if (plan.status !== 'plan') return recountRefused(plan, args, deps);
        printPlan(plan, slug, deps);
        return EXIT.ok;
    }
    const result = await recountCohort({ ...input, expect });
    if ('error_type' in result) return failed(result, deps, "learners' requests, an account deletion or a migration may be running");
    switch (result.status) {
        case 'recounted':
            deps.log(`Recounted ${result.days} day(s) of ${result.learners} learner(s) in ${slug} (recount ${result.id}, plan ${result.sha256}). The earlier rows stay; the learners see the new values.`);
            return EXIT.ok;
        case 'unchanged':
            deps.log(`Nothing to recount: no day changes (plan ${result.sha256}). Nothing was written.`);
            return EXIT.ok;
        default:
            return recountRefused(result, args, deps);
    }
}

/** @param {ReturnType<typeof parseArgs>} args @param {Deps} deps */
async function statsOne(args, deps) {
    const found = await cohortOf(String(args.slug), deps);
    if ('code' in found) return found.code;
    const stats = await cohortStats({ cohortId: found.cohort.id, pool: deps.getPool() });
    if ('error_type' in stats) return failed(stats, deps);
    deps.log(`${found.cohort.slug}: learners ${stats.learners}; streams ${stats.streams} (${stats.streamsMarked} of deleted accounts); signals ${stats.signals}; day rows ${stats.days} (${stats.daysMarked} of deleted accounts); closed through ${stats.lastClosed ?? '-'}`);
    return EXIT.ok;
}

/**
 * @param {string[]} argv
 * @param {Deps} deps
 * @returns {Promise<number>} the exit code
 */
export async function run(argv, deps) {
    const args = parseArgs(argv);
    if (args.help) {
        deps.log(USAGE);
        return EXIT.ok;
    }
    if (args.error) {
        deps.log(`${args.error}\n${USAGE}`);
        return EXIT.usage;
    }
    if (deps.env.TRAINING_ENABLED !== 'true') {
        deps.log('Refused: TRAINING_ENABLED is not "true" here. Training runs only on the school deployment (stack.env).');
        return EXIT.refused;
    }
    switch (args.mode) {
        case 'loadCatalog': return loadOne('catalog', args, deps);
        case 'loadRules': return loadOne('rules', args, deps);
        case 'set': return setOne(args, deps);
        case 'show': return showOne(args, deps);
        case 'close': return closeSome(args, deps);
        case 'verify': return verifyOne(args, deps);
        case 'recompute': return recomputeOne(args, deps);
        default: return statsOne(args, deps);
    }
}

/**
 * A stream's text (stdin), reading a little past STDIN_LIMIT at most; null when it is a terminal or
 * when nothing arrives within waitMs. Under `docker compose exec -T` stdin is a pipe even when no
 * file was given, so without the wait a forgotten file would keep the script waiting on the terminal.
 * @param {NodeJS.ReadableStream & { isTTY?: boolean, destroy?: () => void }} stream
 * @param {{ waitMs?: number }} [options]
 * @returns {Promise<string | null>}
 */
export async function readStdinFrom(stream, { waitMs = STDIN_WAIT_MS } = {}) {
    if (stream.isTTY) return null;
    const chunks = /** @type {AsyncIterator<Buffer | string>} */ (stream[Symbol.asyncIterator]());
    const pending = chunks.next();
    pending.catch(() => {});
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const first = await Promise.race([pending, new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); })]);
    clearTimeout(timer);
    if (first === null) {
        stream.destroy?.();
        return null;
    }
    /** @type {Buffer[]} */
    const parts = [];
    let size = 0;
    for (let step = /** @type {IteratorResult<Buffer | string>} */ (first); !step.done; step = await chunks.next()) {
        const part = Buffer.from(step.value);
        parts.push(part);
        size += part.length;
        if (size > STDIN_LIMIT) {
            stream.destroy?.();
            break;
        }
    }
    return Buffer.concat(parts).toString('utf8');
}

/** The real dependencies: the api's pool, environment and stdin. */
export function defaultDeps() {
    return /** @type {Deps & { close: () => Promise<void> }} */ ({
        getPool,
        env: process.env,
        log: (line) => console.log(line),
        readStdin: () => readStdinFrom(process.stdin),
        close: async () => {
            await getPool()?.end?.().catch(() => {});
        },
    });
}

const isMainModule = (() => {
    try {
        return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
})();

if (isMainModule) {
    const deps = defaultDeps();
    try {
        process.exitCode = await run(process.argv.slice(2), deps);
    } finally {
        await deps.close();
    }
}
