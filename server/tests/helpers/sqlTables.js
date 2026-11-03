// @ts-check
/**
 * The tables an SQL text names, for the coverage tests of the study time check and recount
 * (server/tests/trainingTimeCheck.test.js, trainingTimeRecount.test.js; their self-checks of these
 * functions are in trainingTimeCheck.test.js): every table server/migrations creates, however a
 * statement spells it; the tables a LOCK TABLE … IN <mode> MODE NOWAIT locks; the tables a table's
 * foreign keys reference. Not a test file (npm test runs *.test.js).
 */
import fs from 'node:fs';

/** A table name without quotes, in lower case, without public. @param {string} name */
export const bare = (name) => name.replace(/"/g, '').toLowerCase().replace(/^public\./, '');

/** A table name as a migration writes it (schema optional, quotes optional). */
const NAME = '((?:"?[a-z_][a-z0-9_]*"?\\.)?"?[a-z_][a-z0-9_]*"?)';

/** The tables an SQL text creates. @param {string} sql */
export const createdIn = (sql) => [...sql.matchAll(new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, 'gi'))].map((m) => bare(m[1]));

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
/** The migrations' texts, in file order. */
const TEXTS = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort().map((f) => fs.readFileSync(new URL(f, MIGRATIONS), 'utf8'));

/** Every table server/migrations creates. */
export const CREATED = [...new Set(TEXTS.flatMap(createdIn))];

/** A table as a statement may spell it. @param {string} t */
const spelled = (t) => (t.includes('.') ? t.split('.').map((p) => `"?${p}"?`).join('\\.') : `(?:"?public"?\\.)?"?${t}"?`);

/**
 * The created tables a statement names: in a list (before or after a comma), in a subquery or
 * parentheses, at the end of the text, in any case, with or without public. or quotes; not a table of
 * that name in another schema, a longer name, or a name qualified by it. A name in an SQL comment or a
 * string counts too.
 * @param {string} sql
 */
export const tablesOf = (sql) => CREATED.filter((t) => new RegExp(`(?<![\\w."])${spelled(t)}(?![\\w."])`, 'i').test(sql));

/** The tables a set of statements names, sorted. @param {readonly string[]} sqls */
export const reads = (sqls) => [...new Set(sqls.flatMap(tablesOf))].sort();

/** The tables a LOCK TABLE … IN <mode> MODE NOWAIT locks. @param {string} lock */
export const lockedBy = (lock) => lock.replace(/^LOCK TABLE /, '').replace(/ IN [A-Z ]+ MODE NOWAIT$/, '').split(', ').map(bare);

/**
 * The tables the foreign keys of `table` reference: REFERENCES in its CREATE TABLE, and in an ALTER
 * TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES, in every migration.
 * @param {string} table bare
 */
export function referencedBy(table) {
    /** @type {Set<string>} */
    const found = new Set();
    for (const text of TEXTS) {
        for (const m of text.matchAll(new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}\\s*\\(([\\s\\S]*?)\\n\\);`, 'gi'))) {
            if (bare(m[1]) !== table) continue;
            for (const r of m[2].matchAll(new RegExp(`\\bREFERENCES\\s+${NAME}`, 'gi'))) found.add(bare(r[1]));
        }
        for (const m of text.matchAll(new RegExp(`\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?${NAME}\\s+ADD\\s+CONSTRAINT\\s+\\S+\\s+FOREIGN\\s+KEY\\s*\\([^)]*\\)\\s*REFERENCES\\s+${NAME}`, 'gi'))) {
            if (bare(m[1]) === table) found.add(bare(m[2]));
        }
    }
    return [...found].sort();
}
