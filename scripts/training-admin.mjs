#!/usr/bin/env node
// @ts-check
/**
 * Staff: job-training cohorts and who is in them (doc/brushup-2026/training-plan.ja.md D1, D3, D7;
 * tables of server/migrations/021_training_cohorts.sql, logic in tools/core/training.js).
 *
 * Run it in the school deployment's api container (DATABASE_URL_PHASE1 and TRAINING_ENABLED are
 * already there):
 *
 *   docker compose --env-file stack.env exec -T api node scripts/training-admin.mjs --create-cohort 2026-11-web --name "2026年11月 Web" [--starts-on 2026-11-01] [--ends-on 2027-01-31]
 *   docker compose --env-file stack.env exec -T api node scripts/training-admin.mjs --add <account uuid> --cohort 2026-11-web --role learner
 *   docker compose --env-file stack.env exec -T api node scripts/training-admin.mjs --list 2026-11-web
 *
 * --create-cohort  a cohort (期) with a slug (a-z, 0-9, "-"), a name and optional dates; an existing
 *                  slug is left as it is.
 * --add            an account to a cohort with a role (learner, instructor, examiner, staff), under
 *                  the account's shared lock and only while its Rise Path account row exists: the
 *                  person signs in to this deployment's app once first. A deleted account is
 *                  refused. An account already in the cohort keeps its role (changing a role is
 *                  not supported yet).
 * --list           the cohort and every membership it ever had, marked ones (deleted accounts) too.
 *
 * Refuses everything unless TRAINING_ENABLED is exactly "true" here (the public Rise Path stack
 * leaves it unset). Exit: 0 done (or already so), 1 usage, 2 refused, 3 unavailable (database, or
 * the account lock was busy for 10 s: try again).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPool, PHASE1_USER_ID } from '../server/db.js';
import { canonicalUserId } from '../tools/core/accountDeletions.js';
import { addMember, createCohort, listMembers, TRAINING_ROLES } from '../tools/core/training.js';

export const USAGE = [
    'Usage:',
    '  node scripts/training-admin.mjs --create-cohort <slug> --name <name> [--starts-on YYYY-MM-DD] [--ends-on YYYY-MM-DD]',
    `  node scripts/training-admin.mjs --add <account uuid> --cohort <slug> --role <${TRAINING_ROLES.join('|')}>`,
    '  node scripts/training-admin.mjs --list <slug>',
].join('\n');

export const EXIT = Object.freeze({ ok: 0, usage: 1, refused: 2, unavailable: 3 });

/**
 * @typedef {{
 *   getPool: () => import('../tools/core/training.js').TrainingPool | null,
 *   env: Record<string, string | undefined>,
 *   log: (line: string) => void,
 * }} Deps
 */

/** @param {string[]} argv */
export function parseArgs(argv) {
    /** @type {{ createCohort?: string, name?: string, startsOn?: string, endsOn?: string, add?: string, cohort?: string, role?: string, list?: string, help: boolean, error?: string }} */
    const out = { help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = () => {
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                out.error ??= `${arg} needs a value`;
                return '';
            }
            i += 1;
            return next;
        };
        if (arg === '--create-cohort') out.createCohort = value();
        else if (arg === '--name') out.name = value();
        else if (arg === '--starts-on') out.startsOn = value();
        else if (arg === '--ends-on') out.endsOn = value();
        else if (arg === '--add') out.add = value();
        else if (arg === '--cohort') out.cohort = value();
        else if (arg === '--role') out.role = value();
        else if (arg === '--list') out.list = value();
        else if (arg === '--help' || arg === '-h') out.help = true;
        else out.error ??= `unknown argument ${arg}`;
    }
    const modes = [out.createCohort !== undefined, out.add !== undefined, out.list !== undefined].filter(Boolean).length;
    if (!out.error && !out.help && modes !== 1) out.error = 'choose exactly one of --create-cohort, --add, --list';
    if (!out.error && out.createCohort !== undefined && out.name === undefined) out.error = '--create-cohort needs --name';
    if (!out.error && out.createCohort === undefined && (out.name !== undefined || out.startsOn !== undefined || out.endsOn !== undefined)) {
        out.error = '--name, --starts-on and --ends-on only go with --create-cohort';
    }
    if (!out.error && out.add !== undefined && (out.cohort === undefined || out.role === undefined)) out.error = '--add needs --cohort and --role';
    if (!out.error && out.add === undefined && (out.cohort !== undefined || out.role !== undefined)) out.error = '--cohort and --role only go with --add';
    return out;
}

