#!/usr/bin/env node
// @ts-check
/**
 * Staff: study time of job training (doc/brushup-2026/training-plan.ja.md §4.9; tables of
 * server/migrations/022_training_study_time.sql, logic in tools/core/trainingTime.js).
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
 *
 * --load-catalog  a unit list (risepath.training-course/v1) as a version that never changes, named by
 *                 its sha256; the same content again is the version already there.
 * --load-rules    the counting rules the same way. A value is never printed: an error names fields only.
 * --set           a cohort uses a unit list and rules (by sha256) from a Japan-time day: today at the
 *                 earliest, tomorrow once a setting is in effect; never after the cohort's last day;
 *                 once the cohort has study time, only the course in effect today. Settings are only
 *                 added.
 * --show          the cohort's settings (versions by sha256), or one learner's closed days and units.
 * --close         closes the final days of every learner of the cohort (or one), each in its own
 *                 transaction. The api closes a learner's final days too, when the learner's page
 *                 sends a signal or reads its study time; this closes those of pages that stopped.
 * --stats         the cohort's row counts (marked rows of deleted accounts too) and its last closed day.
 *
 * Refuses everything unless TRAINING_ENABLED is exactly "true" here (the public Rise Path stack
 * leaves it unset). Exit: 0 done (or already so), 1 usage, 2 refused, 3 unavailable (database, or a
 * lock busy for 10 s: try again).
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
    learnerDays,
    loadCatalog,
    loadRules,
    setCohortTime,
} from '../tools/core/trainingTime.js';
import { jstDayOf } from '../shared/training/studyTime.js';

export const USAGE = [
    'Usage (the files over stdin):',
    '  node scripts/training-time.mjs --load-catalog --by <who> --note <text> < course.json',
    '  node scripts/training-time.mjs --load-rules --by <who> --note <text> < time-rules.json',
    '  node scripts/training-time.mjs --set <cohort slug> --catalog <sha256> --rules <sha256> --from YYYY-MM-DD --by <who> --reason <text>',
    '  node scripts/training-time.mjs --show <cohort slug> [--learner <account uuid>]',
    '  node scripts/training-time.mjs --close <cohort slug> [--learner <account uuid>]',
    '  node scripts/training-time.mjs --stats <cohort slug>',
].join('\n');

export const EXIT = Object.freeze({ ok: 0, usage: 1, refused: 2, unavailable: 3 });

/** The largest file read from stdin (a unit list of 500 units is far below it). */
export const STDIN_LIMIT = 1024 * 1024;

/** How long the script waits for the first bytes of the piped file before it says none was piped. */
export const STDIN_WAIT_MS = 5000;

/** Who closes in a staff run (training_time_days.computed_by). */
export const STAFF_CLOSER = 'staff';

/**
 * @typedef {{
 *   getPool: () => import('../tools/core/training.js').TrainingPool | null,
 *   env: Record<string, string | undefined>,
 *   log: (line: string) => void,
 *   readStdin: () => Promise<string | null>,
 *   now?: () => number,
 * }} Deps
 *   readStdin: the whole of stdin, or null when nothing was piped (a terminal, or no bytes within STDIN_WAIT_MS)
 */

const MODES = /** @type {const} */ (['loadCatalog', 'loadRules', 'set', 'show', 'close', 'stats']);
const FLAGS = Object.freeze({
    '--load-catalog': 'loadCatalog', '--load-rules': 'loadRules', '--set': 'set', '--show': 'show', '--close': 'close', '--stats': 'stats',
    '--by': 'by', '--note': 'note', '--reason': 'reason', '--catalog': 'catalog', '--rules': 'rules', '--from': 'from', '--learner': 'learner',
});
/** The options each mode takes (and needs). */
const OPTIONS = Object.freeze({
    loadCatalog: { needs: ['by', 'note'], takes: ['by', 'note'] },
    loadRules: { needs: ['by', 'note'], takes: ['by', 'note'] },
    set: { needs: ['catalog', 'rules', 'from', 'by', 'reason'], takes: ['catalog', 'rules', 'from', 'by', 'reason'] },
    show: { needs: [], takes: ['learner'] },
    close: { needs: [], takes: ['learner'] },
    stats: { needs: [], takes: [] },
});
const NO_VALUE = new Set(['loadCatalog', 'loadRules']);

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
            out.error ??= 'choose exactly one of --load-catalog, --load-rules, --set, --show, --close, --stats';
            continue;
        }
        if (isMode && NO_VALUE.has(name)) {
            out.mode = /** @type {any} */ (name);
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
    if (!out.mode) return { ...out, error: 'choose exactly one of --load-catalog, --load-rules, --set, --show, --close, --stats' };
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
    return out;
}

/** h:mm:ss of a duration. @param {number} ms */
export const hms = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** A refusal of the core module: a usage error, or the database (3; a busy lock says so). @param {{ error: string, error_type: string }} result @param {Deps} deps */
function failed(result, deps) {
    if (result.error_type === 'validation') {
        deps.log(`${result.error}\n${USAGE}`);
        return EXIT.usage;
    }
    if (result.error_type === 'account_busy') {
        deps.log('Unavailable: a lock was busy for 10 s (an account deletion or a close may be running). Try again.');
        return EXIT.unavailable;
    }
    if (result.error_type === 'invalid_setting') {
        deps.log('Refused: a stored rules or unit list version does not parse with this code. Nothing was closed; ask the developers.');
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
        const result = await learnerDays({ userId: args.values.learner, cohortId: cohort.id, pool: deps.getPool() });
        if ('error_type' in result) return failed(result, deps);
        deps.log(`${result.userId} in ${cohort.slug}: ${result.days.length} closed day(s)${result.days.length ? `, through ${result.days.at(-1)?.day}` : ''}`);
        for (const d of result.days) deps.log(`  ${d.day}  ${hms(d.countedMs).padStart(9)}  over the set time ${hms(d.overCapMs)}  signals ${d.signals}${d.kind === 'close' ? '' : `  (${d.kind})`}`);
        for (const u of result.units) deps.log(`  unit ${u.unitKey}: ${hms(u.countedMs)} counted, ${hms(u.overCapMs)} over the set time`);
        return EXIT.ok;
    }
    const settings = await cohortSettings({ cohortId: cohort.id, pool: deps.getPool() });
    if ('error_type' in settings) return failed(settings, deps);
    const today = jstDayOf((deps.now ?? Date.now)());
    const current = settings.filter((s) => s.effectiveFrom <= today).at(-1);
    deps.log(`${cohort.slug} (${cohort.id}): ${cohort.name}, ${cohort.startsOn ?? '-'} … ${cohort.endsOn ?? '-'}, ${settings.length} setting(s)${current ? '' : '; none in effect today: nothing is counted'}`);
    for (const s of settings) {
        deps.log(`  from ${s.effectiveFrom}${s === current ? ' (in effect today)' : ''}: unit list ${s.courseKey} (${s.units} unit(s)) ${s.catalogSha256}, rules ${s.algorithm} ${s.rulesSha256}; set ${s.setAt ?? '-'} by ${s.setBy}: ${s.reason}`);
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