/** A refusal of the core module: a usage error, or the database (3; a busy lock says so). @param {{ error: string, error_type: string }} result @param {Deps} deps */
function failed(result, deps) {
    if (result.error_type === 'validation') {
        deps.log(`${result.error}\n${USAGE}`);
        return EXIT.usage;
    }
    if (result.error_type === 'account_busy') {
        deps.log('Unavailable: the account is busy (an account deletion may be running). Try again.');
        return EXIT.unavailable;
    }
    deps.log(`Unavailable: the database could not do it (${result.error_type}). Try again later.`);
    return EXIT.unavailable;
}

/** @param {NonNullable<ReturnType<typeof parseArgs>>} args @param {Deps} deps */
async function createOne(args, deps) {
    const result = await createCohort({ slug: String(args.createCohort), name: String(args.name), startsOn: args.startsOn ?? null, endsOn: args.endsOn ?? null, pool: deps.getPool() });
    if ('error_type' in result) return failed(result, deps);
    const { cohort } = result;
    const dates = `${cohort.startsOn ?? '-'} … ${cohort.endsOn ?? '-'}`;
    deps.log(result.status === 'created'
        ? `Created cohort ${cohort.slug} (${cohort.id}): ${cohort.name}, ${dates}`
        : `Cohort ${cohort.slug} already exists (${cohort.id}): ${cohort.name}, ${dates}. Left as it is.`);
    return EXIT.ok;
}

/** @param {NonNullable<ReturnType<typeof parseArgs>>} args @param {Deps} deps */
async function addOne(args, deps) {
    const id = canonicalUserId(args.add);
    if (!id) {
        deps.log('Refused: --add needs an account id (a UUID).');
        return EXIT.usage;
    }
    if (id === canonicalUserId(PHASE1_USER_ID)) {
        deps.log('Refused: that is the shared dev and bridge user (PHASE1_USER_ID), never a trainee.');
        return EXIT.usage;
    }
    const result = await addMember({ cohortSlug: String(args.cohort), userId: id, role: String(args.role), pool: deps.getPool() });
    if ('error_type' in result) return failed(result, deps);
    switch (result.status) {
        case 'added':
            deps.log(`Added ${id} to ${args.cohort} as ${result.role}.`);
            return EXIT.ok;
        case 'already':
            deps.log(`${id} is already in ${args.cohort} as ${result.role}.`);
            return EXIT.ok;
        case 'role_differs':
            deps.log(`Refused: ${id} is already in ${args.cohort} as ${result.role}; changing a role is not supported yet.`);
            return EXIT.refused;
        case 'no_cohort':
            deps.log(`Refused: there is no cohort ${args.cohort} (--create-cohort first).`);
            return EXIT.refused;
        case 'deleted_account':
            deps.log(`Refused: the account ${id} was deleted. A new sign-in opens a new, empty account; add it after that.`);
            return EXIT.refused;
        default:
            deps.log(`Refused: no Rise Path account ${id} on this deployment yet. The person signs in to this school's app once; then add again.`);
            return EXIT.refused;
    }
}

/** @param {string} slug @param {Deps} deps */
async function listOne(slug, deps) {
    const result = await listMembers({ cohortSlug: slug, pool: deps.getPool() });
    if ('error_type' in result) return failed(result, deps);
    if ('status' in result) {
        deps.log(`Refused: there is no cohort ${slug}.`);
        return EXIT.refused;
    }
    const { cohort, members } = result;
    deps.log(`${cohort.slug} (${cohort.id}): ${cohort.name}, ${cohort.startsOn ?? '-'} … ${cohort.endsOn ?? '-'}, ${members.length} membership(s)`);
    for (const m of members) {
        deps.log(`${m.userId}  ${m.role.padEnd(10)}  added ${m.addedAt ?? '-'}${m.accountDeletedAt ? `  account deleted ${m.accountDeletedAt}` : ''}`);
    }
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
    if (args.createCohort !== undefined) return createOne(args, deps);
    if (args.add !== undefined) return addOne(args, deps);
    return listOne(String(args.list), deps);
}

/** The real dependencies: the api's pool and environment. */
export function defaultDeps() {
    return /** @type {Deps & { close: () => Promise<void> }} */ ({
        getPool,
        env: process.env,
        log: (line) => console.log(line),
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
